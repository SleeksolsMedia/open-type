package com.opentype.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Foreground service that exists ONLY while a recording is active.
 * Started by DictationModule.startRecording, stopped the moment the
 * recording finalizes. Tapping the notification returns to the app.
 * No wake locks, no polling — the chronometer ticks client-side.
 */
class RecordingService : Service() {

  companion object {
    const val ACTION_START = "com.opentype.app.recording.START"
    const val ACTION_STOP = "com.opentype.app.recording.STOP"

    private const val CHANNEL_ID = "opentype_recording"
    private const val NOTIFICATION_ID = 1002
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    createChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> startForeground(NOTIFICATION_ID, buildNotification())
      else -> {
        try {
          stopForeground(STOP_FOREGROUND_REMOVE)
        } catch (_: Exception) {
          @Suppress("DEPRECATION")
          stopForeground(true)
        }
        stopSelf()
      }
    }
    return START_NOT_STICKY
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }
    val channel = NotificationChannel(
      CHANNEL_ID,
      "OpenType recording",
      NotificationManager.IMPORTANCE_LOW,
    )
    (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
      .createNotificationChannel(channel)
  }

  private fun buildNotification(): Notification {
    val launch = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(
        this,
        0,
        it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }
    val builder = NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("OpenType is recording")
      .setContentText("Tap to return and finish dictation.")
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setUsesChronometer(true)
      .setOngoing(true)
    if (launch != null) {
      builder.setContentIntent(launch)
    }
    return builder.build()
  }
}
