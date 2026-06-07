package com.mobileclaw.state

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class MobileClawClipboardModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "MobileClawClipboard"

  @ReactMethod
  fun setString(label: String, text: String, promise: Promise) {
    try {
      val clipboard = reactContext.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
      clipboard.setPrimaryClip(ClipData.newPlainText(label.ifBlank { "MobileClaw Log" }, text))
      promise.resolve(true)
    } catch (err: Exception) {
      promise.reject("CLIPBOARD_FAILED", err.message, err)
    }
  }
}
