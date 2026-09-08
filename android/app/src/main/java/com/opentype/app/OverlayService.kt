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
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.RectF
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
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.sin

/**
 * Floating dictation orb (over other apps).
 *
 * Design system: paper / ink / coral. The orb is a perfect ink circle
 * with a coral 5-bar equalizer mark drawn by [OrbView]. Coral pulse ring
 * during listening, amber spark while LLM polishing, green check on
 * insertion, orange error badge on failure.
 *
 * The service runs persistently (but idle) once onboarding is done so the
 * AccessibilityService can show/hide the *view* at any time without
 * background start restrictions. Tap the orb to record in place: the
 * panel slides up around the orb, Stop runs the pipeline in a headless
 * JS task, and the result is inserted into the focused field.
 */
class OverlayService : Service() {

  companion object {
    const val ACTION_START = "com.opentype.app.overlay.START"
    const val ACTION_SHOW_VIEW = "com.opentype.app.overlay.SHOW_VIEW"
    const val ACTION_HIDE_VIEW = "com.opentype.app.overlay.HIDE_VIEW"
    const val ACTION_STOP = "com.opentype.app.overlay.STOP"

    private const val CHANNEL_ID = "opentype_bubble"
    private const val NOTIFICATION_ID = 1001

    // Design-system tokens (mirror design-system.html).
    private const val PAPER = 0xFFF4F1EA.toInt()      // #F4F1EA
    private const val INK = 0xFF1A1714.toInt()        // #1A1714
    private const val INK_SOFT = 0xFF3A342D.toInt()   // #3A342D
    private const val INK_LOW = 0xFF9A9184.toInt()    // #9A9184
    private const val LINE = 0xFFD8D1C2.toInt()       // #D8D1C2
    private const val CORAL = 0xFFE8552B.toInt()      // #E8552B
    private const val CORAL_LIGHT = 0xFFF27A54.toInt() // #F27A54
    private const val AMBER = 0xFFF2B705.toInt()      // #F2B705
    private const val DONE = 0xFF0F8E7E.toInt()      // #0F8E7E
    private const val ERR = 0xFFD64524.toInt()        // #D64524
    private const val PANEL_INK = 0xF21A1714.toInt()  // panel surface (94% ink)

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
  private var panelLive = false
  private var wm: WindowManager? = null
  private var view: View? = null
  private var orbView: OrbView? = null
  private var bubbleX = 16
  private var bubbleY = 300
  private var bubbleTargetAlpha = 1f
  private var ringAnim: Runnable? = null

  private val handler = Handler(Looper.getMainLooper())
  private var ticker: Runnable? = null
  private var tickCount = 0
  private var collapseTask: Runnable? = null
  private var waveTicker: Runnable? = null
  private var waveBars: List<View> = emptyList()
  private var timerText: TextView? = null

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

  // ---- helpers -----------------------------------------------------------------

  private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

  private fun isDark(): Boolean =
    (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
      Configuration.UI_MODE_NIGHT_YES

  private fun textColor(): Int = if (isDark()) PAPER else INK
  private fun subtextColor(): Int = if (isDark()) INK_LOW else INK_SOFT
  private fun panelBg(): Int = if (isDark()) PANEL_INK else PANEL_INK

  private fun primaryButton(btn: Button) {
    btn.isAllCaps = false
    btn.textSize = 14f
    btn.setTextColor(Color.WHITE)
    btn.background = GradientDrawable().apply {
      setColor(CORAL)
      cornerRadius = dp(14).toFloat()
    }
    val px = dp(18)
    btn.setPadding(px, dp(12), px, dp(12))
    btn.minWidth = 0
    btn.minimumWidth = 0
  }

  private fun ghostButton(btn: Button) {
    btn.isAllCaps = false
    btn.textSize = 14f
    btn.setTextColor(textColor())
    btn.background = GradientDrawable().apply {
      setColor(Color.TRANSPARENT)
      cornerRadius = dp(14).toFloat()
      setStroke(dp(1), LINE)
    }
    val px = dp(18)
    btn.setPadding(px, dp(12), px, dp(12))
    btn.minWidth = 0
    btn.minimumWidth = 0
  }

  // ---- view animations --------------------------------------------------------

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
      v.scaleX = 0.96f
      v.scaleY = 0.96f
      v.alpha = 0f
      v.animate()
        .scaleX(1f).scaleY(1f).alpha(1f)
        .setDuration(220)
        .setInterpolator(DecelerateInterpolator())
        .start()
    }
  }

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
            orbView = null
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

  // ---- collapsed orb (the new design) ----------------------------------------

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
    val diameter = (66 * resources.displayMetrics.density * scale).toInt()

    val orb = OrbView(this).apply {
      this.diameterPx = diameter
      this.orbState = OrbView.State.IDLE
      this.alpha = 0f
      this.level = 0f
    }
    orbView = orb

