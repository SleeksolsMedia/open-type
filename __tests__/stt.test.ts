import {transcribeWithOpenAICompatible} from '../src/providers/stt';
import type {SttConfig} from '../src/types';

const base: SttConfig = {
  kind: 'openai-compatible',
  preset: 'custom',
  baseUrl: 'https://example.com/v1',
  apiKey: 'k',
  model: 'whisper-1',
  language: '',
};

test('transcribes and trims', async () => {
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({text: '  hello world  '}),
  });
  await expect(
    transcribeWithOpenAICompatible({fileUri: 'file:///a.wav', config: base}),
  ).resolves.toBe('hello world');
});

test('missing base URL throws configuration error', async () => {
  await expect(
    transcribeWithOpenAICompatible({
      fileUri: 'file:///a.wav',
      config: {...base, baseUrl: ''},
    }),
  ).rejects.toThrow(/missing/);
});

test('non-http URL is rejected', async () => {
  globalThis.fetch = jest.fn();
  await expect(
    transcribeWithOpenAICompatible({
      fileUri: 'file:///a.wav',
      config: {...base, baseUrl: 'ftp://x'},
    }),
  ).rejects.toThrow(/http/);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

test('empty transcript throws', async () => {
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({text: '   '}),
  });
  await expect(
    transcribeWithOpenAICompatible({fileUri: 'file:///a.wav', config: base}),
  ).rejects.toThrow(/empty/);
});

test('sends language and bearer key', async () => {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({text: 'hi'}),
  });
  globalThis.fetch = fetchMock;
  await transcribeWithOpenAICompatible({
    fileUri: 'file:///a.wav',
    config: {...base, language: 'hi', apiKey: 'sekret'},
  });
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect((init.headers as Record<string, string>).Authorization).toBe(
    'Bearer sekret',
  );
  // Jest runs on Node's FormData (which has .get); on-device RN uses its own.
  const nodeForm = init.body as unknown as {get: (k: string) => unknown};
  expect(nodeForm.get('language')).toBe('hi');
});
