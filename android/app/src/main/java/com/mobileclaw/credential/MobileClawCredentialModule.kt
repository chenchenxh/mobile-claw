package com.mobileclaw.credential

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Android native bridge placeholder for secure credential/OAuth callbacks.
 * V1 keeps data local-only; production implementation should use Android Keystore.
 */
class MobileClawCredentialModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "MobileClawCredentialModule"

  @ReactMethod
  fun saveEncrypted(providerId: String, payload: String, promise: Promise) {
    if (providerId.isBlank() || payload.isBlank()) {
      promise.reject("INVALID_INPUT", "providerId/payload cannot be empty")
      return
    }
    // TODO: Replace with Keystore-backed encryption + secure storage.
    promise.resolve("ok")
  }

  @ReactMethod
  fun startOAuth(providerId: String, authUrl: String, promise: Promise) {
    if (providerId.isBlank() || authUrl.isBlank()) {
      promise.reject("INVALID_INPUT", "providerId/authUrl cannot be empty")
      return
    }
    // TODO: Implement custom tab + redirect URI capture.
    promise.resolve("oauth_started")
  }

  @ReactMethod
  fun revoke(credentialRef: String, promise: Promise) {
    if (credentialRef.isBlank()) {
      promise.reject("INVALID_INPUT", "credentialRef cannot be empty")
      return
    }
    promise.resolve("revoked")
  }
}
