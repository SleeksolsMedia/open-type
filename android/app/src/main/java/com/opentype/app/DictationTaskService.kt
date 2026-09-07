package com.opentype.app

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Runs one dictation (transcribe → enhance → insert) without any UI,
 * triggered by the overlay panel's Stop button. The JS task reports back
 * via DictationModule.reportDictationResult.
 */
class DictationTaskService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val extras = intent?.extras ?: return null
    if (!extras.containsKey("fileUri") || !extras.containsKey("settings")) {
      return null
    }
    return HeadlessJsTaskConfig(
      "DictationTask",
      Arguments.fromBundle(extras),
      120000,
      true,
    )
  }
}
