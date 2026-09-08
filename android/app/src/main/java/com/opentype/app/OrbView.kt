package com.opentype.app

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.util.AttributeSet
import android.view.View
import kotlin.math.sin

/**
 * OrbView — the Voicebar Orb mark, hand-drawn in Kotlin/Canvas so the
 * floating overlay (Android only) matches the design-system.html spec
 * exactly. No mic icon, no lavender fill — just an ink circle with a
 * coral 5-bar equalizer mark, animated by [setOrbState] + [setLevel].
 *
 * State machine (mirrors the JS orb):
 *   IDLE      — bars at rest heights
 *   LISTENING — coral pulse ring + bars bounce to amplitude
 *   ENHANCING — amber spark (rotating 4-point star) replaces the bars
 *   DONE      — green check, brief green tint on the circle
 *   ERROR     — coral bars with an orange bang badge in the corner
 *
 * The pulse ring is implemented as a separate translucent coral stroke
 * scaled around the orb's center. The amber spark is a rotated square
 * star path.
 */
class OrbView @JvmOverloads constructor(
  context: Context,
  attrs: AttributeSet? = null,
  defStyleAttr: Int = 0,
) : View(context, attrs, defStyleAttr) {

  enum class State { IDLE, LISTENING, ENHANCING, DONE, ERROR }

  var diameterPx: Int = 132
    set(value) {
      field = value.coerceAtLeast(40)
      invalidate()
    }

  var orbState: State = State.IDLE
    set(value) {
      if (field == value) return
      field = value
      // Add a subtle grow when transitioning to LISTENING.
      if (value == State.LISTENING) {
        animate().scaleX(1.08f).scaleY(1.08f).setDuration(180).start()
      } else if (value == State.DONE) {
        animate().scaleX(1.04f).scaleY(1.04f).setDuration(120).withEndAction {
          animate().scaleX(1f).scaleY(1f).setDuration(220).start()
        }.start()
      } else if (value == State.IDLE || value == State.ERROR) {
        animate().scaleX(1f).scaleY(1f).setDuration(180).start()
      }
      invalidate()
    }

  /** Live amplitude 0..1 from the recorder. */
  var level: Float = 0f
    set(value) {
      field = value.coerceIn(0f, 1f)
      invalidate()
    }

  /** Pulse ring animation tick (set by the service every ~80ms while listening). */
  var ringTick: Int = 0
    set(value) {
      field = value
      invalidate()
    }

  // Mark geometry in dp (matches design-system.html).
  private val MARK_OUTER_HEIGHT = 0.24f   // outer bars
  private val MARK_MID_HEIGHT = 0.44f    // mid bars
  private val MARK_CENTER_HEIGHT = 0.64f // center bar
  private val BAR_OPACITY_OUTER = 0.55f
  private val BAR_OPACITY_MID = 0.78f
  private val BAR_OPACITY_CENTER = 1f
  private val MARK_PADDING = 0.11f      // space inside the orb

  private val inkPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val coralPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val coralLightPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val amberPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val donePaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val errPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val ringPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
  }
  private val shadowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.FILL
  }

  init {
    setLayerType(LAYER_TYPE_SOFTWARE, null)
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    val side = diameterPx + dp(20) // room for ring pulse outset
    setMeasuredDimension(side, side)
  }

  private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

  override fun onDraw(canvas: Canvas) {
    val cx = width / 2f
    val cy = height / 2f
    val r = diameterPx / 2f

    inkPaint.color = when (orbState) {
      State.DONE -> 0xFF0F8E7E.toInt()  // DONE
      else -> 0xFF1A1714.toInt()        // INK
    }
    coralPaint.color = 0xFFE8552B.toInt()
    coralLightPaint.color = 0xFFF27A54.toInt()
    amberPaint.color = 0xFFF2B705.toInt()
    donePaint.color = 0xFF0F8E7E.toInt()
    errPaint.color = 0xFFD64524.toInt()

    // ---- shadow (soft) --------------------------------------------------------
    shadowPaint.color = Color.argb(48, 0, 0, 0)
    canvas.drawCircle(cx, cy + dp(8), r * 0.98f, shadowPaint)

    // ---- surface --------------------------------------------------------------
    canvas.drawCircle(cx, cy, r, inkPaint)

    // ---- pulse ring (LISTENING only) ----------------------------------------
    if (orbState == State.LISTENING) {
      ringPaint.color = 0xFFE8552B.toInt()
      ringPaint.strokeWidth = dp(2).toFloat()
      val phase = (ringTick % 20) / 20f
      val scale = 1.0f + 0.6f * phase
      val alpha = ((1f - phase) * 0.55f).coerceAtLeast(0f)
      ringPaint.alpha = (alpha * 255).toInt()
      canvas.drawCircle(cx, cy, r * scale, ringPaint)
    }

    // ---- mark ----------------------------------------------------------------
    val markSize = r * 2f * (1f - MARK_PADDING * 2f)
    val markHalf = markSize / 2f
    when (orbState) {
      State.ENHANCING -> drawAmberSpark(canvas, cx, cy, markHalf)
      State.DONE -> drawDoneCheck(canvas, cx, cy, markHalf)
      else -> drawBarsMark(canvas, cx, cy, r)
    }

    // ---- error badge ----------------------------------------------------------
    if (orbState == State.ERROR) {
      val badge = r * 0.36f
      val bx = cx + r * 0.62f
      val by = cy - r * 0.62f
      canvas.drawCircle(bx, by, badge, errPaint)
      // White exclamation
      val w = badge * 0.14f
      val h = badge * 0.5f
      errPaint.color = 0xFFFFFFFF.toInt()
      canvas.drawRect(
        RectF(bx - w / 2, by - h / 2, bx + w / 2, by + h / 2),
        errPaint,
      )
      val dotR = badge * 0.07f
      canvas.drawCircle(bx, by + badge * 0.32f, dotR, errPaint)
    }
  }

  /** 5-bar equalizer at center of the orb. */
  private fun drawBarsMark(canvas: Canvas, cx: Float, cy: Float, r: Float) {
    val markHeight = r * 1.4f
    val maxBar = markHeight * MARK_CENTER_HEIGHT
    val midBar = markHeight * MARK_MID_HEIGHT
    val outerBar = markHeight * MARK_OUTER_HEIGHT
    // Outer / mid / center / mid / outer positions in the 100x100 design box.
    val xPositions = floatArrayOf(26f, 38f, 50f, 62f, 74f)
    val restHeights = floatArrayOf(outerBar, midBar, maxBar, midBar, outerBar)
    val opacities = floatArrayOf(
      BAR_OPACITY_OUTER,
      BAR_OPACITY_MID,
      BAR_OPACITY_CENTER,
      BAR_OPACITY_MID,
      BAR_OPACITY_OUTER,
    )
    val barW = markHeight * 0.11f
    val xLeft = cx - markHeight * 0.5f
    // Convert design-box x positions (0..100) to canvas pixels.
    val xMin = xPositions[0]
    val xMax = xPositions[4]
    for (i in 0..4) {
      val frac = (xPositions[i] - xMin) / (xMax - xMin)
      val px = xLeft + frac * (markHeight * 0.74f)
      val restPx = restHeights[i]
      // While LISTENING, bars bounce to amplitude. While IDLE, sit at rest.
      val amp = if (orbState == State.LISTENING) {
        val phase = sin((ringTick * 0.6f + i * 0.9f).toDouble()).toFloat()
        val target = (restPx * (0.55f + level * 0.6f)).coerceIn(restPx * 0.35f, restPx * 1.25f)
        val wobble = 0.5f + 0.5f * phase
        target * (0.7f + 0.3f * wobble)
      } else {
        restPx
      }
      val h = amp.coerceAtLeast(barW * 1.5f)
      val rect = RectF(
        px - barW / 2,
        cy - h / 2,
        px + barW / 2,
        cy + h / 2,
      )
      val paint = when {
        i == 2 && orbState == State.LISTENING && level > 0.78f -> amberPaint
        orbState == State.LISTENING && level > 0.55f -> coralLightPaint
        else -> coralPaint
      }
      paint.alpha = (opacities[i] * 255).toInt()
      canvas.drawRoundRect(rect, barW / 2, barW / 2, paint)
    }
  }

  /** Rotating amber 4-point spark — the LLM-polishing indicator. */
  private fun drawAmberSpark(canvas: Canvas, cx: Float, cy: Float, half: Float) {
    canvas.save()
    val rot = (ringTick * 8f) % 360f
    canvas.rotate(rot, cx, cy)
    val outer = half * 0.85f
    val inner = half * 0.28f
    val path = android.graphics.Path()
    val k = 0.55f
    path.moveTo(cx, cy - outer)
    path.lineTo(cx + inner * k, cy - inner * (1f - k))
    path.lineTo(cx + outer, cy)
    path.lineTo(cx + inner * k, cy + inner * (1f - k))
    path.lineTo(cx, cy + outer)
    path.lineTo(cx - inner * k, cy + inner * (1f - k))
    path.lineTo(cx - outer, cy)
    path.lineTo(cx - inner * k, cy - inner * (1f - k))
    path.close()
    canvas.drawPath(path, amberPaint)
    canvas.restore()
  }

  /** Green checkmark on the DONE state. */
  private fun drawDoneCheck(canvas: Canvas, cx: Float, cy: Float, half: Float) {
    donePaint.color = 0xFFFFFFFF.toInt()
    donePaint.style = Paint.Style.STROKE
    donePaint.strokeWidth = half * 0.22f
    donePaint.strokeCap = Paint.Cap.ROUND
    donePaint.strokeJoin = Paint.Join.ROUND
    val s = half * 0.65f
    val path = android.graphics.Path()
    path.moveTo(cx - s, cy + s * 0.05f)
    path.lineTo(cx - s * 0.2f, cy + s * 0.7f)
    path.lineTo(cx + s * 0.9f, cy - s * 0.55f)
    canvas.drawPath(path, donePaint)
    donePaint.style = Paint.Style.FILL
  }
}