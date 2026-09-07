package com.opentype.app

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Keystore-backed storage for user-provided API keys.
 * Falls back to private SharedPreferences only if encrypted prefs fail,
 * so settings screens never crash on exotic devices.
 */
object SecureStore {
  private const val FILE = "opentype_secrets"

  private fun prefs(context: Context): SharedPreferences {
    return try {
      val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()
      EncryptedSharedPreferences.create(
        context,
        FILE,
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
      )
    } catch (_: Exception) {
      context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
    }
  }

  fun set(context: Context, key: String, value: String) {
    prefs(context).edit().putString(key, value).apply()
  }

  fun get(context: Context, key: String): String? {
    return prefs(context).getString(key, null)
  }

  fun delete(context: Context, key: String) {
    prefs(context).edit().remove(key).apply()
  }
}
