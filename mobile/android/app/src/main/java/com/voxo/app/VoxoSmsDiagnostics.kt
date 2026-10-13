package com.voxo.app

import android.content.Context

/**
 * Small, persistent facts about whether SMS capture is actually working on
 * this handset: when the receiver last ran, how many it stored, the last
 * error. Read back through VoxoSmsStoreModule.getDiagnostics, so a device
 * that silently never delivers SMS_RECEIVED (force-stopped app, restricted
 * permission, an OEM battery manager) is visible instead of guessed at.
 */
object VoxoSmsDiagnostics {
  private const val PREFS = "voxo_sms_store_diagnostics"
  private const val KEY_LAST_BROADCAST_AT = "last_broadcast_at"
  private const val KEY_BROADCAST_COUNT = "broadcast_count"
  private const val KEY_STORED_COUNT = "stored_count"
  private const val KEY_DUPLICATE_COUNT = "duplicate_count"
  private const val KEY_LAST_ERROR = "last_error"
  private const val KEY_LAST_ERROR_AT = "last_error_at"
  private const val KEY_LAST_IMPORT_AT = "last_import_at"

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun recordBroadcast(context: Context, stored: Int, duplicates: Int) {
    val p = prefs(context)
    p.edit()
      .putLong(KEY_LAST_BROADCAST_AT, System.currentTimeMillis())
      .putLong(KEY_BROADCAST_COUNT, p.getLong(KEY_BROADCAST_COUNT, 0) + 1)
      .putLong(KEY_STORED_COUNT, p.getLong(KEY_STORED_COUNT, 0) + stored)
      .putLong(KEY_DUPLICATE_COUNT, p.getLong(KEY_DUPLICATE_COUNT, 0) + duplicates)
      .apply()
  }

  fun recordError(context: Context, message: String) {
    prefs(context).edit()
      .putString(KEY_LAST_ERROR, message.take(300))
      .putLong(KEY_LAST_ERROR_AT, System.currentTimeMillis())
      .apply()
  }

  fun recordImport(context: Context) {
    prefs(context).edit().putLong(KEY_LAST_IMPORT_AT, System.currentTimeMillis()).apply()
  }

  fun lastImportAt(context: Context): Long = prefs(context).getLong(KEY_LAST_IMPORT_AT, 0)

  data class Snapshot(
    val lastBroadcastAt: Long,
    val broadcastCount: Long,
    val storedCount: Long,
    val duplicateCount: Long,
    val lastError: String?,
    val lastErrorAt: Long,
    val lastImportAt: Long,
  )

  fun snapshot(context: Context): Snapshot {
    val p = prefs(context)
    return Snapshot(
      lastBroadcastAt = p.getLong(KEY_LAST_BROADCAST_AT, 0),
      broadcastCount = p.getLong(KEY_BROADCAST_COUNT, 0),
      storedCount = p.getLong(KEY_STORED_COUNT, 0),
      duplicateCount = p.getLong(KEY_DUPLICATE_COUNT, 0),
      lastError = p.getString(KEY_LAST_ERROR, null),
      lastErrorAt = p.getLong(KEY_LAST_ERROR_AT, 0),
      lastImportAt = p.getLong(KEY_LAST_IMPORT_AT, 0),
    )
  }
}

/**
 * Hands newly stored messages to the JS runtime when one is listening.
 *
 * The receiver runs in the app's process; when that process already hosts a
 * live React instance with a subscriber, the module registers a listener here
 * and the UI updates immediately. With no listener (app closed, or the
 * process was just started by the broadcast itself) nothing is lost — the
 * rows stay `delivered_to_js = 0` and JS reads them back on resume.
 */
object VoxoSmsEvents {
  @Volatile var listener: ((List<StoredSms>) -> Unit)? = null

  fun publish(rows: List<StoredSms>) {
    if (rows.isEmpty()) return
    try {
      listener?.invoke(rows)
    } catch (_: Exception) {
      // A JS bridge that is tearing down must not take the receiver with it.
    }
  }
}
