package com.opentype.app

/**
 * Delivers headless dictation results to the overlay panel when it is
 * showing. The overlay sets [listener] while its panel is active and
 * clears it on teardown. Null-safe: results are also persisted to
 * pending history, so a missing listener never loses data.
 */
object DictationResultRelay {
  @Volatile
  var listener: ((ok: Boolean, message: String) -> Unit)? = null
}
