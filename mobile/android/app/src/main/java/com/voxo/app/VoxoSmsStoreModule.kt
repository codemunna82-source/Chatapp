package com.voxo.app

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.database.sqlite.SQLiteException
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Telephony
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import java.util.concurrent.Executors

/**
 * JS's window onto the on-device SMS store (VoxoSmsDatabase). Reads, history
 * import, read/delete state, and a live "VoxoSmsReceived" event while a JS
 * subscriber exists. Every database call runs off the JS thread.
 *
 * Nothing in here talks to the network.
 */
class VoxoSmsStoreModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private var listenerCount = 0

  override fun getName(): String = "VoxoSmsStore"

  override fun invalidate() {
    VoxoSmsEvents.listener = null
    super.invalidate()
  }

  private fun db() = VoxoSmsDatabase.get(reactApplicationContext)

  /** Runs [block] on the store's thread and maps SQLite failures to a rejected promise instead of a crash. */
  private fun run(promise: Promise, block: () -> Any?) {
    executor.execute {
      try {
        promise.resolve(block())
      } catch (e: SQLiteException) {
        VoxoSmsDiagnostics.recordError(reactApplicationContext, "db: ${e.message}")
        promise.reject("SMS_DB_ERROR", e.message ?: "SMS database error", e)
      } catch (e: SecurityException) {
        promise.reject("SMS_PERMISSION", e.message ?: "SMS permission missing", e)
      } catch (e: Exception) {
        promise.reject("SMS_STORE_ERROR", e.message ?: "SMS store error", e)
      }
    }
  }

  @ReactMethod
  fun getPermissionStatus(promise: Promise) {
    val ctx = reactApplicationContext
    val map = Arguments.createMap()
    map.putBoolean("receiveSms", granted(ctx, Manifest.permission.RECEIVE_SMS))
    map.putBoolean("readSms", granted(ctx, Manifest.permission.READ_SMS))
    map.putBoolean("sendSms", granted(ctx, Manifest.permission.SEND_SMS))
    map.putBoolean("readPhoneState", granted(ctx, Manifest.permission.READ_PHONE_STATE))
    map.putBoolean("isDefaultSmsApp", Telephony.Sms.getDefaultSmsPackage(ctx) == ctx.packageName)
    val power = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
    map.putBoolean("ignoringBatteryOptimizations", power.isIgnoringBatteryOptimizations(ctx.packageName))
    map.putInt("sdkInt", Build.VERSION.SDK_INT)
    map.putString("manufacturer", Build.MANUFACTURER)
    map.putString("model", Build.MODEL)
    promise.resolve(map)
  }

  @ReactMethod
  fun getThreads(limit: Int, promise: Promise) = run(promise) {
    db().flushFallback(reactApplicationContext)
    val out = Arguments.createArray()
    for ((row, unread) in db().threads(limit.coerceIn(1, 2000))) {
      val map = toMap(row)
      map.putInt("unreadCount", unread)
      out.pushMap(map)
    }
    out
  }

  @ReactMethod
  fun getMessages(address: String, limit: Int, beforeTimestamp: Double, promise: Promise) = run(promise) {
    toArray(db().messages(VoxoSmsDatabase.threadKeyFor(address), limit.coerceIn(1, 1000), beforeTimestamp.toLong()))
  }

  @ReactMethod
  fun markThreadRead(address: String, promise: Promise) = run(promise) {
    db().markThreadRead(VoxoSmsDatabase.threadKeyFor(address))
  }

  @ReactMethod
  fun deleteMessage(id: Double, promise: Promise) = run(promise) {
    db().deleteMessage(id.toLong())
  }

  @ReactMethod
  fun deleteThread(address: String, promise: Promise) = run(promise) {
    db().deleteThread(VoxoSmsDatabase.threadKeyFor(address))
  }

  @ReactMethod
  fun getUndelivered(limit: Int, promise: Promise) = run(promise) {
    db().flushFallback(reactApplicationContext)
    toArray(db().undelivered(limit.coerceIn(1, 1000)))
  }

  @ReactMethod
  fun markDelivered(upToId: Double, promise: Promise) = run(promise) {
    db().markDelivered(upToId.toLong())
    true
  }

  /**
   * Copies the phone's existing SMS (inbox and sent) into the store. With
   * `sinceMs` > 0 only messages from that time on are read — the incremental
   * pass run on every app open, which also recovers anything the receiver
   * missed (a force-stopped app, a broadcast an OEM suppressed). Duplicates
   * are skipped by the store's own dedup. Needs READ_SMS.
   */
  @ReactMethod
  fun importHistory(maxPerBox: Int, sinceMs: Double, promise: Promise) = run(promise) {
    val ctx = reactApplicationContext
    if (!granted(ctx, Manifest.permission.READ_SMS)) {
      throw SecurityException("READ_SMS is not granted")
    }
    val limit = maxPerBox.coerceIn(1, 20_000)
    val since = sinceMs.toLong()
    val inbox = importBox(Telephony.Sms.Inbox.CONTENT_URI, "IN", limit, since)
    val sent = importBox(Telephony.Sms.Sent.CONTENT_URI, "OUT", limit, since)
    VoxoSmsDiagnostics.recordImport(ctx)
    val result = Arguments.createMap()
    result.putInt("scanned", inbox.first + sent.first)
    result.putInt("imported", inbox.second + sent.second)
    result
  }

  private fun importBox(uri: Uri, direction: String, limit: Int, since: Long): Pair<Int, Int> {
    val selection = if (since > 0) "date >= ?" else null
    val args = if (since > 0) arrayOf(since.toString()) else null
    var scanned = 0
    var imported = 0
    val cursor = reactApplicationContext.contentResolver.query(uri, null, selection, args, "date DESC")
      ?: return 0 to 0
    cursor.use { c ->
      val idIdx = c.getColumnIndex(Telephony.Sms._ID)
      val addressIdx = c.getColumnIndex(Telephony.Sms.ADDRESS)
      val bodyIdx = c.getColumnIndex(Telephony.Sms.BODY)
      val dateIdx = c.getColumnIndex(Telephony.Sms.DATE)
      val dateSentIdx = c.getColumnIndex(Telephony.Sms.DATE_SENT)
      val readIdx = c.getColumnIndex(Telephony.Sms.READ)
      val subIdx = c.getColumnIndex(Telephony.Sms.SUBSCRIPTION_ID)
      while (scanned < limit && c.moveToNext()) {
        scanned++
        val address = if (addressIdx >= 0) c.getString(addressIdx) else null
        val body = if (bodyIdx >= 0) c.getString(bodyIdx) else null
        if (address.isNullOrBlank() || body == null) continue
        val date = if (dateIdx >= 0) c.getLong(dateIdx) else 0L
        val dateSent = if (dateSentIdx >= 0) c.getLong(dateSentIdx) else 0L
        val subId = if (subIdx >= 0) c.getInt(subIdx) else -1
        val original = if (direction == "IN" && dateSent > 0) dateSent else date
        val row = VoxoSmsDatabase.storeOrPark(
          reactApplicationContext,
          NewSms(
            address = address,
            body = body,
            timestamp = original,
            receivedAt = date,
            direction = direction,
            status = if (direction == "IN") "RECEIVED" else "SENT",
            subscriptionId = subId,
            simSlot = slotFor(subId),
            source = "import",
            providerId = if (idIdx >= 0) c.getLong(idIdx) else null,
            // Outgoing is always "read"; incoming keeps the phone's own read state.
            read = direction == "OUT" || (readIdx >= 0 && c.getInt(readIdx) == 1),
          ),
        )
        if (row != null) imported++
      }
    }
    return scanned to imported
  }

  @ReactMethod
  fun getDiagnostics(promise: Promise) = run(promise) {
    val ctx = reactApplicationContext
    val snap = VoxoSmsDiagnostics.snapshot(ctx)
    val map = Arguments.createMap()
    map.putDouble("storedMessages", db().count().toDouble())
    map.putInt("parkedMessages", VoxoSmsDatabase.parkedCount(ctx))
    map.putDouble("lastBroadcastAt", snap.lastBroadcastAt.toDouble())
    map.putDouble("broadcastCount", snap.broadcastCount.toDouble())
    map.putDouble("storedFromBroadcasts", snap.storedCount.toDouble())
    map.putDouble("duplicateBroadcasts", snap.duplicateCount.toDouble())
    map.putDouble("lastImportAt", snap.lastImportAt.toDouble())
    if (snap.lastError != null) map.putString("lastError", snap.lastError) else map.putNull("lastError")
    map.putDouble("lastErrorAt", snap.lastErrorAt.toDouble())
    map
  }

  // NativeEventEmitter contract. The listener is only installed while JS has a subscriber.
  @ReactMethod
  fun addListener(@Suppress("UNUSED_PARAMETER") eventName: String) {
    listenerCount++
    if (listenerCount == 1) {
      VoxoSmsEvents.listener = { rows ->
        val ctx = reactApplicationContext
        if (ctx.hasActiveReactInstance()) {
          val payload = Arguments.createMap()
          payload.putArray("messages", toArray(rows))
          ctx.emitDeviceEvent(EVENT_RECEIVED, payload)
        }
      }
    }
  }

  @ReactMethod
  fun removeListeners(count: Double) {
    listenerCount = (listenerCount - count.toInt()).coerceAtLeast(0)
    if (listenerCount == 0) VoxoSmsEvents.listener = null
  }

  companion object {
    const val EVENT_RECEIVED = "VoxoSmsReceived"
    private val executor = Executors.newSingleThreadExecutor()

    fun granted(ctx: Context, permission: String) =
      ContextCompat.checkSelfPermission(ctx, permission) == PackageManager.PERMISSION_GRANTED

    fun slotFor(subscriptionId: Int): Int =
      if (subscriptionId >= 0 && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        android.telephony.SubscriptionManager.getSlotIndex(subscriptionId)
      } else {
        -1
      }

    fun toMap(row: StoredSms): WritableMap {
      val map = Arguments.createMap()
      map.putDouble("id", row.id.toDouble())
      map.putString("threadKey", row.threadKey)
      map.putString("address", row.address)
      map.putString("body", row.body)
      map.putDouble("timestamp", row.timestamp.toDouble())
      map.putDouble("receivedAt", row.receivedAt.toDouble())
      map.putString("direction", row.direction)
      map.putString("status", row.status)
      map.putInt("subscriptionId", row.subscriptionId)
      map.putInt("simSlot", row.simSlot)
      map.putString("source", row.source)
      map.putBoolean("read", row.read)
      return map
    }

    fun toArray(rows: List<StoredSms>): WritableArray {
      val out = Arguments.createArray()
      for (row in rows) out.pushMap(toMap(row))
      return out
    }
  }
}
