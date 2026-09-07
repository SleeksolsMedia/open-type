import {log} from '../logging';
import {friendlyHttpError} from '../net';
import {runDictation} from '../services/pipeline';
import {DEFAULT_SETTINGS, type AppSettings} from '../types';
import {insertOrCopy, reportDictationResult} from './headlessBridge';

interface TaskData {
  fileUri?: string;
  settings?: string;
  enhance?: boolean;
}

function mergeSettings(raw: unknown): AppSettings {
  if (typeof raw !== 'object' || raw === null) {
    return DEFAULT_SETTINGS;
  }
  const parsed = raw as Partial<AppSettings>;
  return {
    ...DEFAULT_SETTINGS,
    ...parsed,
    stt: {...DEFAULT_SETTINGS.stt, ...(parsed.stt ?? {})},
    llm: {...DEFAULT_SETTINGS.llm, ...(parsed.llm ?? {})},
    onboarding: {...DEFAULT_SETTINGS.onboarding, ...(parsed.onboarding ?? {})},
  };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : friendlyHttpError(e);
}

/**
 * Headless entry point (see DictationTaskService). Runs one full dictation
 * from the overlay panel: transcribe → optional enhance → insert, then
 * reports back for the panel UI + pending history.
 */
export default async function dictationTask(data: TaskData): Promise<void> {
  const started = Date.now();
  try {
    if (!data.fileUri) {
      throw new Error('No audio file.');
    }
    const settings = mergeSettings(
      data.settings ? (JSON.parse(data.settings) as unknown) : {},
    );
    const out = await runDictation({
      audioFileUri: data.fileUri,
      audioMimeType: 'audio/wav',
      stt: settings.stt,
      llm: settings.llm,
      enhance: !!data.enhance && settings.llm.enabled,
    });
    const {inserted} = await insertOrCopy(out.finalText);
    const where = inserted ? 'Inserted ✓' : 'Copied to clipboard';
    const entry = {
      id: `${Date.now().toString(36)}-panel`,
      createdAt: Date.now(),
      rawText: out.rawText,
      finalText: out.finalText,
      usedEnhance: out.usedEnhance,
      inserted,
      enhanceSkipped: out.enhanceSkipped,
      durationSec: Math.max(1, Math.round((Date.now() - started) / 1000)),
    };
    await reportDictationResult(
      true,
      out.enhanceSkipped ? `${where} (LLM skipped — offline)` : where,
      JSON.stringify(entry),
    );
  } catch (e) {
    const message = errMsg(e);
    log('error', 'panel-task', message);
    try {
      await reportDictationResult(false, message, null);
    } catch {
      // Nothing left to report to.
    }
  }
}
