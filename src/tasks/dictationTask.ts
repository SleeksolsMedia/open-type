import {log} from '../logging';
import {friendlyHttpError, HttpError} from '../net';
import {enhanceTranscript} from '../providers/llm';
import {runDictation} from '../services/pipeline';
import {isUploadUsable} from '../services/fallback';
import {b64decode} from '../stream/codec';
import {createDriver} from '../stream/drivers';
import {LiveSession} from '../stream/session';
import {DEFAULT_SETTINGS, type AppSettings, type DictationResult} from '../types';
import {
  consumeDroppedFrames,
  drainAudioFrames,
  insertOrCopy,
  reportDictationResult,
} from './headlessBridge';

interface TaskData {
  fileUri?: string;
  settings?: string;
  enhance?: boolean;
  mode?: 'upload' | 'live';
}

function mergeSettings(raw: unknown): AppSettings {
  if (typeof raw !== 'object' || raw === null) {
    return DEFAULT_SETTINGS;
  }
  const parsed = raw as Partial<AppSettings>;
  const parsedStt = (parsed.stt ?? {}) as Partial<AppSettings['stt']>;
  return {
    ...DEFAULT_SETTINGS,
    ...parsed,
    stt: {
      ...DEFAULT_SETTINGS.stt,
      ...parsedStt,
      live: {...DEFAULT_SETTINGS.stt.live, ...(parsedStt.live ?? {})},
    },
    llm: {...DEFAULT_SETTINGS.llm, ...(parsed.llm ?? {})},
    onboarding: {...DEFAULT_SETTINGS.onboarding, ...(parsed.onboarding ?? {})},
  };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : friendlyHttpError(e);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface FinishArgs {
  out: DictationResult;
  started: number;
  enhance: boolean;
  llm: AppSettings['llm'];
}

async function finishTranscript({
  out,
  started,
  enhance,
  llm,
}: FinishArgs): Promise<void> {
  let finalText = out.finalText;
  let usedEnhance = out.usedEnhance;
  let enhanceSkipped = out.enhanceSkipped;
  if (enhance && llm.enabled && !usedEnhance && !enhanceSkipped) {
    try {
      const enhanced = await enhanceTranscript({
        text: out.rawText,
        config: {...llm, enabled: true},
      });
      finalText = enhanced.text;
      usedEnhance = enhanced.usedEnhance;
    } catch (e) {
      if (e instanceof HttpError && e.status < 500 && e.status !== 429) {
        throw e;
      }
      log('warn', 'panel-task', 'LLM enhance skipped (offline).');
      enhanceSkipped = true;
    }
  }
  const {inserted} = await insertOrCopy(finalText);
  const where = inserted ? 'Inserted ✓' : 'Copied to clipboard';
  const notes = [
    enhanceSkipped ? 'LLM skipped — offline' : '',
    out.liveFallback ? 'live failed — used upload' : out.live ? 'live' : '',
  ].filter(Boolean);
  const entry = {
    id: `${Date.now().toString(36)}-panel`,
    createdAt: Date.now(),
    rawText: out.rawText,
    finalText,
    usedEnhance,
    inserted,
    enhanceSkipped,
    live: out.live,
    liveFallback: out.liveFallback,
    durationSec: Math.max(1, Math.round((Date.now() - started) / 1000)),
  };
  await reportDictationResult(
    true,
    notes.length > 0 ? `${where} (${notes.join(', ')})` : where,
    JSON.stringify(entry),
  );
}

/**
 * Bubble live flow: drain the native frame queue, stream it through the
 * configured WS driver (paced), collect finals. Falls back to the retained
 * WAV upload only when upload is actually usable.
 */
async function runLiveHeadless(
  settings: AppSettings,
  started: number,
  enhance: boolean,
  fileUri: string,
): Promise<void> {
  const frames = await drainAudioFrames();
  const dropped = await consumeDroppedFrames();
  if (dropped > 0) {
    log('warn', 'panel-task', `${dropped} audio frames dropped (queue cap).`);
  }
  const driver = createDriver(settings.stt.live);
  const session = new LiveSession(driver);
  try {
    await session.start(undefined, false);
  } catch (e) {
    throw new Error(
      `Live unavailable: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  try {
    for (const frame of frames) {
      try {
        driver.sendAudio(b64decode(frame));
      } catch {
        // A bad frame must never kill the session.
      }
      await sleep(15);
    }
    const {transcript, error} = await session.stop();
    const canFallback =
      settings.stt.live.fallbackToUpload &&
      (await isUploadUsable({...settings.stt, kind: 'openai-compatible'}));
    if ((transcript.trim() === '' || error != null) && canFallback) {
      log(
        'warn',
        'panel-task',
        `Live path unusable (${error ?? 'no speech detected'}) — HTTP fallback.`,
      );
      const out = await runDictation({
        audioFileUri: fileUri,
        audioMimeType: 'audio/wav',
        stt: {...settings.stt, kind: 'openai-compatible'},
        llm: settings.llm,
        enhance: false, // enhance runs once in finishTranscript
      });
      await finishTranscript({
        out: {...out, live: true, liveFallback: true},
        started,
        enhance,
        llm: settings.llm,
      });
      return;
    }
    if (transcript.trim() === '') {
      throw new Error(error ?? 'Live transcription heard nothing.');
    }
    if (error) {
      log('warn', 'panel-task', `Continuing with partial live finals: ${error}`);
    }
    await finishTranscript({
      out: {rawText: transcript, finalText: transcript, usedEnhance: false, live: true},
      started,
      enhance,
      llm: settings.llm,
    });
  } catch (e) {
    try {
      await session.abort();
    } catch {
      // Ignore cleanup errors.
    }
    throw e instanceof Error ? e : new Error(String(e));
  }
}

/**
 * Headless entry point (see DictationTaskService). Runs one full dictation
 * from the overlay panel — live WebSocket when configured, else the classic
 * upload pipeline — then reports back for the panel UI + pending history.
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
    const useLive =
      data.mode === 'live' &&
      settings.stt.kind === 'openai-compatible' &&
      settings.stt.mode === 'live';
    if (useLive) {
      await runLiveHeadless(settings, started, !!data.enhance, data.fileUri);
      return;
    }
    const out = await runDictation({
      audioFileUri: data.fileUri,
      audioMimeType: 'audio/wav',
      stt: settings.stt,
      llm: settings.llm,
      enhance: !!data.enhance && settings.llm.enabled,
    });
    await finishTranscript({
      out,
      started,
      enhance: !!data.enhance && settings.llm.enabled,
      llm: settings.llm,
    });
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
