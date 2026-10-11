package com.voxo.app

import android.content.Context
import android.os.Build
import android.telephony.SmsManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * JS's only way to reach SmsAutoReplyReceiver, which cannot take a prop
 * or read a query — it is woken by the OS, not by React. Settings writes
 * the on/off switch and the resolved reply text (template + personal
 * link) here every time either changes, so the receiver always has a
 * same plain SharedPreferences file both sides read and write, picked
 * over react-native-mmkv (already used elsewhere in the app) because a
 * Kotlin file outside that library's own module cannot safely assume
 * which of its internal classes are exposed to the app module's own
 * classpath.
 */
class VoxoSmsAutoReplyModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "VoxoSmsAutoReply"

  @ReactMethod
  fun setConfig(enabled: Boolean, replyText: String) {
    prefs().edit()
      .putBoolean(KEY_ENABLED, enabled)
      .putString(KEY_REPLY_TEXT, replyText)
      .apply()
  }

  @ReactMethod
  fun getStatus(promise: Promise) {
    val map = com.facebook.react.bridge.Arguments.createMap()
    map.putBoolean("enabled", prefs().getBoolean(KEY_ENABLED, false))
    map.putInt("repliedCount", prefs().getInt(KEY_REPLIED_COUNT, 0))
    promise.resolve(map)
  }

  private fun prefs() =
    reactApplicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  companion object {
    const val PREFS_NAME = "voxo_sms_auto_reply"
    const val KEY_ENABLED = "enabled"
    const val KEY_REPLY_TEXT = "reply_text"
    const val KEY_REPLIED_COUNT = "replied_count"
    const val EXTRA_SENDER = "sender"
    const val EXTRA_BODY = "body"

    /**
     * How long a reply waits before actually going out, picked at random
     * per sender — see SmsAutoReplyReceiver for why: several leads
     * texting in close together must not turn into a burst of SMS sent
     * back to back, which both a carrier's own anti-spam filtering and
     * Android's own "this app is sending a lot of messages" prompt can
     * flag — and the second one has no UI to answer it from a receiver
     * with no activity in front of it.
     */
    const val MIN_REPLY_DELAY_MS = 10_000L
    const val MAX_REPLY_DELAY_MS = 90_000L

    /** One per sender, forever — never reply twice to the same number. */
    fun repliedKeyFor(sender: String): String = "replied_to:$sender"

    /**
     * getDefault() is deprecated from API 31 on — the system-service
     * lookup is its replacement, but only exists from API 31 on too, so
     * minSdk 24 still needs the old call as a fallback.
     */
    fun getSmsManager(context: Context): SmsManager =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        context.getSystemService(SmsManager::class.java)
      } else {
        @Suppress("DEPRECATION")
        SmsManager.getDefault()
      }
  }
}
