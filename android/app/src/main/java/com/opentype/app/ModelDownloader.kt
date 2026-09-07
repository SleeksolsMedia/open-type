package com.opentype.app

import android.util.Log
import java.io.File
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.SocketTimeoutException
import java.net.URL
import java.util.concurrent.ConcurrentHashMap

class DownloadCancelled : Exception("Cancelled.")
class DownloadTimeout(bytesSoFar: Long) :
  Exception("Stalled (no data for 30s) at ${(bytesSoFar / 1024 / 1024)} MB.")

/**
 * First-party ranged file downloader. Replaces the third-party networking
 * stack for model downloads after it proved unable to complete transfers
 * from the model CDN on real networks ("Download interrupted" at 0 bytes).
 *
 * Every hop and decision is logged (TAG) so a failure always names
 * its cause: DNS results, redirects, status codes, byte counts.
 */
object ModelDownloader {
  private const val TAG = "ModelDownloader"
  private const val CONNECT_TIMEOUT_MS = 20000
  private const val READ_TIMEOUT_MS = 30000
  private const val MAX_REDIRECTS = 5

  interface ProgressListener {
    fun onBytes(receivedThisCall: Long)
  }

  data class Result(
    val status: Int,
    val totalBytes: Long,
    val finalUrl: String,
    val acceptRanges: Boolean,
  )

  private val connections = ConcurrentHashMap<String, HttpURLConnection>()
  private val cancelled = ConcurrentHashMap<String, Boolean>()

  fun cancel(token: String) {
    cancelled[token] = true
    try {
      connections[token]?.disconnect()
    } catch (_: Exception) {
    }
  }

  private fun isCancelled(token: String): Boolean = cancelled[token] == true

  @Throws(DownloadCancelled::class, DownloadTimeout::class, java.io.IOException::class)
  fun download(
    url: String,
    destPath: String,
    offset: Long,
    token: String,
    listener: ProgressListener?,
  ): Result {
    cancelled.remove(token)
    try {
      return downloadInner(url, destPath, offset, token, listener)
    } finally {
      connections.remove(token)
      cancelled.remove(token)
    }
  }

  @Throws(DownloadCancelled::class, DownloadTimeout::class, java.io.IOException::class)
  private fun downloadInner(
    startUrl: String,
    destPath: String,
    offset: Long,
    token: String,
    listener: ProgressListener?,
  ): Result {
    // DNS diagnostics first: a broken route here explains everything after.
    try {
      val host = URL(startUrl).host
      val addrs = InetAddress.getAllByName(host)
      addrs.forEach { Log.i(TAG, "DNS $host → ${it.hostAddress}") }
    } catch (e: Exception) {
      Log.w(TAG, "DNS failed for $startUrl: ${e.message}")
      throw java.io.IOException("DNS failed: ${e.message}")
    }

    // Manual redirect chain (logged per hop).
    var current = startUrl
    var status: Int
    var connection: HttpURLConnection
    var hops = 0
    while (true) {
      if (isCancelled(token)) {
        throw DownloadCancelled()
      }
      val conn = (URL(current).openConnection() as HttpURLConnection).apply {
        instanceFollowRedirects = false
        connectTimeout = CONNECT_TIMEOUT_MS
        readTimeout = READ_TIMEOUT_MS
        setRequestProperty("Range", "bytes=$offset-")
        setRequestProperty("User-Agent", "OpenType/1.0 (model download)")
        setRequestProperty("Accept-Encoding", "identity")
      }
      connections[token] = conn
      try {
        conn.connect()
      } catch (e: SocketTimeoutException) {
        throw DownloadTimeout(0)
      }
      status = conn.responseCode
      Log.i(TAG, "GET $current → $status (offset=$offset)")
      if (status in listOf(301, 302, 303, 307, 308)) {
        val location = conn.getHeaderField("Location")
        conn.disconnect()
        connections.remove(token)
        if (location == null || hops >= MAX_REDIRECTS) {
          if (hops >= MAX_REDIRECTS) {
            throw java.io.IOException("Too many redirects.")
          }
          throw java.io.IOException("Redirect without Location.")
        }
        current = URL(URL(current), location).toString()
        Log.i(TAG, "redirect $status → $current")
        hops++
        continue
      }
      connection = conn
      break
    }

    val acceptRanges =
      (connection.getHeaderField("Accept-Ranges") ?: "").contains("bytes", ignoreCase = true)
    val contentLength = try {
      connection.getHeaderField("Content-Length")?.toLong() ?: -1L
    } catch (_: Exception) {
      -1L
    }
    Log.i(TAG, "final $current → $status len=$contentLength ranges=$acceptRanges")
    if (status != 200 && status != 206 && status != 416) {
      connection.disconnect()
      connections.remove(token)
      throw FetchStatusException(status)
    }
    if (status == 416) {
      connection.disconnect()
      connections.remove(token)
      return Result(status, File(destPath).let { if (it.exists()) it.length() else 0L }, current, acceptRanges)
    }

    // Stream to disk with resume support.
    val file = File(destPath)
    try {
      file.parentFile?.mkdirs()
      RandomAccessFile(file, "rw").use { raf ->
        if (offset > 0) {
          raf.seek(offset)
        } else {
          raf.setLength(0)
        }
        val buf = ByteArray(65536)
        var received = 0L
        var lastEmit = 0L
        connection.inputStream.use { input ->
          while (true) {
            if (isCancelled(token)) {
              throw DownloadCancelled()
            }
            val n = try {
              input.read(buf)
            } catch (e: SocketTimeoutException) {
              throw DownloadTimeout(received)
            }
            if (n < 0) {
              break
            }
            raf.write(buf, 0, n)
            received += n
            if (received - lastEmit >= 256 * 1024) {
              lastEmit = received
              try {
                listener?.onBytes(received)
              } catch (_: Exception) {
              }
            }
          }
        }
        try {
          listener?.onBytes(received)
        } catch (_: Exception) {
        }
      }
    } finally {
      try {
        connection.disconnect()
      } catch (_: Exception) {
      }
      connections.remove(token)
    }
    val total = try {
      if (file.exists()) file.length() else 0L
    } catch (_: Exception) {
      0L
    }
    Log.i(TAG, "done $current status=$status total=${total / 1024 / 1024} MB")
    return Result(status, total, current, acceptRanges)
  }
}

class FetchStatusException(val status: Int) :
  java.io.IOException("Download failed (HTTP $status).")
