package com.opentype.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Lightweight UI prefs readable from any component (services included)
 * without touching encrypted storage or the JS bridge.
 * The app mirrors the relevant settings here on every save.
 */
object UiPrefs {
  private const val FILE = "opentype_ui"

  private fun prefs(context: Context) =
    context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

  fun isBubbleEnabled(context: Context): Boolean =
    prefs(context).getBoolean("bubble_enabled", true)

  fun setBubbleEnabled(context: Context, value: Boolean) {
    prefs(context).edit().putBoolean("bubble_enabled", value).apply()
  }

  fun isOnboardingDone(context: Context): Boolean =
    prefs(context).getBoolean("onboarding_done", false)

  fun setOnboardingDone(context: Context, value: Boolean) {
    prefs(context).edit().putBoolean("onboarding_done", value).apply()
  }

  fun bubbleSize(context: Context): Int =
    prefs(context).getInt("bubble_size", 100).coerceIn(70, 115)

  fun bubbleOpacity(context: Context): Int =
    prefs(context).getInt("bubble_opacity", 80).coerceIn(20, 100)

  fun setBubbleAppearance(context: Context, size: Int, opacity: Int) {
    prefs(context).edit()
      .putInt("bubble_size", size.coerceIn(70, 115))
      .putInt("bubble_opacity", opacity.coerceIn(20, 100))
      .apply()
  }

  /** Full settings JSON snapshot for the headless dictation task. */
  fun setSettingsSnapshot(context: Context, json: String) {
    prefs(context).edit().putString("settings_snapshot", json).apply()
  }

  fun getSettingsSnapshot(context: Context): String? =
    prefs(context).getString("settings_snapshot", null)

  /** History entries completed while the UI was dead. Drained on next foreground. */
  fun enqueuePendingHistory(context: Context, entryJson: String) {
    val p = prefs(context)
    val arr = try {
      JSONArray(p.getString("pending_history", "[]"))
    } catch (_: Exception) {
      JSONArray()
    }
    arr.put(JSONObject(entryJson))
    while (arr.length() > 20) {
      arr.remove(0)
    }
    p.edit().putString("pending_history", arr.toString()).apply()
  }

  fun drainPendingHistory(context: Context): List<String> {
    val p = prefs(context)
    val raw = p.getString("pending_history", "[]") ?: "[]"
    p.edit().putString("pending_history", "[]").apply()
    return try {
      val arr = JSONArray(raw)
      List(arr.length()) { i -> arr.getJSONObject(i).toString() }
    } catch (_: Exception) {
      emptyList()
    }
  }
}
