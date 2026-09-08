import {log} from '../logging';
import {cancelRecording, stopRecording} from '../native/modules';
import {HttpError} from '../net';
import {enhanceTranscript} from '../providers/llm';
import {runDictation} from './pipeline';
import {isUploadUsable} from './fallback';
import {LiveSession, type LiveStage} from '../stream/session';
import {createDriver} from '../stream/drivers';
import {LiveUnavailableError} from '../stream/types';
import type {DictationResult, LlmConfig, SttConfig} from '../types';

export interface LiveController {
  stop: () => Promise<DictationResult>;
  cancel: () => Promise<void>;
}

export interface StartLiveArgs {
  stt: SttConfig;
  llm: LlmConfig;
  enhance: boolean;
  signal?: AbortSignal;
  onStage?: (s: LiveStage | 'enhancing' | 'done') => void;
}

function fileUriOf(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

/**
 * Live transcription: connects first (fast fail), then the caller records
 * while frames stream. Stop flushes finals from the socket.
 *
 * Failure contract:
 * - connect/setup failure → throws LiveUnavailableError (nothing recorded
 *   yet; caller runs the classic upload flow instead).
 * - mid-stream failure or empty finals → HTTP fallback on the retained WAV
 *   when enabled; otherwise throws the live error.
 */
export async function startLiveDictation({
  stt,
  llm,
  enhance,
  signal,
  onStage,
}: StartLiveArgs): Promise<LiveController> {
  const driver = createDriver(stt.live);
  const session = new LiveSession(driver, s => onStage?.(s));

  try {
    await session.start(signal);
  } catch (e) {
    try {
      await session.abort();
    } catch {
      // Ignore cleanup errors.
    }
    throw new LiveUnavailableError(
      e instanceof Error ? e.message : String(e),
    );
  }

  const stop = async (): Promise<DictationResult> => {
    let wavPath: string;
    try {
      wavPath = await stopRecording();
    } catch (e) {
      await session.abort();
      await cancelRecording().catch(() => undefined);
      throw e instanceof Error ? e : new Error(String(e));
    }
    const file = fileUriOf(wavPath);

    const {transcript, error} = await session.stop();
    // Fallback only when upload can actually run — otherwise surface the
    // original live error instead of a misleading "base URL missing".
    const canFallback =
      stt.live.fallbackToUpload &&
      (await isUploadUsable({...stt, kind: 'openai-compatible'}));
    const useFallback =
      (transcript.trim() === '' || error != null) && canFallback;
    if (useFallback) {
      log(
        'warn',
        'live',
        `Live path unusable (${error ?? 'no speech detected'}) — HTTP fallback on retained audio.`,
      );
      const out = await runDictation({
        audioFileUri: file,
        audioMimeType: 'audio/wav',
        stt: {...stt, kind: 'openai-compatible'},
        llm,
        enhance: enhance && llm.enabled,
        signal,
        onStage: st => onStage?.(st === 'done' ? 'done' : 'enhancing'),
      });
      return {...out, live: true, liveFallback: true};
    }
    if (transcript.trim() === '') {
      throw new Error(error ?? 'Live transcription heard nothing.');
    }
    if (error) {
      log('warn', 'live', `Continuing with partial live finals: ${error}`);
    }
    if (!enhance || !llm.enabled) {
      onStage?.('done');
      return {
        rawText: transcript,
        finalText: transcript,
        usedEnhance: false,
        live: true,
      };
    }
    onStage?.('enhancing');
    try {
      const {text, usedEnhance} = await enhanceTranscript({
        text: transcript,
        config: {...llm, enabled: true},
        signal,
      });
      onStage?.('done');
      return {rawText: transcript, finalText: text, usedEnhance, live: true};
    } catch (e) {
      // Same degrade rule as the upload pipeline (see pipeline.ts).
      if (e instanceof HttpError && e.status < 500 && e.status !== 429) {
        throw e;
      }
      if (signal?.aborted) {
        throw new Error('Cancelled.');
      }
      log('warn', 'live', 'LLM enhance skipped (offline).');
      onStage?.('done');
      return {
        rawText: transcript,
        finalText: transcript,
        usedEnhance: false,
        enhanceSkipped: true,
        live: true,
      };
    }
  };

  const cancel = async (): Promise<void> => {
    await session.abort();
    await cancelRecording().catch(() => undefined);
  };

  return {stop, cancel};
}
