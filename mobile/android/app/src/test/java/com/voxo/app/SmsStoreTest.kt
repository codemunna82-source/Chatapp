package com.voxo.app

import android.content.Context
import android.content.Intent
import android.provider.Telephony
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.Calendar
import java.util.TimeZone

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SmsStoreTest {
  private lateinit var context: Context
  private lateinit var db: VoxoSmsDatabase

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    db = VoxoSmsDatabase.get(context)
    db.writableDatabase.execSQL("DELETE FROM sms_messages")
    db.writableDatabase.execSQL("DELETE FROM deleted_threads")
  }

  private fun incoming(address: String, body: String, timestamp: Long, receivedAt: Long = timestamp, source: String = "broadcast") =
    NewSms(address, body, timestamp, receivedAt, "IN", "RECEIVED", 1, 0, source, null, false)

  private fun utc(y: Int, mo: Int, d: Int, h: Int, mi: Int, s: Int): Long =
    Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply {
      clear()
      set(y, mo - 1, d, h, mi, s)
    }.timeInMillis

  private fun smsIntent(vararg pdus: ByteArray, extras: Map<String, Int> = emptyMap()) =
    Intent(Telephony.Sms.Intents.SMS_RECEIVED_ACTION).apply {
      putExtra("pdus", pdus.map { it as Any }.toTypedArray())
      putExtra("format", "3gpp")
      extras.forEach { (k, v) -> putExtra(k, v) }
    }

  @Test
  fun threadKeyGroupsEverySpellingOfOneNumber() {
    val key = VoxoSmsDatabase.threadKeyFor("+91 98765 43210")
    assertEquals("9876543210", key)
    assertEquals(key, VoxoSmsDatabase.threadKeyFor("09876543210"))
    assertEquals(key, VoxoSmsDatabase.threadKeyFor("9876543210"))
    assertEquals("VMHDFCBK", VoxoSmsDatabase.threadKeyFor("VM-HDFCBK"))
    assertEquals("56070", VoxoSmsDatabase.threadKeyFor("56070"))
  }

  @Test
  fun multipartSmsIsJoinedInOrderWithOriginalTimestampAndSender() {
    val time = intArrayOf(2026, 10, 12, 9, 30, 15)
    val part1 = SmsTestPdus.deliver("+919876543210", "Hello, this is the first half ", time, Triple(7, 2, 1))
    val part2 = SmsTestPdus.deliver("+919876543210", "and this is the second half.", time, Triple(7, 2, 2))
    val intent = smsIntent(part1, part2, extras = mapOf("subscription" to 3))

    val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent)
    val sub = SmsStoreReceiver.subscriptionIdFrom(intent)
    val messages = SmsStoreReceiver.assemble(parts, receivedAt = utc(2026, 10, 12, 9, 31, 0), subscriptionId = sub, simSlot = 1)

    assertEquals(1, messages.size)
    val sms = messages[0]
    assertEquals("+919876543210", sms.address)
    assertEquals("Hello, this is the first half and this is the second half.", sms.body)
    assertEquals(utc(2026, 10, 12, 9, 30, 15), sms.timestamp)
    assertEquals(3, sms.subscriptionId)
    assertEquals(1, sms.simSlot)
  }

  @Test
  fun aServiceCentreTimeInTheFarFutureFallsBackToReceiveTime() {
    val pdu = SmsTestPdus.deliver("+919876543210", "hi", intArrayOf(2030, 1, 1, 0, 0, 0))
    val receivedAt = utc(2026, 10, 12, 9, 0, 0)
    val sms = SmsStoreReceiver.assemble(Telephony.Sms.Intents.getMessagesFromIntent(smsIntent(pdu)), receivedAt, -1, -1)
    assertEquals(receivedAt, sms[0].timestamp)
  }

  @Test
  fun aRedeliveredBroadcastIsStoredOnce() {
    val t = utc(2026, 10, 12, 9, 0, 0)
    assertNotNull(db.insertIfNew(incoming("+919876543210", "Is the flat available?", t)))
    assertNull(db.insertIfNew(incoming("+919876543210", "Is the flat available?", t, receivedAt = t + 3_000)))
    assertEquals(1L, db.count())
  }

  @Test
  fun anImportOfAMessageTheReceiverAlreadySavedIsSkipped() {
    val sc = utc(2026, 10, 12, 9, 0, 0)
    assertNotNull(db.insertIfNew(incoming("+919876543210", "Hi", sc, receivedAt = sc + 4_000)))
    // An OEM provider that stores only its own receive time, a different spelling of the number.
    val imported = incoming("09876543210", "Hi", sc + 4_500, receivedAt = sc + 4_500, source = "import")
    assertNull(db.insertIfNew(imported))
    assertEquals(1L, db.count())
  }

  @Test
  fun differentMessagesAreAllKept() {
    val t = utc(2026, 10, 12, 9, 0, 0)
    assertNotNull(db.insertIfNew(incoming("+919876543210", "one", t)))
    assertNotNull(db.insertIfNew(incoming("+919876543210", "two", t)))
    assertNotNull(db.insertIfNew(incoming("+919876543210", "one", t + 10 * 60_000)))
    assertNotNull(db.insertIfNew(incoming("+918888888888", "one", t)))
    assertEquals(4L, db.count())
  }

  @Test
  fun threadsShowTheNewestMessageAndUnreadCountUntilRead() {
    val t = utc(2026, 10, 12, 9, 0, 0)
    db.insertIfNew(incoming("+919876543210", "first", t))
    db.insertIfNew(incoming("+919876543210", "second", t + 60_000))
    db.insertIfNew(NewSms("+919876543210", "reply", t + 120_000, t + 120_000, "OUT", "SENT", 1, 0, "voxo", null, true))
    db.insertIfNew(incoming("VM-HDFCBK", "OTP 1234", t + 30_000))

    val threads = db.threads(10)
    assertEquals(2, threads.size)
    val (latest, unread) = threads[0]
    assertEquals("reply", latest.body)
    assertEquals("OUT", latest.direction)
    assertEquals(2, unread)

    db.markThreadRead("9876543210")
    assertEquals(0, db.threads(10)[0].second)

    val messages = db.messages("9876543210", 10, 0)
    assertEquals(listOf("reply", "second", "first"), messages.map { it.body })
    assertEquals(listOf("first"), db.messages("9876543210", 10, t + 60_000).map { it.body })
  }

  @Test
  fun theSameTextFromOnePersonOnDifferentDaysIsKept() {
    val t = utc(2026, 10, 12, 9, 0, 0)
    assertNotNull(db.insertIfNew(incoming("+919876543210", "ok", t)))
    assertNotNull(db.insertIfNew(incoming("+919876543210", "ok", t + 86_400_000L)))
    assertEquals(2, db.messages("9876543210", 10, 0).size)
  }

  @Test
  fun deletingAThreadStopsReimportButNotNewMessages() {
    val t = utc(2026, 10, 12, 9, 0, 0)
    db.insertIfNew(incoming("+919876543210", "old", t))
    db.deleteThread("9876543210")
    assertEquals(0L, db.count())
    assertNull(db.insertIfNew(incoming("+919876543210", "old", t, source = "import")))
    assertNotNull(db.insertIfNew(incoming("+919876543210", "new", System.currentTimeMillis() + 60_000)))
  }

  @Test
  fun undeliveredRowsAreReturnedUntilAcknowledged() {
    val t = utc(2026, 10, 12, 9, 0, 0)
    val a = db.insertIfNew(incoming("+919876543210", "a", t))!!
    val b = db.insertIfNew(incoming("+919876543210", "b", t + 1_000))!!
    assertEquals(listOf(a.id, b.id), db.undelivered(10).map { it.id })
    db.markDelivered(a.id)
    assertEquals(listOf(b.id), db.undelivered(10).map { it.id })
  }

  @Test
  fun storeOrParkStoresAndPublishesNothingForDuplicates() {
    val t = utc(2026, 10, 12, 9, 0, 0)
    assertNotNull(VoxoSmsDatabase.storeOrPark(context, incoming("+919876543210", "x", t)))
    assertNull(VoxoSmsDatabase.storeOrPark(context, incoming("+919876543210", "x", t)))
    assertEquals(0, VoxoSmsDatabase.parkedCount(context))
  }

  @Test
  fun parkedMessagesAreFlushedIntoTheTable() {
    val prefs = context.getSharedPreferences("voxo_sms_store_fallback", Context.MODE_PRIVATE)
    prefs.edit().putString(
      "pending",
      """[{"address":"+919876543210","body":"parked","timestamp":1760000000000,"receivedAt":1760000000000,"direction":"IN","status":"RECEIVED","subscriptionId":-1,"simSlot":-1,"source":"broadcast","read":false}]""",
    ).commit()
    assertEquals(1, VoxoSmsDatabase.parkedCount(context))
    val flushed = db.flushFallback(context)
    assertEquals(listOf("parked"), flushed.map { it.body })
    assertEquals(0, VoxoSmsDatabase.parkedCount(context))
    assertTrue(db.messages("9876543210", 10, 0).any { it.body == "parked" })
  }
}
