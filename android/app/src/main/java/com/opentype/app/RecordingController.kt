package com.opentype.app

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.SystemClock
import androidx.core.content.ContextCompat
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import kotlin.math.abs

/** User-safe recording failure. Message is shown in the UI as-is. */
class RecordingException(message: String) : Exception(message)

data class RecorderState(
  val recording: Boolean,
  val amplitude: Float,
  val durationMs: Long,
  val sizeBytes: Long,
)

/**
 * Single owner of microphone capture. Shared by the in-app flow
 * (via DictationModule) and the overlay panel (direct calls).
 * Records 16 kHz mono PCM WAV — the native Whisper format.
 */
object RecordingController {

  interface Listener {
    fun onAutoStop(path: String)
  }

  /** Live PCM frames for streaming transcription. Null = file-only mode. */
  interface FrameListener {
    fun onFrame(base64Pcm16Mono: String)
  }

  private const val SAMPLE_RATE = 16000
  const val MAX_RECORD_MS = 10 * 60 * 1000L
  private const val MIN_RECORD_MS = 500L
  private const val MIN_FRAMES = SAMPLE_RATE / 2
  private const val PENDING_NAME = "pending-recording.json"
  /** 200 ms of 16-bit mono PCM per emitted frame. */
  private const val FRAME_BYTES = 3200 * 2

  private val lock = Any()
  private var audioRecord: AudioRecord? = null
  private var thread: Thread? = null
  private var stream: BufferedOutputStream? = null

  @Volatile private var capturing = false
  @Volatile private var wantsSave = false
  @Volatile private var lastAmplitude = 0f
  @Volatile private var frameListener: FrameListener? = null
  private var frameBuf = ByteArray(0)

  private var file: File? = null
  private var startMs = 0L
  private var frames = 0L
  private var finalized = true
  private var savedPath: String? = null
  private var saveError: String? = null
  private var listener: Listener? = null

  @Throws(RecordingException::class)
  fun start(context: Context, cb: Listener?): String {
    synchronized(lock) {
      if (!finalized || capturing) {
        throw RecordingException("Already recording.")
      }
      if (ContextCompat.checkSelfPermission(
          context,
          Manifest.permission.RECORD_AUDIO,
        ) != PackageManager.PERMISSION_GRANTED
      ) {
        throw RecordingException("Microphone permission not granted.")
      }
      val minBuf = AudioRecord.getMinBufferSize(
        SAMPLE_RATE,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
      )
      if (minBuf <= 0) {
        throw RecordingException("Audio input unavailable on this device.")
      }
      val app = context.applicationContext
      val out = try {
        val f = File(app.cacheDir, "dictation-${System.currentTimeMillis()}.wav")
        val s = BufferedOutputStream(FileOutputStream(f))
        s.write(ByteArray(44)) // placeholder WAV header, patched on stop
        file = f
        s
      } catch (_: Exception) {
        throw RecordingException("Storage unavailable.")
      }
      val rec = AudioRecord(
        MediaRecorder.AudioSource.MIC,
        SAMPLE_RATE,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
        minBuf * 2,
      )
      if (rec.state != AudioRecord.STATE_INITIALIZED) {
        closeQuietly(out)
        file?.delete()
        file = null
        throw RecordingException("Microphone unavailable.")
      }
      rec.startRecording()
      if (rec.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
        try {
          rec.release()
        } catch (_: Exception) {
        }
        closeQuietly(out)
        file?.delete()
        file = null
        throw RecordingException("Could not start microphone.")
      }
      audioRecord = rec
      stream = out
      frames = 0L
      startMs = SystemClock.elapsedRealtime()
      lastAmplitude = 0f
      savedPath = null
      saveError = null
      finalized = false
      capturing = true
      wantsSave = true
      listener = cb
      writePendingMarker(app, file!!)
      startRecordingService(app)
      thread = Thread({ captureLoop() }, "opentype-record").apply { start() }
      return file!!.absolutePath
    }
  }

  /** Stop and keep. Returns the file path (or the auto-stopped path). */
  @Throws(RecordingException::class)
  fun stop(): String {
    synchronized(lock) {
      if (finalized) {
        return savedPath ?: throw RecordingException(
          saveError ?: "No active recording.",
        )
      }
      wantsSave = true
      capturing = false
    }
    try {
      thread?.join(5000)
    } catch (_: InterruptedException) {
    }
    synchronized(lock) {
      return savedPath ?: throw RecordingException(saveError ?: "Recording failed.")
    }
  }

  /** Stop and discard the file. */
  fun cancel() {
    synchronized(lock) {
      if (finalized) {
        return
      }
      wantsSave = false
      capturing = false
    }
    try {
      thread?.join(5000)
    } catch (_: InterruptedException) {
    }
  }
  fun getState(): RecorderState {
    synchronized(lock) {
      return RecorderState(
        recording = capturing && !finalized,
        amplitude = lastAmplitude,
        durationMs = if (startMs == 0L) 0L else SystemClock.elapsedRealtime() - startMs,
        sizeBytes = frames * 2 + 44,
      )
    }
  }

