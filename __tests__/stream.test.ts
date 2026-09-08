import {b64decode, b64encode, resamplePcm16} from '../src/stream/codec';
import {
  parseDeepgramMessage,
  buildDeepgramUrl,
} from '../src/stream/drivers/deepgram';
import {parseOpenAiMessage} from '../src/stream/drivers/openaiLive';
import {
  buildWhisperLiveUrl,
  parseWhisperLiveMessage,
} from '../src/stream/drivers/whisperLive';
import {LiveSession} from '../src/stream/session';
import type {StreamDriver, StreamEvent} from '../src/stream/types';

jest.mock('../src/native/modules', () => {
  const actual = jest.requireActual('../src/native/modules');
  return {
    ...actual,
    setFrameStreaming: jest.fn().mockResolvedValue(undefined),
    onAudioFrame: jest.fn(() => () => undefined),
  };
});

// ---- codec ----

test('base64 round-trips binary audio', () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 255, 128, 64, 33, 19, 7]);
  expect(b64decode(b64encode(bytes))).toEqual(bytes);
});

test('base64 matches known vector', () => {
  expect(b64encode(new Uint8Array([72, 101, 108, 108, 111]))).toBe('SGVsbG8=');
  expect(Array.from(b64decode('SGVsbG8='))).toEqual([72, 101, 108, 108, 111]);
});

test('base64 rejects garbage', () => {
  expect(() => b64decode('!!!not-base64!!!')).toThrow(/Invalid base64/);
});

test('resample 16k→24k scales length and preserves constant signals', () => {
  const n = 3200;
  const data = new Uint8Array(n * 2);
  const view = new DataView(data.buffer);
  for (let i = 0; i < n; i++) {
    view.setInt16(i * 2, 1000, true);
  }
  const out = resamplePcm16(data, 16000, 24000);
  expect(out.length).toBe(4800 * 2);
  const oview = new DataView(out.buffer, out.byteOffset, out.byteLength);
  for (let i = 0; i < 4800; i += 977) {
    expect(oview.getInt16(i * 2, true)).toBe(1000);
  }
});

test('resample same rate copies', () => {
  const data = new Uint8Array([1, 2, 3, 4]);
  const out = resamplePcm16(data, 16000, 16000);
  expect(out).toEqual(data);
  expect(out).not.toBe(data);
});

// ---- deepgram ----

test('deepgram url carries streaming params', () => {
  const url = buildDeepgramUrl({apiKey: 'k', model: 'nova-3', language: 'en'});
  expect(url.startsWith('wss://api.deepgram.com/v1/listen?')).toBe(true);
  expect(url).toContain('encoding=linear16');
  expect(url).toContain('sample_rate=16000');
  expect(url).toContain('interim_results=false');
  expect(url).toContain('endpointing=300');
});

test('deepgram final parses, interim ignored', () => {
  const final = parseDeepgramMessage(
    JSON.stringify({
      type: 'Results',
      channel: {alternatives: [{transcript: 'hello there'}]},
      is_final: true,
      speech_final: false,
    }),
  );
  expect(final).toEqual({kind: 'final', text: 'hello there'});
  const interim = parseDeepgramMessage(
    JSON.stringify({
      type: 'Results',
      channel: {alternatives: [{transcript: 'hel'}]},
      is_final: false,
    }),
  );
  expect(interim).toEqual({kind: 'ignore'});
  expect(parseDeepgramMessage(JSON.stringify({type: 'Metadata'}))).toEqual({
    kind: 'ignore',
  });
  expect(parseDeepgramMessage('not json')).toEqual({kind: 'ignore'});
});

// ---- openai live ----

test('openai session events mark ready, deltas ignored', () => {
  expect(parseOpenAiMessage(JSON.stringify({type: 'session.created'}))).toEqual({
    kind: 'ready',
  });
  expect(
    parseOpenAiMessage(
      JSON.stringify({
        type: 'conversation.item.input_audio_transcription.delta',
        delta: 'hel',
      }),
    ),
  ).toEqual({kind: 'ignore'});
});

