import {b64decode} from './codec';
import {onAudioFrame, setFrameStreaming} from '../native/modules';
import type {StreamDriver} from './types';

export type LiveStage = 'connecting' | 'streaming' | 'finalizing';

/**
 * Owns one live transcription: frames flow recorder → driver, finals
 * assemble here. The WAV file is written in parallel by the recorder for
 * HTTP fallback — this class never touches it.
 */
export class LiveSession {
  private finals: string[] = [];
  private seen = new Set<string>();
  private frameOff: (() => void) | null = null;
  private lastError: string | null = null;
  private closedEarly = false;

  constructor(
    private driver: StreamDriver,
    private onStage?: (s: LiveStage) => void,
  ) {}

  get finalCount(): number {
    return this.finals.length;
  }

  get error(): string | null {
    return this.lastError;
  }

  /**
   * @param streamFrames when false, skips frame-event wiring: the caller
   * feeds audio itself (headless bubble flow drains the native frame queue).
   */
  async start(signal?: AbortSignal, streamFrames = true): Promise<void> {
    this.onStage?.('connecting');
    this.driver.onEvent(e => {
      if (e.type === 'final') {
        if (!this.seen.has(e.key) && e.text.trim() !== '') {
          this.seen.add(e.key);
          this.finals.push(e.text.trim());
        }
      } else if (e.type === 'error') {
        if (!this.lastError) {
          this.lastError = e.message;
        }
      } else if (e.type === 'closed') {
        this.closedEarly = true;
      }
    });
    await this.driver.connect(signal);
    if (!streamFrames) {
      this.onStage?.('streaming');
      return;
    }
    await setFrameStreaming(true);
    this.frameOff = onAudioFrame(base64 => {
      try {
        this.driver.sendAudio(b64decode(base64));
      } catch {
        // A bad frame must never kill the session.
      }
    });
    this.onStage?.('streaming');
  }

  /** Stop frames, flush finals, close. Never throws. */
  async stop(): Promise<{transcript: string; error: string | null}> {
    this.onStage?.('finalizing');
    try {
      this.frameOff?.();
    } catch {
      // Ignore.
    }
    this.frameOff = null;
    try {
      await setFrameStreaming(false);
    } catch {
      // Ignore.
    }
    try {
      await this.driver.finalize();
    } catch (e) {
      if (!this.lastError) {
        this.lastError = e instanceof Error ? e.message : String(e);
      }
    }
    this.driver.close();
    return {transcript: this.assembled(), error: this.lastError};
  }

  async abort(): Promise<void> {
    try {
      this.frameOff?.();
    } catch {
      // Ignore.
    }
    this.frameOff = null;
    try {
      await setFrameStreaming(false);
    } catch {
      // Ignore.
    }
    this.driver.close();
  }

  private assembled(): string {
    return this.finals
      .map(t => t.trim())
      .filter(t => t !== '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
