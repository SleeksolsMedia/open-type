import {Platform, Vibration} from 'react-native';

/**
 * Haptic vocabulary used across the app. Each pattern is a sequence of
 * `wait` + `vibrate` durations in ms, as documented by React Native's
 * Vibration API (Android only — iOS will simply skip).
 *
 * Caller checks `enabled` from settings before invoking, so we don't
 * need to gate inside each pattern.
 */

export type HapticTrigger =
  | 'record-start'
  | 'record-stop'
  | 'insert-ok'
  | 'insert-fail'
  | 'perm-denied'
  | 'download-done';

const PATTERNS: Record<HapticTrigger, number | number[]> = {
  // Light, single bump — confirms "I'm listening."
  'record-start': 12,
  // Medium double-tap — marks the boundary.
  'record-stop': [0, 18, 60, 18],
  // Success notification — three gentle pulses.
  'insert-ok': [0, 14, 70, 14, 70, 14],
  // Fallback to clipboard — single longer buzz.
  'insert-fail': 60,
  // Permission denied — error pattern.
  'perm-denied': [0, 30, 80, 30],
  // Model download finished — success notification.
  'download-done': [0, 22, 80, 22, 80, 22],
};

export function haptic(trigger: HapticTrigger, enabled: boolean): void {
  if (!enabled) {
    return;
  }
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return;
  }
  try {
    const pattern = PATTERNS[trigger];
    if (typeof pattern === 'number') {
      Vibration.vibrate(pattern);
    } else {
      Vibration.vibrate(pattern);
    }
  } catch {
    // Some Android ROMs reject long patterns; fall back to a tiny vibrate.
    try {
      Vibration.vibrate(8);
    } catch {
      // Best-effort.
    }
  }
}