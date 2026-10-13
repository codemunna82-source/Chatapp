package com.voxo.app

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteException
import android.database.sqlite.SQLiteOpenHelper
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

/** One SMS as VOXO stores it. `timestamp` is the original send time; `receivedAt` is when this device stored it. */
data class StoredSms(
  val id: Long,
  val threadKey: String,
  val address: String,
  val body: String,
  val timestamp: Long,
  val receivedAt: Long,
  val direction: String,
  val status: String,
  val subscriptionId: Int,
  val simSlot: Int,
  val source: String,
  val read: Boolean,
)

/** What a caller wants stored. Normalisation and the dedup key are derived from this, never passed in. */
data class NewSms(
  val address: String,
  val body: String,
  val timestamp: Long,
  val receivedAt: Long,
  val direction: String,
  val status: String,
  val subscriptionId: Int,
  val simSlot: Int,
  val source: String,
  val providerId: Long?,
  val read: Boolean,
)

/**
 * The on-device SMS store. Nothing here ever leaves the phone.
 *
 * Written from three places that can run concurrently: SmsStoreReceiver (a
 * broadcast, possibly with no JS runtime at all), VoxoSmsStoreModule (history
 * import, reads) and VoxoSmsAutoReplyModule (VOXO's own sends). One
 * SQLiteOpenHelper per process serialises them; WAL lets reads proceed during
 * a write.
 */
