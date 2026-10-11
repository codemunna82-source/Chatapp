package com.voxo.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Telephony
import android.telephony.SmsManager

/**
 * Catches an incoming SMS the instant it arrives — even if VOXO is not
 * running, since a manifest-declared receiver for this action still gets
 * started by the OS — and, if its text matches one of a small fixed
 * keyword list, replies with this agent's personal chat link.
 *
 * Deliberately native end to end: it reads the on/off switch and the
 * reply text from the SharedPreferences file VoxoSmsAutoReplyModule
 * writes, and sends the reply itself, so none of this needs the JS
 * runtime alive or a network call at the moment a lead's text comes in.
 *
 * KEYWORDS must be kept in step with MATCH_KEYWORDS in
 * SmsInboxScreen.tsx — there is no shared source between Kotlin and TS
 * to enforce that automatically.
 */
class SmsAutoReplyReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

    val prefs = context.getSharedPreferences(VoxoSmsAutoReplyModule.PREFS_NAME, Context.MODE_PRIVATE)
    if (!prefs.getBoolean(VoxoSmsAutoReplyModule.KEY_ENABLED, false)) return

    val replyText = prefs.getString(VoxoSmsAutoReplyModule.KEY_REPLY_TEXT, null)
    if (replyText.isNullOrBlank()) return

    val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
    if (messages.isNullOrEmpty()) return

    val sender = messages[0].originatingAddress ?: return
    val body = messages.joinToString("") { it.messageBody ?: "" }
    if (!matchesKeyword(body)) return

    val repliedKey = VoxoSmsAutoReplyModule.repliedKeyFor(sender)
    if (prefs.getBoolean(repliedKey, false)) return

    try {
      // getDefault() is deprecated from API 31 on — the system-service
      // lookup is its replacement, but only exists from API 31 on too, so
      // minSdk 24 still needs the old call as a fallback.
      val smsManager = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        context.getSystemService(SmsManager::class.java)
      } else {
        @Suppress("DEPRECATION")
        SmsManager.getDefault()
      }
      val parts = smsManager.divideMessage(replyText)
      smsManager.sendMultipartTextMessage(sender, null, parts, null, null)
      prefs.edit()
        .putBoolean(repliedKey, true)
        .putInt(
          VoxoSmsAutoReplyModule.KEY_REPLIED_COUNT,
          prefs.getInt(VoxoSmsAutoReplyModule.KEY_REPLIED_COUNT, 0) + 1,
        )
        .apply()
    } catch (_: Exception) {
      // Nothing is listening to report this to — no UI is open at the
      // moment an SMS arrives in the background.
    }
  }

  companion object {
    private val KEYWORDS = listOf("hii", "saw", "profile")

    private fun matchesKeyword(body: String): Boolean {
      val lower = body.lowercase()
      return KEYWORDS.any { lower.contains(it) }
    }
  }
}