  /**
   * Enable/disable live PCM frame emission. Frames flow only while a
   * recording is active; the WAV file is always written in parallel so
   * HTTP fallback never needs a re-record.
   */
  fun setFrameListener(l: FrameListener?) {
    frameListener = l
    if (l == null) {
      synchronized(lock) {
        frameBuf = ByteArray(0)
      }
    }
  }

  /**
   * Bounded frame queue for headless consumers (bubble live flow), which
   * cannot receive live device events. Drained via [drainQueuedFrames];
   * oldest frames drop past the cap and are counted.
   */
  private const val MAX_QUEUE_FRAMES = 3200 // ~10 min at 5 frames/s
  private var queueFrames = false
  private val frameQueue: ArrayDeque<String> = ArrayDeque()
  private var queuedDropped = 0

  fun setQueueFrames(enabled: Boolean) {
    synchronized(lock) {
      queueFrames = enabled
      frameQueue.clear()
      queuedDropped = 0
    }
  }

  /** Returns queued frames and clears the queue. */
  fun drainQueuedFrames(): List<String> {
    synchronized(lock) {
      val out = frameQueue.toList()
      frameQueue.clear()
      return out
    }
  }

  /** Dropped-frame count since last call (resets). >0 means audio was lost. */
  fun consumeDroppedFrames(): Int {
    synchronized(lock) {
      val n = queuedDropped
      queuedDropped = 0
      return n
    }
  }

  /** Path of a recording that never finalized (app killed mid-record). */
  fun readPending(context: Context): String? {
    synchronized(lock) {
      if (capturing || !finalized) {
        return null
      }
    }
    val app = context.applicationContext
    val marker = File(app.cacheDir, PENDING_NAME)
    if (!marker.exists()) {
      return null
    }
    val raw = try {
      marker.readText()
    } catch (_: Exception) {
      marker.delete()
      return null
    }
    val path = Regex("\"path\"\\s*:\\s*\"([^\"]+)\"").find(raw)?.groupValues?.get(1)
    val f = if (path != null) File(path) else null
    return if (f != null && f.exists() && f.length() > 44) {
      f.absolutePath
    } else {
      try {
        marker.delete()
      } catch (_: Exception) {
      }
      try {
        f?.delete()
      } catch (_: Exception) {
      }
      null
    }
  }

  fun discardPending(context: Context) {
    val app = context.applicationContext
    val marker = File(app.cacheDir, PENDING_NAME)
    if (marker.exists()) {
      val raw = try {
        marker.readText()
      } catch (_: Exception) {
        ""
      }
      val path = Regex("\"path\"\\s*:\\s*\"([^\"]+)\"").find(raw)?.groupValues?.get(1)
      if (path != null) {
        try {
          File(path).delete()
        } catch (_: Exception) {
        }
      }
      try {
        marker.delete()
      } catch (_: Exception) {
      }
    }
  }

  // ---- internals -----------------------------------------------------------

  /** Accumulate raw PCM and emit 200 ms base64 frames when streaming. */
  private fun emitFrames(pcmBytes: ByteArray) {
    val l = frameListener
    val queue: Boolean
    synchronized(lock) {
      queue = queueFrames
    }
    if (l == null && !queue) {
      return
    }
    try {
      val combined: ByteArray
      synchronized(lock) {
        combined = frameBuf + pcmBytes
        frameBuf = ByteArray(0)
      }
      var offset = 0
      var rest = combined
      while (rest.size - offset >= FRAME_BYTES) {
        val chunk = rest.copyOfRange(offset, offset + FRAME_BYTES)
        offset += FRAME_BYTES
        val b64 = android.util.Base64.encodeToString(chunk, android.util.Base64.NO_WRAP)
        try {
          l?.onFrame(b64)
        } catch (_: Exception) {
        }
        if (queue) {
          synchronized(lock) {
            if (queueFrames) {
              frameQueue.addLast(b64)
              while (frameQueue.size > MAX_QUEUE_FRAMES) {
                frameQueue.removeFirst()
                queuedDropped++
              }
            }
          }
        }
      }
      if (offset > 0) {
        synchronized(lock) {
          frameBuf = rest.copyOfRange(offset, rest.size)
        }
      } else {
        synchronized(lock) {
          frameBuf = combined
        }
      }
    } catch (_: Exception) {
      // Frame emission must never break recording.
    }
  }

