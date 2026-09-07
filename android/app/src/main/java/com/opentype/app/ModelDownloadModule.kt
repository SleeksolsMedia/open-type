package com.opentype.app

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.net.SocketTimeoutException

/**
 * Bridge for first-party model downloads (see [ModelDownloader]).
 * Each download runs on its own thread; progress flows through the
 * `ModelDownloadProgress` device event keyed by token.
 */
class ModelDownloadModule(private val appContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(appContext) {

  override fun getName(): String = "ModelDownloadModule"

  @ReactMethod
  fun downloadRange(
    url: String,
    dest: String,
    offset: Double,
    token: String,
    promise: Promise,
  ) {
    Thread({
      try {
        var lastEmitted = 0L
        val result = ModelDownloader.download(
          url,
          dest,
          offset.toLong(),
          token,
          object : ModelDownloader.ProgressListener {
            override fun onBytes(receivedThisCall: Long) {
              if (receivedThisCall - lastEmitted >= 256 * 1024 || receivedThisCall == 0L) {
                lastEmitted = receivedThisCall
                emitProgress(token, receivedThisCall)
              }
            }
          },
        )
        // Final progress tick so JS accounting closes exactly.
        emitProgress(token, -1L)
        val map = Arguments.createMap()
        map.putInt("status", result.status)
        map.putDouble("total", result.totalBytes.toDouble())
        map.putString("finalUrl", result.finalUrl)
        map.putBoolean("acceptRanges", result.acceptRanges)
        promise.resolve(map)
      } catch (e: DownloadCancelled) {
        promise.reject("CANCELLED", "Cancelled.")
      } catch (e: DownloadTimeout) {
        promise.reject("TIMEOUT", e.message)
      } catch (e: FetchStatusException) {
        promise.reject("HTTP_${e.status}", e.message)
      } catch (e: SocketTimeoutException) {
        promise.reject("TIMEOUT", "Stalled (no data for 30s).")
      } catch (e: Exception) {
        promise.reject("NETWORK", e.message ?: "Download failed.")
      }
    }, "model-download").apply { isDaemon = true; start() }
  }

  @ReactMethod
  fun cancelDownload(token: String, promise: Promise) {
    try {
      ModelDownloader.cancel(token)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("CANCEL_ERROR", e.message, e)
    }
  }

  private fun emitProgress(token: String, received: Long) {
    try {
      val map = Arguments.createMap()
      map.putString("token", token)
      map.putDouble("received", received.toDouble())
      appContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("ModelDownloadProgress", map)
    } catch (_: Exception) {
    }
  }
}
