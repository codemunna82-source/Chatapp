package com.voxo.app

import android.content.Context
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

    /** One per sender, forever — never reply twice to the same number. */
    fun repliedKeyFor(sender: String): String = "replied_to:$sender"
  }
}
