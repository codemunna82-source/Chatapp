package com.voxo.app

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony

/**
 * Catches an incoming SMS the instant it arrives — even if VOXO is not
 * running, since a manifest-declared receiver for this action still gets
 * started by the OS — and, if its text matches one of a small fixed
 * keyword list, schedules a reply with this agent's personal chat link.
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

    val prefs = context.getSharedPreferences(VoxoSmsAutoReplyModule.PREFS_NAME, Context.MODE_PRIVATE)
    if (!prefs.getBoolean(VoxoSmsAutoReplyModule.KEY_ENABLED, false)) return

    val replyText = prefs.getString(VoxoSmsAutoReplyModule.KEY_REPLY_TEXT, null)
    if (replyText.isNullOrBlank()) return

    val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
    if (messages.isNullOrEmpty()) return

    val sender = messages[0].originatingAddress ?: return
    val body = messages.joinToString("") { it.messageBody ?: "" }
    if (!matchesKeyword(body)) return

    // Marked now, not after the delayed send actually fires — a second
    // matching text from the same sender arriving during the delay
    // window must not schedule a second reply on top of the first.
    val repliedKey = VoxoSmsAutoReplyModule.repliedKeyFor(sender)
    if (prefs.getBoolean(repliedKey, false)) return

    // The daily cap — see VoxoSmsAutoReplyModule.DEFAULT_DAILY_LIMIT.
    // Checked and spent here, at schedule time, not when the delayed send
    // actually fires: the count has to reflect what's already committed
    // to go out today, or two texts arriving close together could both
    // slip in under a limit meant to stop exactly that.
    val dailyLimit = prefs.getInt(VoxoSmsAutoReplyModule.KEY_DAILY_LIMIT, VoxoSmsAutoReplyModule.DEFAULT_DAILY_LIMIT)
    if (VoxoSmsAutoReplyModule.readDailyCount(prefs) >= dailyLimit) return
    VoxoSmsAutoReplyModule.incrementDailyCount(prefs)

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

  companion object {
    private val KEYWORDS = listOf("hii", "saw", "profile")

    private fun matchesKeyword(body: String): Boolean {
      val lower = body.lowercase()
      return KEYWORDS.any { lower.contains(it) }
    }
  }
}
