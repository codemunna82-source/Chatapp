package com.voxo.app

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.SmsManager
import android.util.Log
import java.util.concurrent.Executors

/**
 * Hears back from the radio about a text VOXO sent. sendMultipartTextMessage
 * returns as soon as the request is handed over; whether the network took it
 * (airplane mode, no signal, no balance, a blocked short code) is only
 * reported later, through the sent-intent this receiver is the target of.
 * Without it every send looked delivered the moment it was pressed.
 *
 * Not exported: only PendingIntents VOXO itself created for a send reach it.
 */
class SmsSentReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ACTION) return
    val rowId = intent.getLongExtra(EXTRA_ROW_ID, -1L)
    if (rowId < 0) return
    val code = resultCode
    // The radio's own error number, when it gives one: says why a
    // GENERIC_FAILURE happened (SIM, balance, network refusal) in the
    // Settings > Permissions "Last problem" line.
    val radioCode = intent.getIntExtra("errorCode", -1)
    val pending = goAsync()
    executor.execute {
      try {
        handle(context.applicationContext, rowId, code, radioCode)
      } catch (e: Exception) {
        Log.e(TAG, "Could not record SMS send result", e)
      } finally {
        pending.finish()
      }
    }
  }

  companion object {
    private const val TAG = "SmsSentReceiver"
    const val ACTION = "com.voxo.app.SMS_SENT"
    const val EXTRA_ROW_ID = "row_id"
    private val executor = Executors.newSingleThreadExecutor()

    /** Plain-language reason for a failed send, shown in Settings > SMS. */
    fun reasonFor(resultCode: Int): String =
      when (resultCode) {
        SmsManager.RESULT_ERROR_RADIO_OFF -> "Airplane mode or radio off"
        SmsManager.RESULT_ERROR_NO_SERVICE -> "No network signal"
        SmsManager.RESULT_ERROR_NULL_PDU -> "Empty message"
        SmsManager.RESULT_ERROR_LIMIT_EXCEEDED -> "Too many messages sent — the phone paused sending"
        SmsManager.RESULT_ERROR_SHORT_CODE_NOT_ALLOWED,
        SmsManager.RESULT_ERROR_SHORT_CODE_NEVER_ALLOWED -> "The phone blocked this number as a short code"
        SmsManager.RESULT_ERROR_GENERIC_FAILURE -> "The network refused it (check balance and that the right SIM is used)"
        else -> "Send failed (code $resultCode)"
      }

    /** Applies one part's result to the stored message and tells a listening UI. Separate from onReceive so it can be tested. */
    fun handle(context: Context, rowId: Long, resultCode: Int, radioCode: Int = -1) {
      val db = VoxoSmsDatabase.get(context)
      val updated = if (resultCode == Activity.RESULT_OK) {
        db.updateSendStatus(rowId, VoxoSmsDatabase.STATUS_SENT)
      } else {
        val detail = if (radioCode >= 0) " (radio error $radioCode)" else ""
        VoxoSmsDiagnostics.recordError(context, "send failed: ${reasonFor(resultCode)}$detail")
        db.updateSendStatus(rowId, VoxoSmsDatabase.STATUS_FAILED)
      }
      if (updated != null) VoxoSmsEvents.publish(listOf(updated))
    }
  }
}
