package com.voxo.app

import java.io.ByteArrayOutputStream

/** Builds GSM 03.40 SMS-DELIVER PDUs (UCS-2), as a modem would hand them to Android. */
object SmsTestPdus {
  private fun semiOctets(digits: String): ByteArray {
    val padded = if (digits.length % 2 == 1) digits + "F" else digits
    return ByteArray(padded.length / 2) { i ->
      val lo = Character.digit(padded[i * 2], 16)
      val hi = Character.digit(padded[i * 2 + 1], 16)
      ((hi shl 4) or lo).toByte()
    }
  }

  /** Service-centre timestamp, UTC (timezone octet 0). */
  private fun scts(year: Int, month: Int, day: Int, hour: Int, minute: Int, second: Int): ByteArray {
    val s = "%02d%02d%02d%02d%02d%02d00".format(year % 100, month, day, hour, minute, second)
    return semiOctets(s)
  }

  fun deliver(
    sender: String,
    text: String,
    time: IntArray,
    concat: Triple<Int, Int, Int>? = null,
  ): ByteArray {
    val out = ByteArrayOutputStream()
    out.write(0x00) // no SMSC address
    out.write(if (concat != null) 0x44 else 0x04) // SMS-DELIVER, no more messages, UDHI when concatenated
    val international = sender.startsWith("+")
    val digits = sender.removePrefix("+")
    out.write(digits.length)
    out.write(if (international) 0x91 else 0x81)
    out.write(semiOctets(digits))
    out.write(0x00) // PID
    out.write(0x08) // DCS: UCS-2
    out.write(scts(time[0], time[1], time[2], time[3], time[4], time[5]))
    val body = text.toByteArray(Charsets.UTF_16BE)
    val udh = concat?.let { (ref, total, seq) -> byteArrayOf(0x05, 0x00, 0x03, ref.toByte(), total.toByte(), seq.toByte()) }
    out.write((udh?.size ?: 0) + body.size)
    if (udh != null) out.write(udh)
    out.write(body)
    return out.toByteArray()
  }
}
