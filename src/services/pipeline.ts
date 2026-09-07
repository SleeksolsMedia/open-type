import {log} from '../logging';
import {HttpError} from '../net';
import {enhanceTranscript} from '../providers/llm';
import {transcribeAudio} from '../providers/stt';
import type {DictationResult, LlmConfig, SttConfig} from '../types';

export type PipelineStage = 'transcribing' | 'enhancing' | 'done';

export interface RunDictationArgs {
  audioFileUri: string;
  audioMimeType?: string;
  stt: SttConfig;
  llm: LlmConfig;
  enhance: boolean;
  signal?: AbortSignal;
  onStage?: (stage: PipelineStage) => void;
  onTranscribeProgress?: (fraction: number) => void;
}

export class DictationBusyError extends Error {
  constructor() {
    super('A dictation is already running. Finish or cancel it first.');
  }
}

let running = false;

/** record -> transcribe -> (optional) enhance. Insertion is handled by the caller. */
export async function runDictation({
  audioFileUri,
  audioMimeType,
  stt,
  llm,
  enhance,
  signal,
  onStage,
  onTranscribeProgress,
}: RunDictationArgs): Promise<DictationResult> {
  if (running) {
    throw new DictationBusyError();
  }
  running = true;
  try {
    if (signal?.aborted) {
      throw new Error('Cancelled.');
    }
    onStage?.('transcribing');
    const rawText = await transcribeAudio({
      fileUri: audioFileUri,
      mimeType: audioMimeType,
      config: stt,
      signal,
      onProgress: onTranscribeProgress,
    });

    if (!enhance) {
      onStage?.('done');
      return {rawText, finalText: rawText, usedEnhance: false};
    }

    onStage?.('enhancing');
    try {
      const {text, usedEnhance} = await enhanceTranscript({
        text: rawText,
        config: {...llm, enabled: true},
        signal,
      });
      onStage?.('done');
      return {rawText, finalText: text, usedEnhance};
    } catch (e) {
      // Config errors (bad key/model/URL) must surface so the user fixes
      // them. Anything else (offline, timeout, server down, rate limit)
      // degrades gracefully: keep the raw transcript.
      if (e instanceof HttpError && e.status < 500 && e.status !== 429) {
        throw e;
      }
      if (signal?.aborted) {
        throw new Error('Cancelled.');
      }
      const reason = e instanceof Error ? e.message : String(e);
      log('warn', 'pipeline', `LLM enhance skipped: ${reason}`);
      onStage?.('done');
      return {rawText, finalText: rawText, usedEnhance: false, enhanceSkipped: true};
    }
  } finally {
    running = false;
  }
}

export function isDictationRunning(): boolean {
  return running;
}
