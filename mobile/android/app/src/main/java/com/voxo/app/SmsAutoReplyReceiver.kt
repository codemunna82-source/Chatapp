package com.voxo.app

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.provider.Telephony
import androidx.core.app.NotificationCompat
import androidx.core.app.Person

/**
 * Catches an incoming SMS the instant it arrives — even if VOXO is not
 * running, since a manifest-declared receiver for this action still gets
 * started by the OS — and does two independent things with it: shows it
 * to the agent (postLeadNotification, Chats tab, Settings > SMS) for any
 * sender that looks like a real mobile number, and, only if its text
 * also matches one of a small fixed keyword list, schedules an auto-reply
 * with this agent's personal chat link. The first is about noticing a
 * text arrived; the second is about replying to it on VOXO's own
 * initiative, which is why a wider net on the first was never a reason
 * to widen the second — see isIndianMobileSender vs. matchesKeyword below.
 *
 * The reply does not go out from here. Several leads texting in within
 * moments of each other must not turn into a burst of SMS sent back to
 * back off this one SIM: a carrier's own spam filtering can flag that,
 * and Android itself prompts "this app is sending a lot of messages" past
 * a threshold — a prompt with no UI to answer, since nothing is on
 * screen at the moment a background receiver fires. So each matching
 * text is instead handed to SmsAutoReplySendReceiver with its own
 * independently randomised delay (VoxoSmsAutoReplyModule.MIN/MAX_REPLY_
 * DELAY_MS), via AlarmManager rather than a plain Handler.postDelayed —
 * a delay held only in memory would vanish the moment Android reclaims
 * this process, which a receiver with nothing keeping it foregrounded is
 * an easy target for.
 *
 * Deliberately native end to end: it reads the on/off switch and the
 * reply text from the SharedPreferences file VoxoSmsAutoReplyModule
 * writes, so none of this needs the JS runtime alive or a network call
 * at the moment a lead's text comes in.
 *
 * KEYWORDS must be kept in step with MATCH_KEYWORDS in
 * smsLeadMatch.ts — there is no shared source between Kotlin and TS to
 * enforce that automatically.
 */
class SmsAutoReplyReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

    val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
    if (messages.isNullOrEmpty()) return

    val sender = messages[0].originatingAddress ?: return
    val body = messages.joinToString("") { it.messageBody ?: "" }

    // Shown for any text that looks like it came from a real person's
    // number — see isIndianMobileSender below — regardless of what it
    // says, whether or not auto-reply is even turned on. "VOXO replies on
    // its own" and "the agent notices someone texted in" are different
    // things, and only the first one is gated on a keyword at all.
    // Without this, the only way to find out an SMS had arrived was to
    // happen to open the Chats tab and have it re-scan — nothing ever
    // pushed it to the agent the way an incoming WhatsApp message does.
    if (isIndianMobileSender(sender)) {
      postLeadNotification(context, sender, body)
    }

    // The auto-reply itself stays keyword-gated — see MATCH_KEYWORDS.
    // Relaxing what gets SHOWN to the agent is not a reason to relax what
    // gets a chat-link texted back automatically; that would mean a
    // stray "hi mom" gets a reply nobody asked for.
    if (!matchesKeyword(body)) return

    val prefs = context.getSharedPreferences(VoxoSmsAutoReplyModule.PREFS_NAME, Context.MODE_PRIVATE)
    if (!prefs.getBoolean(VoxoSmsAutoReplyModule.KEY_ENABLED, false)) return

    val replyText = prefs.getString(VoxoSmsAutoReplyModule.KEY_REPLY_TEXT, null)
    if (replyText.isNullOrBlank()) return

    // Marked now, not after the delayed send actually fires — a second
    // matching text from the same sender arriving during the delay
    // window must not schedule a second reply on top of the first.
    val repliedKey = VoxoSmsAutoReplyModule.repliedKeyFor(sender)
    if (prefs.getBoolean(repliedKey, false)) return

    // The daily cap — see VoxoSmsAutoReplyModule.DEFAULT_DAILY_LIMIT. 0
    // means the agent explicitly chose no cap at all, not "zero allowed".
    // Checked and spent here, at schedule time, not when the delayed send
    // actually fires: the count has to reflect what's already committed
    // to go out today, or two texts arriving close together could both
    // slip in under a limit meant to stop exactly that.
    val dailyLimit = prefs.getInt(VoxoSmsAutoReplyModule.KEY_DAILY_LIMIT, VoxoSmsAutoReplyModule.DEFAULT_DAILY_LIMIT)
    if (dailyLimit != VoxoSmsAutoReplyModule.UNLIMITED_DAILY_LIMIT) {
      if (VoxoSmsAutoReplyModule.readDailyCount(prefs) >= dailyLimit) return
      VoxoSmsAutoReplyModule.incrementDailyCount(prefs)
    }

    prefs.edit().putBoolean(repliedKey, true).apply()

    val delayMs = (VoxoSmsAutoReplyModule.MIN_REPLY_DELAY_MS..VoxoSmsAutoReplyModule.MAX_REPLY_DELAY_MS).random()
    val sendIntent = Intent(context, SmsAutoReplySendReceiver::class.java).apply {
      putExtra(VoxoSmsAutoReplyModule.EXTRA_SENDER, sender)
      putExtra(VoxoSmsAutoReplyModule.EXTRA_BODY, replyText)
    }
    // Request code from the sender's own hash, so a second text from the
    // same number (which repliedKey already should have stopped) would
    // at worst replace this alarm rather than stack a duplicate one.
    val pendingIntent = PendingIntent.getBroadcast(
      context,
      sender.hashCode(),
      sendIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    // Inexact on purpose — allowWhileIdle lets it still fire under Doze,
    // and nothing about a jittered delay needs the precision (or the
    // SCHEDULE_EXACT_ALARM permission) an exact alarm would ask for.
    alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + delayMs, pendingIntent)
  }

  /**
   * Drawn natively rather than through notifee/expo-notifications
   * (messageNotification.ts) on purpose: those need the JS runtime
   * running, and nothing wakes it for a plain SMS_RECEIVED broadcast the
   * way an FCM data message wakes a headless JS task for a real WhatsApp
   * message. This has to work with VOXO fully killed, so it is built with
   * plain NotificationCompat instead — styled to read the same as a real
   * message notification (MessagingStyle, the same channel, the same
   * accent colour), not literally the same code path.
   *
   * CHAT_CHANNEL_ID must match pushRegistration.ts's own constant of the
   * same name — same reasoning as KEYWORDS above, no shared source
   * between Kotlin and TS. The channel is usually already created by the
   * JS side by the time any SMS arrives (first app launch sets it up),
   * but is created here too, defensively, for the install that receives
   * a lead text before VOXO has ever been opened once.
   */
  private fun postLeadNotification(context: Context, sender: String, body: String) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHAT_CHANNEL_ID) == null) {
      val channel = NotificationChannel(CHAT_CHANNEL_ID, "Messages", NotificationManager.IMPORTANCE_HIGH)
      channel.enableVibration(true)
      channel.vibrationPattern = longArrayOf(0, 250, 250, 250)
      channel.lightColor = ACCENT_COLOR
      manager.createNotificationChannel(channel)
    }

    // Opens straight to this lead's SMS thread — SmsThread in
    // linking.ts — rather than just launching the app and leaving the
    // agent to go find it.
    val uri = Uri.Builder().scheme("voxo").authority("sms-thread").appendPath(sender).build()
    val openIntent = Intent(Intent.ACTION_VIEW, uri, context, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val contentIntent = PendingIntent.getActivity(
      context,
      sender.hashCode(),
      openIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val person = Person.Builder().setName(sender).build()
    val style = NotificationCompat.MessagingStyle(person).addMessage(body, System.currentTimeMillis(), person)

    val notification = NotificationCompat.Builder(context, CHAT_CHANNEL_ID)
      .setSmallIcon(R.drawable.notification_icon)
      .setColor(ACCENT_COLOR)
      .setStyle(style)
      .setContentIntent(contentIntent)
      .setAutoCancel(true)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .build()

    manager.notify(sender.hashCode(), notification)
  }

  companion object {
    private val KEYWORDS = listOf("hii", "saw", "profile")

    /** Must match pushRegistration.ts's CHAT_CHANNEL_ID. */
    private const val CHAT_CHANNEL_ID = "voxo-messages"
    private val ACCENT_COLOR = Color.parseColor("#26344D")

    private fun matchesKeyword(body: String): Boolean {
      val lower = body.lowercase()
      return KEYWORDS.any { lower.contains(it) }
    }

    /**
     * Must match isIndianMobileSender in smsLeadMatch.ts — no shared
     * source between Kotlin and TS to enforce that automatically, same
     * as KEYWORDS/MATCH_KEYWORDS above.
     *
     * True for a sender that looks like a real 10-digit Indian mobile
     * number (optionally with a country code or trunk prefix), false for
     * a DLT-registered alphanumeric sender id ("VM-HDFCBK") or a short
     * numeric gateway code ("56070", "121") — the senders an OTP, a bank
     * alert, or a promotional blast actually come from.
     */
    private fun isIndianMobileSender(address: String): Boolean {
      if (address.any { it.isLetter() }) return false
      val digits = address.filter { it.isDigit() }
      if (digits.length < 10 || digits.length > 12) return false
      return digits.takeLast(10).first() in '6'..'9'
    }
  }
}