  private fun captureLoop() {
    val rec: AudioRecord?
    val out: BufferedOutputStream?
    synchronized(lock) {
      rec = audioRecord
      out = stream
    }
    if (rec == null || out == null) {
      finish(timedOut = false)
      return
    }
    val buf = ShortArray(2048)
    try {
      while (true) {
        val alive = synchronized(lock) { capturing }
        if (!alive) {
          break
        }
        if (SystemClock.elapsedRealtime() - startMs >= MAX_RECORD_MS) {
          finish(timedOut = true)
          return
        }
        val n = rec.read(buf, 0, buf.size)
        if (n <= 0) {
          continue
        }
        val bytes = ByteArray(n * 2)
        var peak = 0
        for (i in 0 until n) {
          val s = buf[i].toInt()
          val a = abs(s)
          if (a > peak) {
            peak = a
          }
          bytes[i * 2] = (s and 0xFF).toByte()
          bytes[i * 2 + 1] = ((s shr 8) and 0xFF).toByte()
        }
        try {
          out.write(bytes)
        } catch (_: Exception) {
          synchronized(lock) { saveError = "Storage write failed." }
          finish(timedOut = false)
          return
        }
        emitFrames(bytes)
        synchronized(lock) {
          frames += n
          lastAmplitude = (peak / 32768f).coerceIn(0f, 1f)
        }
      }
      finish(timedOut = false)
    } catch (_: Exception) {
      synchronized(lock) {
        if (saveError == null) {
          saveError = "Recording failed."
        }
      }
      finish(timedOut = false)
    }
  }

  private fun finish(timedOut: Boolean) {
    var autoPath: String? = null
    var cb: Listener? = null
    synchronized(lock) {
      if (finalized) {
        return
      }
      finalized = true
      capturing = false
      closeQuietly(stream)
      try {
        audioRecord?.stop()
      } catch (_: Exception) {
      }
      try {
        audioRecord?.release()
      } catch (_: Exception) {
      }
      audioRecord = null
      stream = null
      thread = null
      val duration = SystemClock.elapsedRealtime() - startMs
      val f = file
      val keep = wantsSave && saveError == null &&
        duration >= MIN_RECORD_MS && frames >= MIN_FRAMES && f != null
      if (keep && f != null) {
        try {
          patchWavHeader(f, frames)
          savedPath = f.absolutePath
          if (timedOut) {
            autoPath = f.absolutePath
          }
        } catch (_: Exception) {
          f.delete()
          savedPath = null
          saveError = "Could not finalize audio file."
        }
      } else {
        try {
          f?.delete()
        } catch (_: Exception) {
        }
        savedPath = null
        if (saveError == null) {
          saveError = if (!wantsSave) "Recording discarded." else "Recording was too short."
        }
      }
      file = null
      cb = listener
      listener = null
      frameBuf = ByteArray(0)
    }
    // Service/marker cleanup needs a context: the owner stops it.
    // Best-effort here is impossible without context, so owners call
    // noteFinished() — except the worker thread itself. Handle below.
    if (autoPath != null) {
      try {
        cb?.onAutoStop(autoPath!!)
      } catch (_: Exception) {
      }
    }
  }

  /** Stop the mic foreground service + clear the crash marker. Owners call
   * this after stop()/cancel()/auto-stop (auto-stop included: the callback
   * receiver calls it). */
  fun noteFinished(context: Context) {
    val app = context.applicationContext
    try {
      app.startService(
        Intent(app, RecordingService::class.java).apply {
          action = RecordingService.ACTION_STOP
        },
      )
    } catch (_: Exception) {
    }
    try {
      File(app.cacheDir, PENDING_NAME).delete()
    } catch (_: Exception) {
    }
  }

  private fun startRecordingService(app: Context) {
    try {
      val intent = Intent(app, RecordingService::class.java).apply {
        action = RecordingService.ACTION_START
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        app.startForegroundService(intent)
      } else {
        app.startService(intent)
      }
    } catch (_: Exception) {
    }
  }

  private fun writePendingMarker(app: Context, f: File) {
    try {
      File(app.cacheDir, PENDING_NAME).writeText("{\"path\":\"${f.absolutePath}\"}")
    } catch (_: Exception) {
    }
  }

  private fun closeQuietly(s: BufferedOutputStream?) {
    try {
      s?.flush()
      s?.close()
    } catch (_: Exception) {
    }
  }

  private fun patchWavHeader(f: File, frameCount: Long) {
    val dataBytes = frameCount * 2
    RandomAccessFile(f, "rw").use { raf ->
      raf.seek(0)
      fun ascii(s: String) = raf.write(s.toByteArray(Charsets.US_ASCII))
      fun le32(v: Long) {
        raf.write((v and 0xFF).toInt())
        raf.write(((v shr 8) and 0xFF).toInt())
        raf.write(((v shr 16) and 0xFF).toInt())
        raf.write(((v shr 24) and 0xFF).toInt())
      }
      fun le16(v: Int) {
        raf.write(v and 0xFF)
        raf.write((v shr 8) and 0xFF)
      }
      ascii("RIFF")
      le32(36 + dataBytes)
      ascii("WAVE")
      ascii("fmt ")
      le32(16)
      le16(1)
      le16(1)
      le32(SAMPLE_RATE.toLong())
      le32((SAMPLE_RATE * 2).toLong())
      le16(2)
      le16(16)
      ascii("data")
      le32(dataBytes)
    }
  }
}
