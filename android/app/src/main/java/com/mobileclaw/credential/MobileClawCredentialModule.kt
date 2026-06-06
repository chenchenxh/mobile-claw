package com.mobileclaw.credential

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.browser.customtabs.CustomTabsIntent
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

class MobileClawCredentialModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val securePrefs = reactContext.getSharedPreferences("mobileclaw_secure_store", Context.MODE_PRIVATE)
  private val random = SecureRandom()

  override fun getName(): String = "MobileClawCredentialModule"

  @ReactMethod
  fun saveEncrypted(providerId: String, payload: String, promise: Promise) {
    if (providerId.isBlank() || payload.isBlank()) {
      promise.reject("INVALID_INPUT", "providerId/payload cannot be empty")
      return
    }
    try {
      val encrypted = encrypt(payload)
      securePrefs.edit().putString("enc_${safeKey(providerId)}", encrypted).apply()
      promise.resolve("ok")
    } catch (e: Exception) {
      promise.reject("SAVE_ENCRYPTED_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun startOAuth(providerId: String, authUrl: String, promise: Promise) {
    if (providerId.isBlank() || authUrl.isBlank()) {
      promise.reject("INVALID_INPUT", "providerId/authUrl cannot be empty")
      return
    }

    try {
      val uri = Uri.parse(authUrl)
      val activity = currentActivity
      if (activity != null) {
        val customTabsIntent = CustomTabsIntent.Builder()
          .setShowTitle(true)
          .build()
        customTabsIntent.intent.addFlags(Intent.FLAG_ACTIVITY_NO_HISTORY)
        customTabsIntent.launchUrl(activity, uri)
      } else {
        val fallback = Intent(Intent.ACTION_VIEW, uri).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        reactApplicationContext.startActivity(fallback)
      }
      promise.resolve("oauth_started")
    } catch (e: Exception) {
      promise.reject("START_OAUTH_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun createPkce(promise: Promise) {
    try {
      val bytes = ByteArray(32)
      random.nextBytes(bytes)
      val verifier = base64Url(bytes)
      val digest = MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII))
      val challenge = base64Url(digest)
      val result = com.facebook.react.bridge.Arguments.createMap()
      result.putString("verifier", verifier)
      result.putString("challenge", challenge)
      promise.resolve(result)
    } catch (e: Exception) {
      promise.reject("PKCE_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun revoke(credentialRef: String, promise: Promise) {
    if (credentialRef.isBlank()) {
      promise.reject("INVALID_INPUT", "credentialRef cannot be empty")
      return
    }
    try {
      securePrefs.edit().remove("enc_${safeKey(credentialRef)}").apply()
      promise.resolve("revoked")
    } catch (e: Exception) {
      promise.reject("REVOKE_FAILED", e.message, e)
    }
  }

  private fun encrypt(plain: String): String {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, getOrCreateSecretKey())
    val iv = cipher.iv
    val encrypted = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
    return "${base64(iv)}:${base64(encrypted)}"
  }

  private fun getOrCreateSecretKey(): SecretKey {
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply {
      load(null)
    }
    val alias = "mobileclaw_master_key"
    val existing = keyStore.getKey(alias, null)
    if (existing is SecretKey) return existing

    val keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    val spec = KeyGenParameterSpec.Builder(
      alias,
      KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
    )
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setRandomizedEncryptionRequired(true)
      .build()
    keyGenerator.init(spec)
    return keyGenerator.generateKey()
  }

  private fun safeKey(raw: String): String {
    return raw.replace(":", "_").replace("/", "_")
  }

  private fun base64(bytes: ByteArray): String {
    return Base64.encodeToString(bytes, Base64.NO_WRAP)
  }

  private fun base64Url(bytes: ByteArray): String {
    return Base64.encodeToString(bytes, Base64.NO_WRAP or Base64.URL_SAFE).replace("=", "")
  }
}