test('openai completed carries the final', () => {
  expect(
    parseOpenAiMessage(
      JSON.stringify({
        type: 'conversation.item.input_audio_transcription.completed',
        transcript: '  good morning  ',
      }),
    ),
  ).toEqual({kind: 'final', text: 'good morning'});
});

test('openai error surfaces', () => {
  expect(
    parseOpenAiMessage(
      JSON.stringify({type: 'error', error: {message: 'bad key'}}),
    ),
  ).toEqual({kind: 'error', message: 'OpenAI Realtime: bad key'});
});

// ---- whisper-live ----

test('whisper-live url builder', () => {
  expect(buildWhisperLiveUrl({host: '192.168.1.10'})).toBe(
    'ws://192.168.1.10:9090',
  );
  expect(buildWhisperLiveUrl({serverUrl: 'wss://voice.example.com/live'})).toBe(
    'wss://voice.example.com/live',
  );
  expect(buildWhisperLiveUrl({serverUrl: 'voice.example.com:19090/stt'})).toBe(
    'ws://voice.example.com:19090/stt',
  );
  expect(
    buildWhisperLiveUrl({serverUrl: '', host: '10.0.0.5', port: 9191}),
  ).toBe('ws://10.0.0.5:9191');
  expect(() => buildWhisperLiveUrl({host: ''})).toThrow(
    /server address is missing/,
  );
});

test('whisper-live ready/segments/error parse', () => {
  expect(
    parseWhisperLiveMessage(JSON.stringify({message: 'SERVER_READY', backend: 'x'})),
  ).toEqual({kind: 'ready'});
  const segs = parseWhisperLiveMessage(
    JSON.stringify({
      segments: [
        {text: 'hello', start: '0.0', end: '1.0', completed: true},
        {text: 'world', start: '1.0', end: '2.0', completed: false},
        {text: '  ', start: '2.0', end: '3.0', completed: true},
      ],
    }),
  );
  expect(segs).toEqual({
    kind: 'finals',
    finals: [{text: 'hello', key: '0.0|1.0|hello'}],
  });
  expect(
    parseWhisperLiveMessage(JSON.stringify({status: 'ERROR', message: 'full'})),
  ).toEqual({kind: 'error', message: 'WhisperLive: full'});
  expect(
    parseWhisperLiveMessage(JSON.stringify({message: 'DISCONNECT'})),
  ).toEqual({kind: 'server-closed'});
});

// ---- session assembly ----

class FakeDriver implements StreamDriver {
  readonly name = 'fake';
  cb: ((e: StreamEvent) => void) | null = null;
  sent: Uint8Array[] = [];
  async connect(): Promise<void> {}
  sendAudio(pcm16: Uint8Array): void {
    this.sent.push(pcm16);
  }
  async finalize(): Promise<void> {}
  close(): void {}
  onEvent(cb: (e: StreamEvent) => void): void {
    this.cb = cb;
  }
  async test(): Promise<void> {}
  final(text: string, key: string): void {
    this.cb?.({type: 'final', text, key});
  }
}

test('session assembles finals, dedupes repeats', async () => {
  const driver = new FakeDriver();
  const stages: string[] = [];
  const session = new LiveSession(driver, s => stages.push(s));
  await session.start();
  driver.final('hello', 'a');
  driver.final('hello', 'a'); // repeat from server
  driver.final('world', 'b');
  driver.final('  ', 'c'); // blank ignored
  const {transcript, error} = await session.stop();
  expect(transcript).toBe('hello world');
  expect(error).toBeNull();
  expect(stages).toEqual(['connecting', 'streaming', 'finalizing']);
});

test('session surfaces driver errors', async () => {
  const driver = new FakeDriver();
  const session = new LiveSession(driver);
  await session.start();
  driver.cb?.({type: 'error', message: 'boom'});
  const {transcript, error} = await session.stop();
  expect(transcript).toBe('');
  expect(error).toBe('boom');
});
