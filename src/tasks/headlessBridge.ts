import {Clipboard, NativeModules, Platform} from 'react-native';

/**
 * Minimal bridge for the headless dictation task. Deliberately imports
 * nothing from the rest of the app (no MMKV, no store): the headless JS
 * runtime may not have those native modules installed.
 */

function native(): {
  insertText?: (text: string) => Promise<boolean>;
  copyToClipboard?: (text: string) => Promise<void>;
  reportDictationResult?: (
    ok: boolean,
    message: string,
    entryJson: string | null,
  ) => Promise<void>;
} | null {
  if (Platform.OS !== 'android') {
    return null;
  }
  return (NativeModules.DictationModule ?? null) as unknown as {
    insertText?: (text: string) => Promise<boolean>;
    copyToClipboard?: (text: string) => Promise<void>;
    reportDictationResult?: (
      ok: boolean,
      message: string,
      entryJson: string | null,
    ) => Promise<void>;
  } | null;
}

function safeCopy(text: string): void {
  try {
    Clipboard.setString(text);
  } catch {
    // No clipboard here; the message still reaches the panel.
  }
}

export async function insertOrCopy(
  text: string,
): Promise<{inserted: boolean}> {
  const n = native();
  if (n?.insertText) {
    try {
      if (await n.insertText(text)) {
        return {inserted: true};
      }
      if (n.copyToClipboard) {
        await n.copyToClipboard(text);
      } else {
        safeCopy(text);
      }
      return {inserted: false};
    } catch {
      safeCopy(text);
      return {inserted: false};
    }
  }
  safeCopy(text);
  return {inserted: false};
}

export async function reportDictationResult(
  ok: boolean,
  message: string,
  entryJson: string | null,
): Promise<void> {
  try {
    await native()?.reportDictationResult?.(ok, message, entryJson);
  } catch {
    // Panel is gone; the pending-history write already happened natively
    // only if reachable — nothing more we can do headlessly.
  }
}
