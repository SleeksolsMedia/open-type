package com.opentype.app

import android.accessibilityservice.AccessibilityService
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * System-wide dictation support. Used exclusively to detect the focused
 * editable text field and insert dictated text. No screen content is read,
 * stored, or transmitted beyond the active text field.
 */
class DictationAccessibilityService : AccessibilityService() {

  companion object {
    @Volatile
    var instance: DictationAccessibilityService? = null
      private set

    fun insertText(text: String): Boolean {
      val service = instance ?: return false
      return service.insertIntoFocusedField(text)
    }
  }

  override fun onServiceConnected() {
    instance = this
  }

  override fun onUnbind(intent: Intent?): Boolean {
    if (instance === this) {
      instance = null
    }
    try {
      OverlayService.hideView(this)
    } catch (_: Exception) {
    }
    return super.onUnbind(intent)
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    val type = event?.eventType ?: return
    if (type != AccessibilityEvent.TYPE_VIEW_FOCUSED &&
      type != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED &&
      type != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
    ) {
      return
    }
    scheduleVisibilityCheck()
  }

  // ---- automatic bubble visibility -------------------------------------------

  private val handler = Handler(Looper.getMainLooper())
  private var pendingCheck: Runnable? = null

  /** Debounced: showing/hiding on every keystroke event would flicker. */
  private fun scheduleVisibilityCheck() {
    pendingCheck?.let { handler.removeCallbacks(it) }
    val check = Runnable { updateBubbleVisibility() }
    pendingCheck = check
    handler.postDelayed(check, 300)
  }

  private fun updateBubbleVisibility() {
    try {
      if (!UiPrefs.isOnboardingDone(this) || !UiPrefs.isBubbleEnabled(this)) {
        OverlayService.hideView(this)
        return
      }
      val target = rootInActiveWindow?.let { findFocusedEditable(it) }
      if (target != null && !target.isPassword) {
        OverlayService.showView(this)
      } else {
        OverlayService.hideView(this)
      }
    } catch (_: Exception) {
      try {
        OverlayService.hideView(this)
      } catch (_: Exception) {
      }
    }
  }

  override fun onInterrupt() {
    // No-op.
  }

  private fun insertIntoFocusedField(text: String): Boolean {
    val root = rootInActiveWindow ?: return false
    try {
      val target = findFocusedEditable(root) ?: return false
      // 1) Direct set-text on the focused node.
      val args = Bundle().apply {
        putCharSequence(
          AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
          text,
        )
      }
      if (target.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) {
        return true
      }
      // 2) Clipboard + paste fallback inside the target app.
      val clipboard =
        getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
      clipboard.setPrimaryClip(ClipData.newPlainText("opentype", text))
      return target.performAction(AccessibilityNodeInfo.ACTION_PASTE)
    } catch (_: Exception) {
      return false
    }
  }

  private fun findFocusedEditable(node: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
    if (node == null) {
      return null
    }
    if (node.isEditable && node.isFocused) {
      return node
    }
    for (i in 0 until node.childCount) {
      val found = findFocusedEditable(node.getChild(i))
      if (found != null) {
        return found
      }
    }
    return null
  }
}
