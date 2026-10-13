package com.voxo.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Telephony
import android.telephony.SmsMessage
import android.telephony.SubscriptionManager
import android.util.Log
import java.util.concurrent.Executors

/**
 * Saves every incoming SMS into VoxoSmsDatabase, whether or not VOXO's UI or
 * JS runtime is alive. A manifest receiver for SMS_RECEIVED is started by the
 * OS even when the app process is not running — but NOT after the user has
 * force-stopped the app (Android keeps a force-stopped app in the "stopped"
 * state and delivers it no broadcasts until it is opened again). Messages
 * missed that way are recovered by the history import on the next app open.
 *
 * Kept separate from SmsAutoReplyReceiver so storing a message never depends
 * on the auto-reply settings, and the auto-reply never depends on storage.
 */
class SmsStoreReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

    val parts: Array<SmsMessage> = try {
      Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
    } catch (e: Exception) {
      VoxoSmsDiagnostics.recordError(context, "parse: ${e.message}")
      return
    }
    if (parts.isEmpty()) return

    val subscriptionId = subscriptionIdFrom(intent)
    val simSlot = simSlotFrom(intent, subscriptionId)
    val receivedAt = System.currentTimeMillis()
    val messages = assemble(parts, receivedAt, subscriptionId, simSlot)

    // The database write leaves the main thread, and goAsync keeps this
    // receiver's process alive until it is done (Android allows ~10s).
    val pending = goAsync()
    executor.execute {
      try {
        val app = context.applicationContext
        val stored = ArrayList<StoredSms>()
        var duplicates = 0
        for (sms in messages) {
          val row = VoxoSmsDatabase.storeOrPark(app, sms)
          if (row != null) stored.add(row) else duplicates++
        }
        VoxoSmsDiagnostics.recordBroadcast(app, stored.size, duplicates)
        VoxoSmsEvents.publish(stored)
      } catch (e: Exception) {
        Log.e(TAG, "Could not store incoming SMS", e)
        VoxoSmsDiagnostics.recordError(context, "receiver: ${e.message}")
      } finally {
        pending.finish()
      }
    }
  }

  companion object {
    private const val TAG = "SmsStoreReceiver"
    private val executor = Executors.newSingleThreadExecutor()

    /**
     * One intent carries the PDUs of one delivery. Android's framework
     * already reassembles a concatenated (multipart) SMS before broadcasting
     * it, so the parts here belong together; they are still grouped by
     * sender defensively and joined in order. The first part's service-centre
     * timestamp is the message's original send time.
     */
    fun assemble(parts: Array<SmsMessage>, receivedAt: Long, subscriptionId: Int, simSlot: Int): List<NewSms> {
      val bySender = LinkedHashMap<String, MutableList<SmsMessage>>()
      for (part in parts) {
        val sender = part.displayOriginatingAddress ?: part.originatingAddress ?: "unknown"
        bySender.getOrPut(sender) { ArrayList() }.add(part)
      }
      return bySender.map { (sender, group) ->
        val body = group.joinToString("") { it.displayMessageBody ?: it.messageBody ?: "" }
        val original = group.first().timestampMillis
        NewSms(
          address = sender,
          body = body,
          // A zero or far-future service-centre time (seen on some networks)
          // would sort the message wrongly; fall back to the receive time.
          timestamp = if (original <= 0 || original > receivedAt + 86_400_000L) receivedAt else original,
          receivedAt = receivedAt,
          direction = "IN",
          status = "RECEIVED",
          subscriptionId = subscriptionId,
          simSlot = simSlot,
          source = "broadcast",
          providerId = null,
          read = false,
        )
      }
    }

    /** The extra's name differs across Android versions and OEMs; these are the ones seen in practice. */
    fun subscriptionIdFrom(intent: Intent): Int {
      val keys = listOf("android.telephony.extra.SUBSCRIPTION_INDEX", "subscription", "subscription_id", "sub_id")
      for (key in keys) {
        if (intent.hasExtra(key)) {
          val value = intent.extras?.get(key)
          val id = (value as? Number)?.toInt() ?: (value as? String)?.toIntOrNull()
          if (id != null && id >= 0) return id
        }
      }
      return -1
    }

    fun simSlotFrom(intent: Intent, subscriptionId: Int): Int {
      if (subscriptionId >= 0 && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val slot = SubscriptionManager.getSlotIndex(subscriptionId)
        if (slot >= 0) return slot
      }
      val keys = listOf("android.telephony.extra.SLOT_INDEX", "slot", "simSlot", "slot_id", "simId", "phone")
      for (key in keys) {
        if (intent.hasExtra(key)) {
          val value = intent.extras?.get(key)
          val slot = (value as? Number)?.toInt() ?: (value as? String)?.toIntOrNull()
          if (slot != null && slot >= 0) return slot
        }
      }
      return -1
    }
  }
}
