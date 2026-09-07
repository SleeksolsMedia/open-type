package com.opentype.app

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.view.animation.OvershootInterpolator
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.sin

/**
 * Floating dictation bubble shown over other apps (Android only).
 *
 * Calm Flow design: lavender pill bubble with an ink ring and mic glyph,
 * springy pop-in, dark "velvet chamber" panels, 7-bar live waveform with
 * ember peaks, and animated transitions between every state.
 *
 * The service runs persistently (but idle) once onboarding is done so the
 * AccessibilityService can show/hide the *view* at any time without
 * background start restrictions. Tap the bubble to record in place:
 * the bubble expands into a recording panel, Stop runs the pipeline in a
 * headless JS task, and the result is inserted into the focused field.
 */
class OverlayService : Service() {

  companion object {
    const val ACTION_START = "com.opentype.app.overlay.START"
    const val ACTION_SHOW_VIEW = "com.opentype.app.overlay.SHOW_VIEW"
    const val ACTION_HIDE_VIEW = "com.opentype.app.overlay.HIDE_VIEW"
    const val ACTION_STOP = "com.opentype.app.overlay.STOP"

    private const val CHANNEL_ID = "opentype_bubble"
    private const val NOTIFICATION_ID = 1001

    // Calm Flow palette (mirrors src/theme.ts).
    private const val INK = 0xFF1A1A1A
    private const val CREAM = 0xFFFFFFEB
    private const val LAVENDER = 0xFFF0D7FF
    private const val EMBER = 0xFFFFA946
    private const val FOREST = 0xFF034F46
    private const val SUCCESS = 0xFF3ED598.toInt()
    private const val ERROR = 0xFFFF7A7A.toInt()
    private const val BAR_DIM = 0x66FFFFEB

    @Volatile
    var running = false
      private set

    fun start(context: Context) = send(context, ACTION_START, foreground = true)

    fun showView(context: Context) {
      if (!running) {
        return
      }
      send(context, ACTION_SHOW_VIEW, foreground = false)
    }

    fun hideView(context: Context) {
      if (!running) {
        return
      }
      send(context, ACTION_HIDE_VIEW, foreground = false)
    }

    fun stop(context: Context) = send(context, ACTION_STOP, foreground = false)

    private fun send(context: Context, action: String, foreground: Boolean) {
      try {
        val app = context.applicationContext
        val intent = Intent(app, OverlayService::class.java).apply {
          this.action = action
        }
        if (foreground && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          app.startForegroundService(intent)
        } else {
          app.startService(intent)
        }
      } catch (_: Exception) {
        // Background start restrictions: the service (re)starts on next app open.
      }
    }
  }

  private enum class Mode { NONE, BUBBLE, RECORDING, WORKING, RESULT }

  private var mode = Mode.NONE
  private var wm: WindowManager? = null
  private var view: View? = null
  private var bubbleX = 16
  private var bubbleY = 300
  private var bubbleTargetAlpha = 1f

  private val handler = Handler(Looper.getMainLooper())
  private var ticker: Runnable? = null
  private var tickCount = 0
  private var collapseTask: Runnable? = null
  private var timerText: TextView? = null
  private var waveBars: List<View> = emptyList()

  private val autoListener = object : RecordingController.Listener {
    override fun onAutoStop(path: String) {
      handler.post {
        if (mode == Mode.RECORDING) {
          RecordingController.noteFinished(this@OverlayService)
          beginWorking(path)
        }
      }
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    running = true
    createChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START, null -> {
        // (Re)establish foreground; sticky restarts arrive with null intent.
        startForeground(NOTIFICATION_ID, buildNotification())
      }
      ACTION_SHOW_VIEW -> {
        if (mode == Mode.NONE) {
          showBubble()
        }
      }
      ACTION_HIDE_VIEW -> {
        if (mode == Mode.BUBBLE) {
          val v = view
          mode = Mode.NONE
          removeViewAnimated(v)
        }
      }
      ACTION_STOP -> {
        teardown()
        stopSelf()
        return START_NOT_STICKY
      }
    }
    return START_STICKY
  }

  override fun onDestroy() {
    teardown()
    running = false
    super.onDestroy()
  }

  // ---- theme + drawing helpers ------------------------------------------------

  private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

