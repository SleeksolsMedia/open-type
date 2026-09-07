import {log} from './logging';
import {friendlyHttpError} from './net';
import {probeLlm} from './providers/llm';
import {transcribeAudio} from './providers/stt';
import {
  cancelRecording,
  isNativeAvailable,
  startRecording,
  stopRecording,
} from './native/modules';
import type {LlmConfig, SttConfig} from './types';

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * End-to-end STT check: records a short sample on-device, transcribes it
 * with the given config, returns the transcript. Throws a readable error.
 */
export async function testStt(
  config: SttConfig,
  onStatus: (s: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (!isNativeAvailable()) {
    throw new Error('Test needs an Android build.');
  }
  onStatus('Recording a 3-second sample… speak now.');
  await startRecording();
  try {
    for (let i = 0; i < 30; i++) {
      if (signal?.aborted) {
        throw new Error('Cancelled.');
      }
      await sleep(100);
    }
    onStatus('Transcribing sample…');
    const donePath = await stopRecording();
    const doneUri = donePath.startsWith('file://')
      ? donePath
      : `file://${donePath}`;
    const text = await transcribeAudio({
      fileUri: doneUri,
      mimeType: 'audio/wav',
      config,
      signal,
    });
    log('info', 'test', `STT test OK (${text.length} chars)`);
    return text;
  } catch (e) {
    await cancelRecording().catch(() => undefined);
    if (e instanceof Error) {
      throw e;
    }
    throw new Error(friendlyHttpError(e));
  }
}

/** Cheap LLM probe with a readable error. */
export async function testLlm(
  config: LlmConfig,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await probeLlm(config, signal);
    log('info', 'test', 'LLM probe OK');
  } catch (e) {
    throw new Error(friendlyHttpError(e));
  }
}
