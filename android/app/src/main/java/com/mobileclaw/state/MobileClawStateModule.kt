package com.mobileclaw.state

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class MobileClawStateModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val prefs = reactContext.getSharedPreferences("mobileclaw_state", 0)

  override fun getName(): String = "MobileClawStateModule"

  @ReactMethod
  fun saveState(json: String, promise: Promise) {
    try {
      prefs.edit().putString("state_json", json).apply()
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("SAVE_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun loadState(promise: Promise) {
    try {
      val raw = prefs.getString("state_json", null)
      promise.resolve(raw)
    } catch (e: Exception) {
      promise.reject("LOAD_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun clearState(promise: Promise) {
    try {
      prefs.edit().remove("state_json").apply()
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("CLEAR_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun savePreference(key: String, value: String, promise: Promise) {
    if (key.isBlank()) {
      promise.reject("INVALID_KEY", "preference key cannot be empty")
      return
    }
    try {
      prefs.edit().putString("pref_$key", value).apply()
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("SAVE_PREFERENCE_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun loadPreference(key: String, promise: Promise) {
    if (key.isBlank()) {
      promise.reject("INVALID_KEY", "preference key cannot be empty")
      return
    }
    try {
      val raw = prefs.getString("pref_$key", null)
      promise.resolve(raw)
    } catch (e: Exception) {
      promise.reject("LOAD_PREFERENCE_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun removePreference(key: String, promise: Promise) {
    if (key.isBlank()) {
      promise.reject("INVALID_KEY", "preference key cannot be empty")
      return
    }
    try {
      prefs.edit().remove("pref_$key").apply()
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("REMOVE_PREFERENCE_FAILED", e.message, e)
    }
  }
}