    val params = WindowManager.LayoutParams(
      diameter,
      diameter,
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
    orb.setOnTouchListener { v, event ->
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
            v.animate().scaleX(0.92f).scaleY(0.92f).setDuration(120).start()
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
    addViewRaw(orb, params)
    animateIn(orb, bubbleTargetAlpha, pop = true)
    mode = Mode.BUBBLE
  }

  // ---- recording panel (orb stays, sheet slides up) --------------------------

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
    panelLive = isLiveMode()
    if (panelLive) {
      RecordingController.setQueueFrames(true)
    }

    orbView?.orbState = OrbView.State.LISTENING
    startRingPulse()

    val panel = buildPanel()
    panel.addView(
      TextView(this).apply {
        text = "● LISTENING"
        setTextColor(CORAL)
        textSize = 11f
        letterSpacing = 0.15f
        typeface = android.graphics.Typeface.MONOSPACE
        gravity = Gravity.START
      },
    )
    val timer = TextView(this).apply {
      text = "0:00"
      setTextColor(textColor())
      textSize = 18f
      letterSpacing = 0.05f
      typeface = android.graphics.Typeface.MONOSPACE
      gravity = Gravity.START
    }
    panel.addView(timer)
    timerText = timer
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

  /**
   * The recording sheet — warm ink panel with hairline border, mono eyebrow,
   * timer, 5-bar live waveform, coral Stop + ghost Discard buttons.
   */
  private fun buildPanel(): LinearLayout {
    val panel = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      background = GradientDrawable().apply {
        setColor(PANEL_INK)
        cornerRadius = dp(18).toFloat()
        setStroke(dp(1), LINE)
      }
      val pad = dp(16)
      setPadding(pad, pad, pad, pad)
    }
    return panel
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
        // Feed live amplitude into the orb so its bars bounce.
        orbView?.level = s.amplitude
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
    RecordingController.setQueueFrames(false)
    RecordingController.noteFinished(this)
    panelLive = false
    collapseToBubble()
  }

  // ---- headless pipeline -------------------------------------------------------

