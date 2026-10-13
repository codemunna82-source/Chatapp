package com.voxo.app

import android.Manifest
import android.app.PendingIntent
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.telephony.SmsManager
import android.telephony.SubscriptionManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * JS's only way to reach SmsAutoReplyReceiver, which cannot take a prop
 * or read a query — it is woken by the OS, not by React. Settings writes
 * the on/off switch and the resolved reply text (template + personal
 * link) here every time either changes, so the receiver always has a
 * same plain SharedPreferences file both sides read and write, picked
 * over react-native-mmkv (already used elsewhere in the app) because a
 * Kotlin file outside that library's own module cannot safely assume
 * which of its internal classes are exposed to the app module's own
 * classpath.
 */
class VoxoSmsAutoReplyModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "VoxoSmsAutoReply"

  @ReactMethod
  fun setConfig(enabled: Boolean, replyText: String) {
    prefs().edit()
      .putBoolean(KEY_ENABLED, enabled)
      .putString(KEY_REPLY_TEXT, replyText)
      .apply()
  }

  @ReactMethod
  fun setDailyLimit(limit: Int) {
    prefs().edit().putInt(KEY_DAILY_LIMIT, limit).apply()
  }

  @ReactMethod
  fun getStatus(promise: Promise) {
    val map = com.facebook.react.bridge.Arguments.createMap()
    map.putBoolean("enabled", prefs().getBoolean(KEY_ENABLED, false))
    map.putInt("repliedCount", prefs().getInt(KEY_REPLIED_COUNT, 0))
    map.putInt("dailyLimit", prefs().getInt(KEY_DAILY_LIMIT, DEFAULT_DAILY_LIMIT))
    map.putInt("sentToday", readDailyCount(prefs()))
    promise.resolve(map)
  }

  /**
   * sendSms.ts's own send, replacing react-native-get-sms-android's
   * autoSend — that library always calls the bare SmsManager.getDefault(),
   * which has nothing to pick on a dual-SIM phone with no default SIM
   * chosen for SMS. sendTracked resolves an explicit SIM, stores the text as
   * SENDING, and the radio's answer (SmsSentReceiver) later turns it into
   * SENT or FAILED. This promise resolves once the text is handed to the
   * radio; it rejects only when that hand-over itself throws.
   */
  @ReactMethod
  fun sendSms(phone: String, body: String, promise: Promise) {
    try {
      sendTracked(reactApplicationContext, phone, body)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("SEND_FAILED", e.message ?: "Could not send", e)
    }
  }

  private fun prefs() =
    reactApplicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  companion object {
    const val PREFS_NAME = "voxo_sms_auto_reply"
    const val KEY_ENABLED = "enabled"
    const val KEY_REPLY_TEXT = "reply_text"
    const val KEY_REPLIED_COUNT = "replied_count"
    const val KEY_DAILY_LIMIT = "daily_limit"
    const val KEY_DAILY_COUNT = "daily_count"
    const val KEY_DAILY_COUNT_DATE = "daily_count_date"
    const val EXTRA_SENDER = "sender"
    const val EXTRA_BODY = "body"

    /**
     * How many auto-replies the SIM will send in one calendar day before
     * the receiver stops scheduling new ones — a second safety net beside
     * the per-reply jitter. The keywords this matches are ordinary words,
     * so a bad day (a viral ad, a run of unrelated texts that happen to
     * say "profile") could otherwise mean dozens of replies with nothing
     * slowing it down; a carrier's spam filtering and Android's own
     * bulk-SMS warning both watch for exactly that, whatever the per-send
     * delay already does to look less like a burst.
     *
     * 0 means no cap at all — SmsAutoReplyReceiver skips the check
     * entirely rather than treating 0 as "zero allowed". Not this
     * default: an agent chooses that explicitly (see the "Unlimited"
     * option in PrivateChatLinkSection.tsx), it is never assumed.
     */
    const val DEFAULT_DAILY_LIMIT = 100
    const val UNLIMITED_DAILY_LIMIT = 0

    private fun todayKey(): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

    /** Resets to 0 the moment the stored date is no longer today — never carries a count past midnight. */
    fun readDailyCount(prefs: SharedPreferences): Int {
      if (prefs.getString(KEY_DAILY_COUNT_DATE, null) != todayKey()) return 0
      return prefs.getInt(KEY_DAILY_COUNT, 0)
    }

    /** Returns the new count after incrementing — call only once a reply is actually being scheduled. */
    fun incrementDailyCount(prefs: SharedPreferences): Int {
      val next = readDailyCount(prefs) + 1
      prefs.edit()
        .putString(KEY_DAILY_COUNT_DATE, todayKey())
        .putInt(KEY_DAILY_COUNT, next)
        .apply()
      return next
    }

    /**
     * How long a reply waits before actually going out, picked at random
     * per sender — see SmsAutoReplyReceiver for why: several leads
     * texting in close together must not turn into a burst of SMS sent
     * back to back, which both a carrier's own anti-spam filtering and
     * Android's own "this app is sending a lot of messages" prompt can
     * flag — and the second one has no UI to answer it from a receiver
     * with no activity in front of it.
     */
    const val MIN_REPLY_DELAY_MS = 10_000L
    const val MAX_REPLY_DELAY_MS = 90_000L

    /**
     * Sends a text off this phone's SIM and records it. The one send path for
     * the composer, the invitation link and the auto-reply.
     *
     * The message is stored as SENDING first, so it shows at once and a
     * failure has a row to land on; the sent-intent of every part reports to
     * SmsSentReceiver, which settles it as SENT or FAILED. Throws only when
     * the request cannot even be handed to the radio — the row is then
     * FAILED too.
     */
    fun sendTracked(context: Context, phone: String, body: String): StoredSms? {
      val smsManager = getSmsManager(context)
      val row = recordOutgoing(context, phone, body)
      val parts = smsManager.divideMessage(body)
      val sentIntents =
        if (row == null) null
        else ArrayList<PendingIntent>(parts.indices.map { sentIntentFor(context, row.id, it) })
      try {
        smsManager.sendMultipartTextMessage(phone, null, parts, sentIntents, null)
      } catch (e: Exception) {
        if (row != null) SmsSentReceiver.handle(context, row.id, SmsManager.RESULT_ERROR_GENERIC_FAILURE)
        throw e
      }

      // The phone's own sent box, as the Messages app keeps it. Only the
      // default SMS app is allowed to write there on most handsets, so this is
      // best-effort; VOXO's own store is what the thread reads.
      try {
        val values = ContentValues()
        values.put("address", phone)
        values.put("body", body)
        context.contentResolver.insert(Uri.parse("content://sms/sent"), values)
      } catch (_: Exception) {
        // Refused by the OEM; the text itself went out regardless.
      }
      return row
    }

    private fun sentIntentFor(context: Context, rowId: Long, part: Int): PendingIntent {
      val intent = Intent(context, SmsSentReceiver::class.java).apply {
        action = SmsSentReceiver.ACTION
        // The data URI makes every part's intent distinct to the system, so
        // the PendingIntents of different messages never replace each other.
        data = Uri.parse("voxosms://sent/$rowId/$part")
        putExtra(SmsSentReceiver.EXTRA_ROW_ID, rowId)
      }
      return PendingIntent.getBroadcast(
        context,
        0,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    /** Stores a text VOXO is sending as SENDING and tells a listening UI. Null if the store is unavailable; the send still goes ahead. */
    private fun recordOutgoing(context: Context, phone: String, body: String): StoredSms? =
      try {
        val now = System.currentTimeMillis()
        val subId = SmsManager.getDefaultSmsSubscriptionId()
        val row = VoxoSmsDatabase.storeOrPark(
          context,
          NewSms(
            address = phone,
            body = body,
            timestamp = now,
            receivedAt = now,
            direction = "OUT",
            status = VoxoSmsDatabase.STATUS_SENDING,
            subscriptionId = subId,
            simSlot = VoxoSmsStoreModule.slotFor(subId),
            source = VoxoSmsDatabase.SOURCE_VOXO,
            providerId = null,
            read = true,
          ),
        )
        if (row != null) VoxoSmsEvents.publish(listOf(row))
        row
      } catch (_: Exception) {
        null
      }

    /** One per sender, forever — never reply twice to the same number. */
    fun repliedKeyFor(sender: String): String = "replied_to:$sender"

    /**
     * The bare SmsManager (getDefault() / the system-service lookup that
     * replaces it from API 31) has nothing to disambiguate with on a
     * dual-SIM phone where no line has been chosen as the default for
     * SMS — Android's own "always ask" setting — and sending through it
     * then fails outright rather than asking anything, since there is no
     * UI in front of a plain API call to ask with. getDefaultSmsSubscriptionId
     * is what the Messages app itself reads for exactly this before
     * sending, so resolving a SmsManager FOR that subscription id first
     * is what actually avoids the failure, not just explains it.
     *
     * Falls back to the bare lookup only when there is truly no default
     * to resolve (INVALID_SUBSCRIPTION_ID) — same behaviour as before for
     * single-SIM phones and dual-SIM phones that do have a default set,
     * which is the common case either way.
     */
    fun getSmsManager(context: Context): SmsManager {
      val defaultSubId = SmsManager.getDefaultSmsSubscriptionId()
      if (defaultSubId != SubscriptionManager.INVALID_SUBSCRIPTION_ID) {
        return SmsManager.getSmsManagerForSubscriptionId(defaultSubId)
      }
      // No default SIM for SMS (dual-SIM phone set to "ask every time"): a
      // plain API call has nobody to ask, so pick the first active SIM. Needs
      // the phone-state permission to list SIMs; without it, the bare lookup.
      firstActiveSubscriptionId(context)?.let { return SmsManager.getSmsManagerForSubscriptionId(it) }
      return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        context.getSystemService(SmsManager::class.java)
      } else {
        @Suppress("DEPRECATION")
        SmsManager.getDefault()
      }
    }

    private fun firstActiveSubscriptionId(context: Context): Int? {
      if (context.checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) return null
      return try {
        context.getSystemService(SubscriptionManager::class.java)
          ?.activeSubscriptionInfoList
          ?.minByOrNull { it.simSlotIndex }
          ?.subscriptionId
      } catch (_: SecurityException) {
        null
      }
    }
  }
}
