import {
  Clipboard,
  DeviceEventEmitter,
  NativeModules,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import {MMKV, createMMKV} from 'react-native-mmkv';
import {injectStorage} from '../store/settings';

export interface RecorderState {
  recording: boolean;
  /** 0..1 voice level for the waveform. */
  amplitude: number;
  durationMs: number;
  sizeBytes: number;
}

interface DictationNativeModule {
  showBubble(): Promise<void>;
  hideBubble(): Promise<void>;
  isOverlayPermissionGranted(): Promise<boolean>;
  requestOverlayPermission(): Promise<void>;
  isAccessibilityEnabled(): Promise<boolean>;
  openAccessibilitySettings(): Promise<void>;
  startRecording(): Promise<string>;
  stopRecording(): Promise<string>;
  cancelRecording(): Promise<void>;
  getRecorderState(): Promise<RecorderState>;
  getInterruptedRecording(): Promise<string | null>;
  discardInterruptedRecording(): Promise<void>;
  isBatteryExempt(): Promise<boolean>;
  requestBatteryExemption(): Promise<void>;
  insertText(text: string): Promise<boolean>;
  copyToClipboard(text: string): Promise<void>;
  secureSet(key: string, value: string): Promise<void>;
  secureGet(key: string): Promise<string | null>;
  secureDelete(key: string): Promise<void>;
  getOrCreateStorageKey(): Promise<string>;
  setBubbleEnabled(enabled: boolean): Promise<void>;
  isBubbleEnabled(): Promise<boolean>;
  setBubbleAppearance(size: number, opacity: number): Promise<void>;
  setOnboardingComplete(): Promise<void>;
  syncSettingsSnapshot(json: string): Promise<void>;
  drainPendingHistory(): Promise<string[]>;
}

const native = NativeModules.DictationModule as
  | DictationNativeModule
  | undefined;

export function isNativeAvailable(): boolean {
  return Platform.OS === 'android' && native != null;
}

function requireNative(): DictationNativeModule {
  if (!isNativeAvailable() || !native) {
    throw new Error('Dictation native module is only available on Android builds.');
  }
  return native;
}

export async function requestMicrophonePermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return false;
  }
  const results = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    ...(Platform.Version >= 33
      ? [PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS]
      : []),
  ]);
  return (
    results[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] ===
    PermissionsAndroid.RESULTS.GRANTED
  );
}

export async function isMicrophoneGranted(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return false;
  }
  return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
}

export async function showBubble(): Promise<void> {
  await requireNative().showBubble();
}

export async function hideBubble(): Promise<void> {
  await requireNative().hideBubble();
}

export async function isOverlayPermissionGranted(): Promise<boolean> {
  if (!isNativeAvailable()) {
    return false;
  }
  return requireNative().isOverlayPermissionGranted();
}

export async function requestOverlayPermission(): Promise<void> {
  await requireNative().requestOverlayPermission();
}

export async function isAccessibilityEnabled(): Promise<boolean> {
  if (!isNativeAvailable()) {
    return false;
  }
  return requireNative().isAccessibilityEnabled();
}

export async function openAccessibilitySettings(): Promise<void> {
  await requireNative().openAccessibilitySettings();
}

export async function startRecording(): Promise<string> {
  return requireNative().startRecording();
}

export async function stopRecording(): Promise<string> {
  return requireNative().stopRecording();
}

export async function cancelRecording(): Promise<void> {
  if (!isNativeAvailable()) {
    return;
  }
  await requireNative().cancelRecording();
}

export async function getRecorderState(): Promise<RecorderState> {
  if (!isNativeAvailable()) {
    return {recording: false, amplitude: 0, durationMs: 0, sizeBytes: 0};
  }
  return requireNative().getRecorderState();
}

export async function getInterruptedRecording(): Promise<string | null> {
  if (!isNativeAvailable()) {
    return null;
  }
  return requireNative().getInterruptedRecording();
}

export async function discardInterruptedRecording(): Promise<void> {
  if (!isNativeAvailable()) {
    return;
  }
  await requireNative().discardInterruptedRecording();
}

export async function isBatteryExempt(): Promise<boolean> {
  if (!isNativeAvailable()) {
    return false;
  }
  return requireNative().isBatteryExempt().catch(() => false);
}

export async function requestBatteryExemption(): Promise<void> {
  await requireNative().requestBatteryExemption();
}

/** Fired by native code when a recording hits the 10-minute cap. */
export function onRecordingAutoStopped(
  fn: (fileUri: string) => void,
): () => void {
  const sub = DeviceEventEmitter.addListener(
    'RecordingAutoStopped',
    (path: unknown) => {
      if (typeof path === 'string') {
        fn(path.startsWith('file://') ? path : `file://${path}`);
      }
    },
  );
  return () => sub.remove();
}

/**
 * Insert into the focused field via AccessibilityService.
 * Falls back to clipboard when native insert is unavailable or fails.
 */
export async function insertOrCopy(text: string): Promise<{ inserted: boolean }> {
  if (isNativeAvailable()) {
    try {
      const inserted = await requireNative().insertText(text);
      if (inserted) {
        return { inserted: true };
      }
      await requireNative().copyToClipboard(text);
      return { inserted: false };
    } catch {
      safeCopy(text);
      return { inserted: false };
    }
  }
  safeCopy(text);
  return { inserted: false };
}

function safeCopy(text: string): void {
  try {
    Clipboard.setString(text);
  } catch {
    // No clipboard in this environment; text stays visible on screen.
  }
}

/**
 * Persist settings/history in encrypted MMKV. The encryption key is a
 * 256-bit random value held in Keystore-backed storage. Falls back to
 * in-memory storage outside Android builds or when native init fails.
 */
export async function initPersistentStorage(): Promise<void> {
  if (!isNativeAvailable()) {
    return;
  }
  try {
    const encryptionKey = await requireNative().getOrCreateStorageKey();
    const mmkv: MMKV = createMMKV({
      id: 'opentype-settings',
      encryptionKey,
    });
    injectStorage({
      getItem: async (key: string) => mmkv.getString(key) ?? null,
      setItem: async (key: string, value: string) => {
        mmkv.set(key, value);
      },
    });
  } catch {
    // Memory fallback (already the default).
  }
}

/** Master switch for the automatic bubble (default on). */
export async function setBubbleEnabled(enabled: boolean): Promise<void> {
  if (!isNativeAvailable()) {
    return;
  }
  await requireNative().setBubbleEnabled(enabled);
}

export async function isBubbleEnabled(): Promise<boolean> {
  if (!isNativeAvailable()) {
    return false;
  }
  return requireNative().isBubbleEnabled().catch(() => true);
}

export async function setBubbleAppearance(
  size: number,
  opacity: number,
): Promise<void> {
  if (!isNativeAvailable()) {
    return;
  }
  await requireNative().setBubbleAppearance(size, opacity).catch(() => undefined);
}

/** Lets the bubble service run once setup is done. Idempotent. */
export async function setOnboardingComplete(): Promise<void> {
  if (!isNativeAvailable()) {
    return;
  }
  await requireNative().setOnboardingComplete().catch(() => undefined);
}

/** Mirror settings for the headless overlay-panel task. */
export async function syncSettingsSnapshot(json: string): Promise<void> {
  if (!isNativeAvailable()) {
    return;
  }
  await requireNative().syncSettingsSnapshot(json).catch(() => undefined);
}

export async function drainPendingHistory(): Promise<string[]> {
  if (!isNativeAvailable()) {
    return [];
  }
  return requireNative().drainPendingHistory().catch(() => []);
}