class VoxoSmsDatabase private constructor(context: Context) :
  SQLiteOpenHelper(context.applicationContext, DB_NAME, null, DB_VERSION) {

  init {
    setWriteAheadLoggingEnabled(true)
  }

  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL(
      """
      CREATE TABLE sms_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dedup_key TEXT NOT NULL UNIQUE,
        thread_key TEXT NOT NULL,
        address TEXT NOT NULL,
        body TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        received_at INTEGER NOT NULL,
        direction TEXT NOT NULL,
        status TEXT NOT NULL,
        subscription_id INTEGER NOT NULL DEFAULT -1,
        sim_slot INTEGER NOT NULL DEFAULT -1,
        source TEXT NOT NULL,
        provider_id INTEGER,
        read INTEGER NOT NULL DEFAULT 0,
        delivered_to_js INTEGER NOT NULL DEFAULT 0
      )
      """.trimIndent(),
    )
    db.execSQL("CREATE INDEX idx_sms_thread_time ON sms_messages(thread_key, timestamp DESC, id DESC)")
    db.execSQL("CREATE INDEX idx_sms_undelivered ON sms_messages(delivered_to_js, id)")
    db.execSQL("CREATE TABLE deleted_threads (thread_key TEXT PRIMARY KEY, deleted_before INTEGER NOT NULL)")
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
    // Only version 1 exists. A future schema change adds its migration here.
  }

  /**
   * Stores one message unless it is already here. Returns the stored row, or
   * null for a duplicate.
   *
   * Two checks, because the same SMS reaches this table by different roads:
   * - exact: the same direction, thread, second and body (a re-delivered
   *   broadcast, or a re-import of an already imported provider row);
   * - near: the same direction, thread and body within DEDUP_WINDOW_MS, on
   *   either clock. The broadcast carries the service-centre time, while some
   *   OEM providers store only their own receive time, so an import of a
   *   message the receiver already saved does not always match exactly.
   *
   * The cost of the second check: the same person sending the identical text
   * twice within two minutes is kept once. That is the accepted trade-off.
   */
  fun insertIfNew(sms: NewSms): StoredSms? {
    val threadKey = threadKeyFor(sms.address)
    val db = writableDatabase
    db.beginTransaction()
    try {
      if (isDeleted(db, threadKey, sms.timestamp)) return null
      if (hasNearDuplicate(db, threadKey, sms)) return null

      val values = ContentValues().apply {
        put("dedup_key", dedupKeyFor(sms.direction, threadKey, sms.timestamp, sms.body))
        put("thread_key", threadKey)
        put("address", sms.address)
        put("body", sms.body)
        put("timestamp", sms.timestamp)
        put("received_at", sms.receivedAt)
        put("direction", sms.direction)
        put("status", sms.status)
        put("subscription_id", sms.subscriptionId)
        put("sim_slot", sms.simSlot)
        put("source", sms.source)
        if (sms.providerId != null) put("provider_id", sms.providerId) else putNull("provider_id")
        put("read", if (sms.read) 1 else 0)
        put("delivered_to_js", 0)
      }
      val id = db.insertWithOnConflict("sms_messages", null, values, SQLiteDatabase.CONFLICT_IGNORE)
      db.setTransactionSuccessful()
      if (id == -1L) return null
      return StoredSms(
        id, threadKey, sms.address, sms.body, sms.timestamp, sms.receivedAt, sms.direction,
        sms.status, sms.subscriptionId, sms.simSlot, sms.source, sms.read,
      )
    } finally {
      db.endTransaction()
    }
  }

  private fun isDeleted(db: SQLiteDatabase, threadKey: String, timestamp: Long): Boolean {
    db.rawQuery(
      "SELECT 1 FROM deleted_threads WHERE thread_key = ? AND deleted_before >= ?",
      arrayOf(threadKey, timestamp.toString()),
    ).use { return it.moveToFirst() }
  }

  private fun hasNearDuplicate(db: SQLiteDatabase, threadKey: String, sms: NewSms): Boolean {
    // rawQuery binds every argument as TEXT, and SQLite orders any number
    // below any text — so the times are CAST and the window inlined, or the
    // comparison would always be true.
    db.rawQuery(
      """
      SELECT 1 FROM sms_messages
      WHERE thread_key = ? AND direction = ? AND body = ?
        AND (ABS(timestamp - CAST(? AS INTEGER)) <= $DEDUP_WINDOW_MS
          OR ABS(received_at - CAST(? AS INTEGER)) <= $DEDUP_WINDOW_MS)
      LIMIT 1
      """.trimIndent(),
      arrayOf(threadKey, sms.direction, sms.body, sms.timestamp.toString(), sms.receivedAt.toString()),
    ).use { return it.moveToFirst() }
  }

  /** The newest message of every thread, newest thread first, with its unread count. */
  fun threads(limit: Int): List<Pair<StoredSms, Int>> {
    val sql = """
      SELECT m.*, (
        SELECT COUNT(*) FROM sms_messages u
        WHERE u.thread_key = m.thread_key AND u.direction = 'IN' AND u.read = 0
      ) AS unread
      FROM sms_messages m
      WHERE m.id = (
        SELECT x.id FROM sms_messages x WHERE x.thread_key = m.thread_key
        ORDER BY x.timestamp DESC, x.id DESC LIMIT 1
      )
      ORDER BY m.timestamp DESC, m.id DESC
      LIMIT ?
    """.trimIndent()
    readableDatabase.rawQuery(sql, arrayOf(limit.toString())).use { c ->
      val out = ArrayList<Pair<StoredSms, Int>>()
      val unreadIdx = c.getColumnIndexOrThrow("unread")
      while (c.moveToNext()) out.add(rowFrom(c) to c.getInt(unreadIdx))
      return out
    }
  }

  /** One thread's messages, newest first, older than `beforeTimestamp` when it is positive. */
  fun messages(threadKey: String, limit: Int, beforeTimestamp: Long): List<StoredSms> {
    val (where, args) = if (beforeTimestamp > 0) {
      "thread_key = ? AND timestamp < ?" to arrayOf(threadKey, beforeTimestamp.toString(), limit.toString())
    } else {
      "thread_key = ?" to arrayOf(threadKey, limit.toString())
    }
    readableDatabase.rawQuery(
      "SELECT * FROM sms_messages WHERE $where ORDER BY timestamp DESC, id DESC LIMIT ?",
      args,
    ).use { c ->
      val out = ArrayList<StoredSms>()
      while (c.moveToNext()) out.add(rowFrom(c))
      return out
    }
  }

  /** Messages stored since JS last acknowledged a batch — what arrived while the UI was not listening. */
  fun undelivered(limit: Int): List<StoredSms> {
    readableDatabase.rawQuery(
      "SELECT * FROM sms_messages WHERE delivered_to_js = 0 ORDER BY id ASC LIMIT ?",
      arrayOf(limit.toString()),
    ).use { c ->
      val out = ArrayList<StoredSms>()
      while (c.moveToNext()) out.add(rowFrom(c))
      return out
    }
  }

  fun markDelivered(upToId: Long) {
    val values = ContentValues().apply { put("delivered_to_js", 1) }
    writableDatabase.update("sms_messages", values, "delivered_to_js = 0 AND id <= ?", arrayOf(upToId.toString()))
  }

  fun markThreadRead(threadKey: String): Int {
    val values = ContentValues().apply { put("read", 1) }
    return writableDatabase.update("sms_messages", values, "thread_key = ? AND read = 0", arrayOf(threadKey))
  }

  /**
   * Removes a thread from VOXO only — the phone's own Messages app keeps it.
   * The tombstone stops the next history import from bringing it straight
   * back; anything newer than it still arrives.
   */
  fun deleteThread(threadKey: String): Int {
    val db = writableDatabase
    db.beginTransaction()
    try {
      var newest = 0L
      db.rawQuery("SELECT MAX(timestamp) FROM sms_messages WHERE thread_key = ?", arrayOf(threadKey)).use {
        if (it.moveToFirst() && !it.isNull(0)) newest = it.getLong(0)
      }
      val values = ContentValues().apply {
        put("thread_key", threadKey)
        put("deleted_before", maxOf(newest, System.currentTimeMillis()))
      }
      db.insertWithOnConflict("deleted_threads", null, values, SQLiteDatabase.CONFLICT_REPLACE)
      val removed = db.delete("sms_messages", "thread_key = ?", arrayOf(threadKey))
      db.setTransactionSuccessful()
      return removed
    } finally {
      db.endTransaction()
    }
  }

  fun count(): Long {
    readableDatabase.rawQuery("SELECT COUNT(*) FROM sms_messages", null).use {
      return if (it.moveToFirst()) it.getLong(0) else 0L
    }
  }

  private fun rowFrom(c: Cursor) = StoredSms(
    id = c.getLong(c.getColumnIndexOrThrow("id")),
    threadKey = c.getString(c.getColumnIndexOrThrow("thread_key")),
    address = c.getString(c.getColumnIndexOrThrow("address")),
    body = c.getString(c.getColumnIndexOrThrow("body")),
    timestamp = c.getLong(c.getColumnIndexOrThrow("timestamp")),
    receivedAt = c.getLong(c.getColumnIndexOrThrow("received_at")),
    direction = c.getString(c.getColumnIndexOrThrow("direction")),
    status = c.getString(c.getColumnIndexOrThrow("status")),
    subscriptionId = c.getInt(c.getColumnIndexOrThrow("subscription_id")),
    simSlot = c.getInt(c.getColumnIndexOrThrow("sim_slot")),
    source = c.getString(c.getColumnIndexOrThrow("source")),
    read = c.getInt(c.getColumnIndexOrThrow("read")) == 1,
  )

  companion object {
    private const val TAG = "VoxoSmsDatabase"
    private const val DB_NAME = "voxo_sms.db"
    private const val DB_VERSION = 1
    const val DEDUP_WINDOW_MS = 120_000L

    private const val FALLBACK_PREFS = "voxo_sms_store_fallback"
    private const val FALLBACK_KEY = "pending"
    private const val FALLBACK_MAX = 500

    @Volatile private var instance: VoxoSmsDatabase? = null

    fun get(context: Context): VoxoSmsDatabase =
      instance ?: synchronized(this) {
        instance ?: VoxoSmsDatabase(context).also { instance = it }
      }

    /**
     * Groups every spelling of one sender into one thread: "+91 98765 43210",
     * "09876543210" and "9876543210" are the same person. Alphanumeric sender
     * ids ("VM-HDFCBK") keep their letters, upper-cased, without punctuation.
     */
    fun threadKeyFor(address: String): String {
      val trimmed = address.trim()
      if (trimmed.any { it.isLetter() }) {
        val cleaned = trimmed.uppercase().filter { it.isLetterOrDigit() }
        return if (cleaned.isEmpty()) trimmed else cleaned
      }
      val digits = trimmed.filter { it.isDigit() }
      return when {
        digits.length >= 10 -> digits.takeLast(10)
        digits.isNotEmpty() -> digits
        else -> trimmed.ifEmpty { "unknown" }
      }
    }

    /** Second precision: the service-centre timestamp and the provider's date_sent are both whole seconds. */
    fun dedupKeyFor(direction: String, threadKey: String, timestamp: Long, body: String): String {
      val raw = "v1|$direction|$threadKey|${timestamp / 1000}|$body"
      val digest = MessageDigest.getInstance("SHA-256").digest(raw.toByteArray(Charsets.UTF_8))
      return digest.joinToString("") { "%02x".format(it) }
    }

    /**
     * Stores the message, or — when SQLite itself fails (disk full, a locked
     * or corrupt file) — parks it in SharedPreferences so it is not lost.
     * [flushFallback] moves parked messages into the table on the next
     * successful open.
     */
    fun storeOrPark(context: Context, sms: NewSms): StoredSms? =
      try {
        val db = get(context)
        db.flushFallback(context)
        db.insertIfNew(sms)
      } catch (e: SQLiteException) {
        Log.e(TAG, "SQLite write failed; parking SMS for retry", e)
        VoxoSmsDiagnostics.recordError(context, "db: ${e.message}")
        park(context, sms)
        null
      } catch (e: IllegalStateException) {
        Log.e(TAG, "SQLite unavailable; parking SMS for retry", e)
        VoxoSmsDiagnostics.recordError(context, "db: ${e.message}")
        park(context, sms)
        null
      }

    @Synchronized
    private fun park(context: Context, sms: NewSms) {
      val prefs = context.getSharedPreferences(FALLBACK_PREFS, Context.MODE_PRIVATE)
      val list = try {
        JSONArray(prefs.getString(FALLBACK_KEY, "[]"))
      } catch (_: Exception) {
        JSONArray()
      }
      if (list.length() >= FALLBACK_MAX) list.remove(0)
      list.put(
        JSONObject()
          .put("address", sms.address)
          .put("body", sms.body)
          .put("timestamp", sms.timestamp)
          .put("receivedAt", sms.receivedAt)
          .put("direction", sms.direction)
          .put("status", sms.status)
          .put("subscriptionId", sms.subscriptionId)
          .put("simSlot", sms.simSlot)
          .put("source", sms.source)
          .put("read", sms.read),
      )
      prefs.edit().putString(FALLBACK_KEY, list.toString()).commit()
    }

    fun parkedCount(context: Context): Int =
      try {
        JSONArray(
          context.getSharedPreferences(FALLBACK_PREFS, Context.MODE_PRIVATE).getString(FALLBACK_KEY, "[]"),
        ).length()
      } catch (_: Exception) {
        0
      }
  }

  /** Moves messages parked by [storeOrPark] into the table. Safe to call often: it is a no-op when nothing is parked. */
  @Synchronized
  fun flushFallback(context: Context): List<StoredSms> {
    val prefs = context.getSharedPreferences(FALLBACK_PREFS, Context.MODE_PRIVATE)
    val raw = prefs.getString(FALLBACK_KEY, null) ?: return emptyList()
    val list = try {
      JSONArray(raw)
    } catch (_: Exception) {
      prefs.edit().remove(FALLBACK_KEY).commit()
      return emptyList()
    }
    val stored = ArrayList<StoredSms>()
    for (i in 0 until list.length()) {
      val o = list.getJSONObject(i)
      insertIfNew(
        NewSms(
          address = o.getString("address"),
          body = o.getString("body"),
          timestamp = o.getLong("timestamp"),
          receivedAt = o.getLong("receivedAt"),
          direction = o.getString("direction"),
          status = o.getString("status"),
          subscriptionId = o.optInt("subscriptionId", -1),
          simSlot = o.optInt("simSlot", -1),
          source = o.getString("source"),
          providerId = null,
          read = o.optBoolean("read", false),
        ),
      )?.let { stored.add(it) }
    }
    // Only cleared once every parked row went in; a failure above throws
    // before this line and leaves them parked for the next attempt.
    prefs.edit().remove(FALLBACK_KEY).commit()
    return stored
  }
}