  private fun beginWorking(path: String) {
    stopTicker()
    stopRingPulse()
    mode = Mode.WORKING
    orbView?.orbState = OrbView.State.ENHANCING
    orbView?.level = 0f

    val live = panelLive
    val panel = buildPanel()
    panel.addView(
      TextView(this).apply {
        text = if (live) "● STREAMING" else "● POLISHING"
        setTextColor(if(live) CORAL else AMBER)
        textSize = 11f
        letterSpacing = 0.15f
        typeface = android.graphics.Typeface.MONOSPACE
        gravity = Gravity.START
      },
    )
    panel.addView(
      TextView(this).apply {
        text = if (live) "Live transcription in progress" else "Polishing with LLM"
        setTextColor(textColor())
        textSize = 15f
        typeface = android.graphics.Typeface.DEFAULT
        gravity = Gravity.START
        val lp = LinearLayout.LayoutParams(
          LinearLayout.LayoutParams.WRAP_CONTENT,
          LinearLayout.LayoutParams.WRAP_CONTENT,
        ).apply {
          topMargin = dp(6)
          bottomMargin = dp(10)
        }
        layoutParams = lp
      },
    )
    // Amber pulse dot (replaces the lavender ● ● ● dots in the old design).
    val dot = View(this).apply {
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(AMBER)
      }
    }
    val dotWrap = FrameLayout(this).apply {
      layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(36))
      addView(
        dot,
        FrameLayout.LayoutParams(dp(14), dp(14), Gravity.CENTER),
      )
    }
    panel.addView(dotWrap)
    val pulse = object : Runnable {
      var step = 0
      override fun run() {
        if (mode != Mode.WORKING) {
          return
        }
        step++
        dot.alpha = 0.45f + 0.55f * (0.5f + 0.5f * sin(step * 0.9f).toFloat())
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
        putExtra("mode", if (live) "live" else "upload")
      }
      applicationContext.startService(intent)
    } catch (_: Exception) {
      handler.removeCallbacks(pulse)
      showResult(ok = false, message = "Couldn't start transcription.")
    }
  }

  /** Live when the saved settings say cloud + live mode. */
  private fun isLiveMode(): Boolean {
    return try {
      val snapshot = UiPrefs.getSettingsSnapshot(this) ?: return false
      val stt = JSONObject(snapshot).optJSONObject("stt") ?: return false
      stt.optString("kind") == "openai-compatible" && stt.optString("mode") == "live"
    } catch (_: Exception) {
      false
    }
  }

  private fun showResult(ok: Boolean, message: String) {
    DictationResultRelay.listener = null
    if (mode != Mode.WORKING && mode != Mode.RECORDING && mode != Mode.BUBBLE) {
      return
    }
    stopTicker()
    stopRingPulse()
    orbView?.orbState = if (ok) OrbView.State.DONE else OrbView.State.ERROR
    orbView?.level = 0f
    mode = Mode.RESULT

    val panel = buildPanel()
    panel.addView(
      TextView(this).apply {
        text = if (ok) "● DONE" else "● SAVED"
        setTextColor(if(ok) DONE else ERR)
        textSize = 11f
        letterSpacing = 0.15f
        typeface = android.graphics.Typeface.MONOSPACE
        gravity = Gravity.START
      },
    )
    panel.addView(
      TextView(this).apply {
        text = message.take(160)
        setTextColor(textColor())
        textSize = 15f
        typeface = android.graphics.Typeface.DEFAULT
        gravity = Gravity.START
        val lp = LinearLayout.LayoutParams(
          LinearLayout.LayoutParams.WRAP_CONTENT,
          LinearLayout.LayoutParams.WRAP_CONTENT,
        ).apply {
          topMargin = dp(6)
          bottomMargin = dp(4)
        }
        layoutParams = lp
      },
    )
    panel.addView(
      TextView(this).apply {
        text = if (ok) "Inserted — back to your app" else "Saved — tap the orb to retry"
        setTextColor(subtextColor())
        textSize = 12f
        typeface = android.graphics.Typeface.DEFAULT
        gravity = Gravity.START
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
    stopRingPulse()
    panelLive = false
    collapseTask?.let { handler.removeCallbacks(it) }
    collapseTask = null
    val old = view
    view = null
    orbView = null
    mode = Mode.NONE
    removeViewAnimated(old)
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

  // ---- waveform + ring pulse --------------------------------------------------

  /** 5-bar live waveform. Bars are recolored and resized by the ticker. */
  private fun waveformRow(): LinearLayout {
    val row = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER or Gravity.BOTTOM
      val h = dp(40)
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.WRAP_CONTENT,
        h,
      ).apply {
        topMargin = dp(6)
        bottomMargin = dp(14)
      }
    }
    val bars = ArrayList<View>(5)
    // Outer/mid/center/mid/outer rest heights in dp. Outer = 8, mid = 18, center = 32.
    val restHeights = intArrayOf(dp(8), dp(18), dp(32), dp(18), dp(8))
    repeat(5) { i ->
      val bar = View(this).apply {
        background = GradientDrawable().apply {
          shape = GradientDrawable.RECTANGLE
          setColor(CORAL)
          cornerRadius = dp(3).toFloat()
        }
        layoutParams = LinearLayout.LayoutParams(dp(5), restHeights[i]).apply {
          leftMargin = dp(3)
          rightMargin = dp(3)
          gravity = Gravity.BOTTOM
        }
      }
      row.addView(bar)
      bars.add(bar)
    }
    waveBars = bars
    // Pulse bars alongside the main ticker.
    startWaveTicker(restHeights)
    return row
  }

  private fun startWaveTicker(restHeights: IntArray) {
    stopWaveTicker()
    val r = object : Runnable {
      override fun run() {
        if (mode != Mode.RECORDING) {
          return
        }
        val s = RecordingController.getState()
        val bars = waveBars
        bars.forEachIndexed { i, bar ->
          val wobble = (0.6f + 0.4f * sin(tickCount * 0.55f + i * 1.15f))
          val level = (s.amplitude * wobble).coerceIn(0f, 1f)
          val restPx = restHeights[i].toFloat()
          val h = (restPx * (0.6f + 0.5f * level)).toInt().coerceAtLeast(dp(6))
          try {
            val lp = bar.layoutParams as LinearLayout.LayoutParams
            lp.height = h
            bar.layoutParams = lp
            // Bar coloring: coral at rest, coral-light mid, amber on peaks
            // (only the center bar can show amber — keeps the design clean).
            val barColor =
              if (i == 2 && level > 0.78f) AMBER
              else if (level > 0.55f) CORAL_LIGHT
              else CORAL
            bar.background = GradientDrawable().apply {
              shape = GradientDrawable.RECTANGLE
              setColor(barColor)
              cornerRadius = dp(3).toFloat()
            }
          } catch (_: Exception) {
          }
        }
        handler.postDelayed(this, 120)
      }
    }
    waveTicker = r
    handler.post(r)
  }

  private fun stopWaveTicker() {
    waveTicker?.let { handler.removeCallbacks(it) }
    waveTicker = null
  }

  /** Drives the orb's pulse ring (only while LISTENING). */
  private fun startRingPulse() {
    stopRingPulse()
    var tick = 0
    val r = object : Runnable {
      override fun run() {
        if (mode != Mode.RECORDING) {
          return
        }
        tick++
        orbView?.ringTick = tick
        handler.postDelayed(this, 80)
      }
    }
    ringAnim = r
    handler.post(r)
  }

  private fun stopRingPulse() {
    ringAnim?.let { handler.removeCallbacks(it) }
    ringAnim = null
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
    orbView = null
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
    old.animate().cancel()
    old.animate()
      .alpha(0f).scaleX(0.96f).scaleY(0.96f)
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
    stopWaveTicker()
    stopRingPulse()
    collapseTask?.let { handler.removeCallbacks(it) }
    collapseTask = null
    val old = view
    view = null
    orbView = null
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
      "OpenType orb",
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
      .setContentTitle("OpenType")
      .setContentText("Tap any text field to dictate.")
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setOngoing(true)
    if (launch != null) {
      builder.setContentIntent(launch)
    }
    return builder.build()
  }
}