package com.voxo.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * The second half of the auto-reply: fires from the AlarmManager alarm
 * SmsAutoReplyReceiver schedules, once that message's own randomised
 * delay has passed, and actually sends the SMS. Split into its own
 * receiver rather than a delayed call inside SmsAutoReplyReceiver because
 * a BroadcastReceiver has no reliable way to delay work inside one
 * onReceive() call — the process backing it can be reclaimed the moment
 * onReceive() returns, taking any in-memory timer with it; AlarmManager
 * is what survives that.
 */
class SmsAutoReplySendReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val sender = intent.getStringExtra(VoxoSmsAutoReplyModule.EXTRA_SENDER) ?: return
    val body = intent.getStringExtra(VoxoSmsAutoReplyModule.EXTRA_BODY) ?: return

    try {
      val smsManager = VoxoSmsAutoReplyModule.getSmsManager(context)
      val parts = smsManager.divideMessage(body)
      smsManager.sendMultipartTextMessage(sender, null, parts, null, null)

      val prefs = context.getSharedPreferences(VoxoSmsAutoReplyModule.PREFS_NAME, Context.MODE_PRIVATE)
      prefs.edit()
        .putInt(
          VoxoSmsAutoReplyModule.KEY_REPLIED_COUNT,
          prefs.getInt(VoxoSmsAutoReplyModule.KEY_REPLIED_COUNT, 0) + 1,
        )
        .apply()
    } catch (_: Exception) {
      // Nothing is listening to report this to — no UI is open at the
      // moment a scheduled alarm fires in the background.
    }
  }
}