  private fun isDark(): Boolean =
    (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
      Configuration.UI_MODE_NIGHT_YES

  /** Circular bubble background: lavender fill + ink/cream ring. */
  private fun bubbleBackground(): GradientDrawable = GradientDrawable().apply {
    shape = GradientDrawable.OVAL
    setColor(LAVENDER.toInt())
    setStroke(dp(2), if (isDark()) CREAM.toInt() else INK.toInt())
  }

  /** Dark velvet-chamber panel background. */
  private fun chamberBackground(): GradientDrawable = GradientDrawable().apply {
    setColor(Color.argb(242, 0x1A, 0x1A, 0x1A))
    cornerRadius = dp(28).toFloat()
    setStroke(dp(1), Color.argb(90, 0xFF, 0xFF, 0xEB))
  }

  private fun primaryButton(btn: Button) {
    btn.isAllCaps = false
    btn.textSize = 15f
    btn.setTextColor(INK.toInt())
    btn.background = GradientDrawable().apply {
      setColor(LAVENDER.toInt())
      cornerRadius = dp(24).toFloat()
      setStroke(dp(2), CREAM.toInt())
    }
    val px = dp(20)
    btn.setPadding(px, dp(12), px, dp(12))
    btn.minWidth = 0
    btn.minimumWidth = 0
  }

  private fun ghostButton(btn: Button) {
    btn.isAllCaps = false
    btn.textSize = 15f
    btn.setTextColor(Color.WHITE)
    btn.background = GradientDrawable().apply {
      setColor(Color.TRANSPARENT)
      cornerRadius = dp(24).toFloat()
      setStroke(dp(2), Color.argb(160, 0xFF, 0xFF, 0xFF))
    }
    val px = dp(20)
    btn.setPadding(px, dp(12), px, dp(12))
    btn.minWidth = 0
    btn.minimumWidth = 0
  }

  private fun panelTitle(text: String, sizeSp: Float = 22f): TextView =
    TextView(this).apply {
      this.text = text
      setTextColor(Color.WHITE)
      textSize = sizeSp
      gravity = Gravity.CENTER
    }

  private fun chamberPanel(): LinearLayout = LinearLayout(this).apply {
    orientation = LinearLayout.VERTICAL
    gravity = Gravity.CENTER_HORIZONTAL
    background = chamberBackground()
    val pad = dp(22)
    setPadding(pad, pad, pad, pad)
  }

  /** 7-bar live waveform; bars are re-sized by the ticker. */
  private fun waveformRow(): LinearLayout {
    val row = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER or Gravity.BOTTOM
      val h = dp(48)
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.WRAP_CONTENT,
        h,
      ).apply {
        topMargin = dp(10)
        bottomMargin = dp(14)
      }
    }
    val bars = ArrayList<View>(7)
    repeat(7) {
      val bar = View(this).apply {
        setBackgroundColor(BAR_DIM.toInt())
        layoutParams = LinearLayout.LayoutParams(dp(5), dp(8)).apply {
          leftMargin = dp(3)
          rightMargin = dp(3)
          gravity = Gravity.BOTTOM
        }
      }
      // Rounded bars need a background drawable instead of a flat color.
      bar.background = roundedBar(BAR_DIM.toInt())
      row.addView(bar)
      bars.add(bar)
    }
    waveBars = bars
    return row
  }

  private fun roundedBar(color: Int): GradientDrawable = GradientDrawable().apply {
    setColor(color)
    cornerRadius = dp(3).toFloat()
  }

  // ---- view animations --------------------------------------------------------

  /** Lively pop-in for the bubble, calm fade-rise for panels. */
  private fun animateIn(v: View, targetAlpha: Float, pop: Boolean) {
    if (pop) {
      v.scaleX = 0.5f
      v.scaleY = 0.5f
      v.alpha = 0f
      v.animate()
        .scaleX(1f).scaleY(1f).alpha(targetAlpha)
        .setDuration(320)
        .setInterpolator(OvershootInterpolator(1.4f))
        .start()
    } else {
      v.scaleX = 0.92f
      v.scaleY = 0.92f
      v.alpha = 0f
      v.animate()
        .scaleX(1f).scaleY(1f).alpha(1f)
        .setDuration(240)
        .setInterpolator(DecelerateInterpolator())
        .start()
    }
  }

  /** Fade-shrink a specific view, then remove it if still attached. */
  private fun removeViewAnimated(v: View?) {
    if (v == null) {
      return
    }
    v.animate().cancel()
    v.animate()
      .alpha(0f).scaleX(0.85f).scaleY(0.85f)
      .setDuration(160)
      .setInterpolator(DecelerateInterpolator())
      .setListener(object : AnimatorListenerAdapter() {
        override fun onAnimationEnd(animation: Animator) {
          try {
            wm?.removeView(v)
          } catch (_: Exception) {
          }
          if (view === v) {
            view = null
            timerText = null
            waveBars = emptyList()
          }
        }
      })
      .start()
  }

  private fun addViewRaw(v: View, params: WindowManager.LayoutParams) {
    try {
      wm?.addView(v, params)
      view = v
    } catch (_: Exception) {
      view = null
    }
  }

  // ---- collapsed bubble ------------------------------------------------------

  @SuppressLint("ClickableViewAccessibility")
  private fun showBubble() {
    if (!Settings.canDrawOverlays(this)) {
      return
    }
    val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    this.wm = wm
    val size = UiPrefs.bubbleSize(this)
    val opacity = UiPrefs.bubbleOpacity(this)
    bubbleTargetAlpha = opacity / 100f
    val scale = size / 100f
    val px = (68 * resources.displayMetrics.density * scale).toInt()

    val bubble = FrameLayout(this).apply {
      background = bubbleBackground()
      alpha = 0f
    }
    val iconSize = (px * 0.52).toInt()
    val mic = ImageView(this).apply {
      setImageResource(android.R.drawable.ic_btn_speak_now)
      setColorFilter(INK.toInt())
      layoutParams = FrameLayout.LayoutParams(iconSize, iconSize, Gravity.CENTER)
      alpha = bubbleTargetAlpha
    }
    bubble.addView(mic)

    val params = WindowManager.LayoutParams(
      px,
      px,
      overlayType(),
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.END
      x = bubbleX
      y = bubbleY
    }
    var downX = 0f
    var downY = 0f
    var startX = 0
    var startY = 0
    var squashed = false
    bubble.setOnTouchListener { v, event ->
      when (event.action) {
        MotionEvent.ACTION_DOWN -> {
          downX = event.rawX
          downY = event.rawY
          startX = params.x
          startY = params.y
          true
        }
        MotionEvent.ACTION_MOVE -> {
          params.x = startX - (event.rawX - downX).toInt()
          params.y = startY + (event.rawY - downY).toInt()
          if (!squashed) {
            squashed = true
            v.animate().scaleX(0.9f).scaleY(0.9f).setDuration(120).start()
          }
          try {
            wm.updateViewLayout(v, params)
          } catch (_: Exception) {
          }
          true
        }
        MotionEvent.ACTION_UP -> {
          bubbleX = params.x
          bubbleY = params.y
          if (squashed) {
            squashed = false
            v.animate().scaleX(1f).scaleY(1f).setDuration(220)
              .setInterpolator(OvershootInterpolator(1.6f)).start()
          }
          val moved = abs(event.rawX - downX) + abs(event.rawY - downY)
          if (moved < 12) {
            startPanelRecording()
          }
          true
        }
        MotionEvent.ACTION_CANCEL -> {
          if (squashed) {
            squashed = false
            v.animate().scaleX(1f).scaleY(1f).setDuration(200).start()
          }
          false
        }
        else -> false
      }
    }
    addViewRaw(bubble, params)
    animateIn(bubble, bubbleTargetAlpha, pop = true)
    mode = Mode.BUBBLE
  }

  // ---- recording panel ---------------------------------------------------------

  private fun startPanelRecording() {
    if (mode != Mode.BUBBLE) {
      return
    }
    try {
      RecordingController.start(this, autoListener)
    } catch (e: RecordingException) {
      showResult(ok = false, message = e.message ?: "Couldn't start recording.")
      return
    }
    val panel = chamberPanel()
    timerText = panelTitle("0:00").also { panel.addView(it) }
    panel.addView(
      TextView(this).apply {
        text = "Listening… tap stop when done"
        setTextColor(Color.argb(200, 0xFF, 0xFF, 0xEB))
        textSize = 13f
        gravity = Gravity.CENTER
      },
    )
    panel.addView(waveformRow())
    val row = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER
    }
    val stopBtn = Button(this).apply { text = "Stop" }
    val cancelBtn = Button(this).apply { text = "Discard" }
    primaryButton(stopBtn)
    ghostButton(cancelBtn)
    stopBtn.setOnClickListener { onPanelStop() }
    cancelBtn.setOnClickListener { onPanelCancel() }
    val btnParams = LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.WRAP_CONTENT,
      LinearLayout.LayoutParams.WRAP_CONTENT,
    ).apply {
      leftMargin = dp(6)
      rightMargin = dp(6)
    }
    row.addView(stopBtn, btnParams)
    row.addView(cancelBtn, btnParams)
    panel.addView(row)

    replaceView(panel)
    mode = Mode.RECORDING
    tickCount = 0
    startTicker()
  }

  private fun startTicker() {
    stopTicker()
    val r = object : Runnable {
      override fun run() {
        if (mode != Mode.RECORDING) {
          return
        }
        val s = RecordingController.getState()
        timerText?.text = formatMs(s.durationMs)
        tickCount++
        val bars = waveBars
        bars.forEachIndexed { i, bar ->
          val wobble = (0.6 + 0.4 * sin(tickCount * 0.55 + i * 1.15)).toFloat()
          val level = (s.amplitude * wobble).coerceIn(0f, 1f)
          val h = dp(6) + (level * dp(38)).toInt()
          try {
            val lp = bar.layoutParams as LinearLayout.LayoutParams
            lp.height = h
            bar.layoutParams = lp
            bar.background = roundedBar(
              when {
                level > 0.72 -> EMBER.toInt()
                level > 0.32 -> LAVENDER.toInt()
                else -> BAR_DIM.toInt()
              },
            )
          } catch (_: Exception) {
          }
        }
        handler.postDelayed(this, 120)
      }
    }
    ticker = r
    handler.post(r)
  }

  private fun stopTicker() {
    ticker?.let { handler.removeCallbacks(it) }
    ticker = null
  }

  private fun onPanelStop() {
    if (mode != Mode.RECORDING) {
      return
    }
    val path = try {
      RecordingController.stop()
    } catch (e: RecordingException) {
      RecordingController.noteFinished(this)
      showResult(ok = false, message = e.message ?: "Recording failed.")
      return
    }
    RecordingController.noteFinished(this)
    beginWorking(path)
  }

  private fun onPanelCancel() {
    if (mode != Mode.RECORDING) {
      return
    }
    RecordingController.cancel()
    RecordingController.noteFinished(this)
    collapseToBubble()
  }

  // ---- headless pipeline ---------------------------------------------------------

  private fun beginWorking(path: String) {
    stopTicker()
    mode = Mode.WORKING
    val panel = chamberPanel()
    panel.addView(panelTitle("Polishing…", 20f))
    panel.addView(
      TextView(this).apply {
        text = "Transcribing your words"
        setTextColor(Color.argb(200, 0xFF, 0xFF, 0xEB))
        textSize = 13f
        gravity = Gravity.CENTER
        val lp = LinearLayout.LayoutParams(
          LinearLayout.LayoutParams.WRAP_CONTENT,
          LinearLayout.LayoutParams.WRAP_CONTENT,
        ).apply {
          topMargin = dp(4)
          bottomMargin = dp(14)
        }
        layoutParams = lp
      },
    )
    // Calm indeterminate shimmer: three dots pulsing via a lightweight ticker.
    val dots = TextView(this).apply {
      text = "● ● ●"
      setTextColor(LAVENDER.toInt())
      textSize = 16f
      gravity = Gravity.CENTER
    }
    panel.addView(dots)
    val pulse = object : Runnable {
      var step = 0
      override fun run() {
        if (mode != Mode.WORKING) {
          return
        }
        step++
        dots.alpha = 0.45f + 0.55f * (0.5f + 0.5f * sin(step * 0.9f).toFloat())
        handler.postDelayed(this, 180)
      }
    }
    handler.post(pulse)
    panel.addView(
      Button(this).apply {
        text = "Hide"
        ghostButton(this)
        setOnClickListener { collapseToBubble() }
      },
    )
    replaceView(panel)

    val snapshot = UiPrefs.getSettingsSnapshot(this) ?: "{}"
    val enhance = try {
      JSONObject(snapshot).optBoolean("enhanceByDefault", false)
    } catch (_: Exception) {
      false
    }
    DictationResultRelay.listener = { ok, message ->
      handler.post {
        handler.removeCallbacks(pulse)
        showResult(ok, message)
      }
    }
    try {
      val intent = Intent(applicationContext, DictationTaskService::class.java).apply {
        putExtra("fileUri", "file://$path")
        putExtra("settings", snapshot)
        putExtra("enhance", enhance)
      }
      applicationContext.startService(intent)
    } catch (_: Exception) {
      handler.removeCallbacks(pulse)
      showResult(ok = false, message = "Couldn't start transcription.")
    }
  }

  private fun showResult(ok: Boolean, message: String) {
    DictationResultRelay.listener = null
    if (mode != Mode.WORKING && mode != Mode.RECORDING && mode != Mode.BUBBLE) {
      return
    }
    stopTicker()
    mode = Mode.RESULT
    val panel = chamberPanel()
    val dot = View(this).apply {
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(if (ok) SUCCESS else ERROR)
      }
      layoutParams = LinearLayout.LayoutParams(dp(14), dp(14)).apply {
        bottomMargin = dp(10)
        gravity = Gravity.CENTER_HORIZONTAL
      }
    }
    panel.addView(dot)
    panel.addView(
      TextView(this).apply {
        text = message.take(140)
        setTextColor(Color.WHITE)
        textSize = 15f
        gravity = Gravity.CENTER
      },
    )
    panel.addView(
      TextView(this).apply {
        text = if (ok) "Inserted — back to your app" else "Saved — tap the bubble to retry"
        setTextColor(Color.argb(200, 0xFF, 0xFF, 0xEB))
        textSize = 12f
        gravity = Gravity.CENTER
        val lp = LinearLayout.LayoutParams(
          LinearLayout.LayoutParams.WRAP_CONTENT,
          LinearLayout.LayoutParams.WRAP_CONTENT,
        ).apply { topMargin = dp(6) }
        layoutParams = lp
      },
    )
    replaceView(panel)
    collapseTask?.let { handler.removeCallbacks(it) }
    val c = Runnable { collapseToBubble() }
    collapseTask = c
    handler.postDelayed(c, 2600)
  }

  private fun collapseToBubble() {
    DictationResultRelay.listener = null
    stopTicker()
    collapseTask?.let { handler.removeCallbacks(it) }
    collapseTask = null
    val old = view
    view = null
    timerText = null
    waveBars = emptyList()
    mode = Mode.NONE
    removeViewAnimated(old)
    // The field is usually still focused: restore the bubble directly
    // (the accessibility service hides it if it shouldn't show).
    handler.postDelayed({
      if (mode != Mode.NONE) {
        return@postDelayed
      }
      if (UiPrefs.isBubbleEnabled(this) &&
        UiPrefs.isOnboardingDone(this) &&
        Settings.canDrawOverlays(this)
      ) {
        showBubble()
      }
    }, 170)
  }

  // ---- view helpers -----------------------------------------------------------

  private fun overlayParams(w: Int, h: Int): WindowManager.LayoutParams {
    return WindowManager.LayoutParams(
      w,
      h,
      overlayType(),
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.END
      x = bubbleX
      y = bubbleY
    }
  }

  private fun replaceView(v: View) {
    val old = view
    view = null
    timerText = null
    waveBars = emptyList()
    if (old == null) {
      addViewRaw(
        v,
        overlayParams(
          WindowManager.LayoutParams.WRAP_CONTENT,
          WindowManager.LayoutParams.WRAP_CONTENT,
        ),
      )
      animateIn(v, 1f, pop = false)
      return
    }
    // Crossfade: shrink the old panel out, grow the new one in.
    old.animate().cancel()
    old.animate()
      .alpha(0f).scaleX(0.92f).scaleY(0.92f)
      .setDuration(140)
      .setInterpolator(DecelerateInterpolator())
      .setListener(object : AnimatorListenerAdapter() {
        override fun onAnimationEnd(animation: Animator) {
          try {
            wm?.removeView(old)
          } catch (_: Exception) {
          }
          if (view == null) {
            addViewRaw(
              v,
              overlayParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
              ),
            )
            animateIn(v, 1f, pop = false)
          }
        }
      })
      .start()
  }

  private fun teardown() {
    DictationResultRelay.listener = null
    stopTicker()
    collapseTask?.let { handler.removeCallbacks(it) }
    collapseTask = null
    val old = view
    view = null
    timerText = null
    waveBars = emptyList()
    mode = Mode.NONE
    if (old != null) {
      try {
        wm?.removeView(old)
      } catch (_: Exception) {
      }
    }
    try {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } catch (_: Exception) {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
  }

  private fun formatMs(ms: Long): String {
    val s = ms / 1000
    return "${s / 60}:${String.format("%02d", s % 60)}"
  }

  private fun overlayType(): Int {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_PHONE
    }
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }
    val channel = NotificationChannel(
      CHANNEL_ID,
      "OpenType bubble",
      NotificationManager.IMPORTANCE_LOW,
    )
    (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
      .createNotificationChannel(channel)
  }

  private fun buildNotification(): Notification {
    val launch = packageManager.getLaunchIntentForPackage(packageName)?.let {
      val flags =
        android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
      android.app.PendingIntent.getActivity(this, 0, it, flags)
    }
    val builder = NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("OpenType bubble")
      .setContentText("Dictate in any text field.")
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setOngoing(true)
    if (launch != null) {
      builder.setContentIntent(launch)
    }
    return builder.build()
  }
}
