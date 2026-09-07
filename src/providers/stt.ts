import {initWhisper, type WhisperContext} from 'whisper.rn';
import {
  fetchWithRetry,
  requireBaseUrl,
  transcriptionsUrl,
} from '../net';
import type {SttConfig} from '../types';
import {getModelPath, isModelDownloaded} from './models';

export class SttConfigurationError extends Error {}

export interface TranscribeArgs {
  fileUri: string;
  mimeType?: string;
  config: SttConfig;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

/**
 * Transcribe an audio file with an OpenAI-compatible
 * `POST {baseUrl}/audio/transcriptions` endpoint.
 * Works with OpenAI, Groq, and self-hosted faster-whisper servers.
 * Retries transient failures; 4xx fails fast with a readable message.
 */
export async function transcribeWithOpenAICompatible({
  fileUri,
  mimeType = 'audio/wav',
  config,
  signal,
}: TranscribeArgs): Promise<string> {
  const base = requireBaseUrl(config.baseUrl);
  const model = (config.model ?? '').trim() || 'whisper-1';

  const form = new FormData();
  form.append('file', {
    uri: fileUri,
    name: 'dictation.wav',
    type: mimeType,
  } as unknown as Blob);
  form.append('model', model);
  form.append('response_format', 'json');
  const language = (config.language ?? '').trim();
  if (language) {
    form.append('language', language);
  }

  const headers: Record<string, string> = {};
  const apiKey = (config.apiKey ?? '').trim();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const res = await fetchWithRetry(
    transcriptionsUrl(base),
    {method: 'POST', headers, body: form},
    {timeoutMs: 120000, retries: 2, signal, tag: 'stt'},
  );
  const json = (await res.json()) as {text?: unknown};
  if (typeof json.text !== 'string' || !json.text.trim()) {
    throw new Error('Transcription server returned an empty result.');
  }
  return json.text.trim();
}

// ---- On-device (whisper.cpp via whisper.rn) --------------------------------

let cachedModelId: string | null = null;
let cachedContext: WhisperContext | null = null;
let initInFlight: Promise<WhisperContext> | null = null;

async function getContext(modelId: string): Promise<WhisperContext> {
  if (cachedContext && cachedModelId === modelId) {
    return cachedContext;
  }
  if (initInFlight && cachedModelId === modelId) {
    return initInFlight;
  }
  const path = await getModelPath(modelId);
  const ready = await isModelDownloaded(modelId);
  if (!ready) {
    throw new SttConfigurationError(
      'On-device model is not downloaded. Download it in Providers first.',
    );
  }
  cachedModelId = modelId;
  initInFlight = (async () => {
    if (cachedContext) {
      await cachedContext.release().catch(() => undefined);
      cachedContext = null;
    }
    const ctx = await initWhisper({filePath: path});
    cachedContext = ctx;
    return ctx;
  })();
  try {
    return await initInFlight;
  } finally {
    initInFlight = null;
  }
}

export async function releaseOnDevice(): Promise<void> {
  initInFlight = null;
  if (cachedContext) {
    await cachedContext.release().catch(() => undefined);
    cachedContext = null;
    cachedModelId = null;
  }
}

/** Fully offline transcription of a 16 kHz WAV file. */
export async function transcribeOnDevice({
  fileUri,
  config,
  onProgress,
}: TranscribeArgs): Promise<string> {
  const modelId = config.onDeviceModelId || 'tiny.en';
  const ctx = await getContext(modelId);
  const language = (config.language ?? '').trim() || 'auto';
  const {promise} = ctx.transcribe(fileUri, {
    language,
    onProgress: onProgress
      ? (p: number) => onProgress(Math.max(0, Math.min(1, p / 100)))
      : undefined,
  });
  const result = await promise;
  const text = result.result?.trim() ?? '';
  if (!text) {
    throw new Error('On-device transcription returned no speech.');
  }
  return text;
}

export async function transcribeAudio(args: TranscribeArgs): Promise<string> {
  if (args.config.kind === 'on-device') {
    return transcribeOnDevice(args);
  }
  return transcribeWithOpenAICompatible(args);
}
