package com.opentype.app

import android.content.ClipData
import android.content.ClipboardManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Bridge for overlay bubble, audio capture, text insertion, encrypted
 * credential storage, and UI prefs. Recording itself lives in
 * [RecordingController] (shared with the overlay panel); every method
 * rejects with a clear message instead of crashing.
 */
class DictationModule(private val appContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(appContext) {

  override fun getName(): String = "DictationModule"

  // ---- Bubble service --------------------------------------------------------

  @ReactMethod
  fun showBubble(promise: Promise) {
    try {
      OverlayService.start(appContext)
      OverlayService.showView(appContext)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("BUBBLE_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun hideBubble(promise: Promise) {
    try {
      OverlayService.hideView(appContext)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("BUBBLE_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun isOverlayPermissionGranted(promise: Promise) {
    promise.resolve(Settings.canDrawOverlays(appContext))
  }

  @ReactMethod
  fun requestOverlayPermission(promise: Promise) {
    try {
      val intent = Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        Uri.parse("package:${appContext.packageName}"),
      ).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
      appContext.startActivity(intent)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("OVERLAY_PERMISSION_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun isAccessibilityEnabled(promise: Promise) {
    try {
      val expected = ComponentName(
        appContext,
        DictationAccessibilityService::class.java,
      ).flattenToString()
      val enabled = Settings.Secure.getString(
        appContext.contentResolver,
        Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
      ) ?: ""
      val on = enabled.split(':').any { it.equals(expected, ignoreCase = true) }
      promise.resolve(on)
    } catch (e: Exception) {
      promise.reject("A11Y_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun openAccessibilitySettings(promise: Promise) {
    try {
      appContext.startActivity(
        Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        },
      )
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("A11Y_ERROR", e.message, e)
    }
  }

  // ---- Audio capture (delegates to RecordingController) ----------------------

  private val recordListener = object : RecordingController.Listener {
    override fun onAutoStop(path: String) {
      RecordingController.noteFinished(appContext)
      RecordingController.setFrameListener(null)
      emit("RecordingAutoStopped", path)
    }
  }

  private val frameForwarder = object : RecordingController.FrameListener {
    override fun onFrame(base64Pcm16Mono: String) {
      emit("AudioFrame", base64Pcm16Mono)
    }
  }

  /** Live PCM frames for streaming transcription. File recording continues. */
  @ReactMethod
  fun setFrameStreaming(enabled: Boolean, promise: Promise) {
    try {
      RecordingController.setFrameListener(if (enabled) frameForwarder else null)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("STREAM_ERROR", e.message, e)
    }
  }

  /**
   * Bounded frame queue for headless consumers (bubble live flow).
   * Enable before recording, drain after stop, disable when done.
   */
  @ReactMethod
  fun setQueueFrames(enabled: Boolean, promise: Promise) {
    try {
      RecordingController.setQueueFrames(enabled)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("STREAM_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun drainAudioFrames(promise: Promise) {
    try {
      val arr = Arguments.createArray()
      RecordingController.drainQueuedFrames().forEach { arr.pushString(it) }
      promise.resolve(arr)
    } catch (e: Exception) {
      promise.reject("STREAM_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun consumeDroppedFrames(promise: Promise) {
    try {
      promise.resolve(RecordingController.consumeDroppedFrames())
    } catch (e: Exception) {
      promise.reject("STREAM_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun startRecording(promise: Promise) {
    try {
      promise.resolve(RecordingController.start(appContext, recordListener))
    } catch (e: RecordingException) {
      val code = if (e.message == "Microphone permission not granted.") {
        "MIC_PERMISSION"
      } else {
        "RECORD_ERROR"
      }
      promise.reject(code, e.message, e)
    } catch (e: Exception) {
      promise.reject("RECORD_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun stopRecording(promise: Promise) {
    try {
      val path = RecordingController.stop()
      RecordingController.setFrameListener(null)
      RecordingController.noteFinished(appContext)
      promise.resolve(path)
    } catch (e: RecordingException) {
      RecordingController.noteFinished(appContext)
      promise.reject("RECORD_ERROR", e.message, e)
    } catch (e: Exception) {
      promise.reject("RECORD_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun cancelRecording(promise: Promise) {
    try {
      RecordingController.cancel()
      RecordingController.setFrameListener(null)
      RecordingController.noteFinished(appContext)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("RECORD_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun getRecorderState(promise: Promise) {
    try {
      val s = RecordingController.getState()
      val map: WritableMap = Arguments.createMap()
      map.putBoolean("recording", s.recording)
      map.putDouble("amplitude", s.amplitude.toDouble())
      map.putDouble("durationMs", s.durationMs.toDouble())
      map.putDouble("sizeBytes", s.sizeBytes.toDouble())
      promise.resolve(map)
    } catch (e: Exception) {
      promise.reject("RECORD_ERROR", e.message, e)
    }
  }

  private fun emit(event: String, data: Any?) {
    try {
      appContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(event, data)
    } catch (_: Exception) {
    }
  }

  // ---- Crash recovery --------------------------------------------------------

  /** A recording that never finalized (app killed mid-record). */
  @ReactMethod
  fun getInterruptedRecording(promise: Promise) {
    try {
      promise.resolve(RecordingController.readPending(appContext))
    } catch (e: Exception) {
      promise.reject("RECOVERY_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun discardInterruptedRecording(promise: Promise) {
    try {
      RecordingController.discardPending(appContext)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("RECOVERY_ERROR", e.message, e)
    }
  }

  // ---- Text insertion --------------------------------------------------------

  @ReactMethod
  fun insertText(text: String, promise: Promise) {
    try {
      promise.resolve(DictationAccessibilityService.insertText(text))
    } catch (e: Exception) {
      promise.reject("INSERT_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun copyToClipboard(text: String, promise: Promise) {
    try {
      val clipboard =
        appContext.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
      clipboard.setPrimaryClip(ClipData.newPlainText("opentype", text))
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("CLIPBOARD_ERROR", e.message, e)
    }
  }

  // ---- Encrypted credential storage ------------------------------------------

  @ReactMethod
  fun secureSet(key: String, value: String, promise: Promise) {
    try {
      SecureStore.set(appContext, key, value)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("STORE_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun secureGet(key: String, promise: Promise) {
    try {
      promise.resolve(SecureStore.get(appContext, key))
    } catch (e: Exception) {
      promise.reject("STORE_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun secureDelete(key: String, promise: Promise) {
    try {
      SecureStore.delete(appContext, key)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("STORE_ERROR", e.message, e)
    }
  }

  /**
   * Returns the MMKV encryption key, creating a 256-bit random one on first
   * run. The key itself lives in Keystore-backed encrypted preferences.
   */
  @ReactMethod
  fun getOrCreateStorageKey(promise: Promise) {
    try {
      val existing = SecureStore.get(appContext, "mmkv-key")
      if (existing != null) {
        promise.resolve(existing)
        return
      }
      val bytes = ByteArray(32)
      java.security.SecureRandom().nextBytes(bytes)
      val key = android.util.Base64.encodeToString(
        bytes,
        android.util.Base64.NO_WRAP,
      )
      SecureStore.set(appContext, "mmkv-key", key)
      promise.resolve(key)
    } catch (e: Exception) {
      promise.reject("STORE_ERROR", e.message, e)
    }
  }

  // ---- Battery exemption -----------------------------------------------------

  @ReactMethod
  fun isBatteryExempt(promise: Promise) {
    try {
      val pm = appContext.getSystemService(Context.POWER_SERVICE) as PowerManager
      promise.resolve(pm.isIgnoringBatteryOptimizations(appContext.packageName))
    } catch (e: Exception) {
      promise.reject("BATTERY_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun requestBatteryExemption(promise: Promise) {
    try {
      appContext.startActivity(
        Intent(
          Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
          Uri.parse("package:${appContext.packageName}"),
        ).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) },
      )
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("BATTERY_ERROR", e.message, e)
    }
  }

  // ---- Bubble prefs + headless-task support ----------------------------------

  @ReactMethod
  fun isBubbleEnabled(promise: Promise) {
    try {
      promise.resolve(UiPrefs.isBubbleEnabled(appContext))
    } catch (e: Exception) {
      promise.reject("PREFS_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun setBubbleEnabled(enabled: Boolean, promise: Promise) {
    try {
      UiPrefs.setBubbleEnabled(appContext, enabled)
      if (enabled) {
        OverlayService.start(appContext)
      } else {
        OverlayService.hideView(appContext)
      }
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("PREFS_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun setBubbleAppearance(size: Int, opacity: Int, promise: Promise) {
    try {
      UiPrefs.setBubbleAppearance(appContext, size, opacity)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("PREFS_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun setOnboardingComplete(promise: Promise) {
    try {
      UiPrefs.setOnboardingDone(appContext, true)
      // (Re)start the bubble service now that the app may run backgrounded.
      if (UiPrefs.isBubbleEnabled(appContext)) {
        OverlayService.start(appContext)
      }
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("PREFS_ERROR", e.message, e)
    }
  }

  /** Mirror of the JS settings for the headless dictation task. */
  @ReactMethod
  fun syncSettingsSnapshot(json: String, promise: Promise) {
    try {
      UiPrefs.setSettingsSnapshot(appContext, json)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("PREFS_ERROR", e.message, e)
    }
  }

  /**
   * Called by the headless dictation task. Persists the history entry for
   * the UI to drain, and forwards the result to the overlay panel if open.
   */
  @ReactMethod
  fun reportDictationResult(ok: Boolean, message: String, entryJson: String?, promise: Promise) {
    try {
      if (entryJson != null) {
        UiPrefs.enqueuePendingHistory(appContext, entryJson)
      }
      try {
        DictationResultRelay.listener?.invoke(ok, message)
      } catch (_: Exception) {
      }
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("REPORT_ERROR", e.message, e)
    }
  }

  /** History entries completed while the UI was dead. Cleared on read. */
  @ReactMethod
  fun drainPendingHistory(promise: Promise) {
    try {
      val arr = Arguments.createArray()
      UiPrefs.drainPendingHistory(appContext).forEach { arr.pushString(it) }
      promise.resolve(arr)
    } catch (e: Exception) {
      promise.reject("PREFS_ERROR", e.message, e)
    }
  }
}
