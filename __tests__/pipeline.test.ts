import {
  DictationBusyError,
  runDictation,
} from '../src/services/pipeline';
import {DEFAULT_SETTINGS} from '../src/types';

const args = () => ({
  audioFileUri: 'file:///a.wav',
  stt: {...DEFAULT_SETTINGS.stt},
  llm: {...DEFAULT_SETTINGS.llm, enabled: false},
  enhance: false,
});

test('raw path skips LLM', async () => {
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({text: 'hello'}),
  });
  const out = await runDictation(args());
  expect(out).toEqual({rawText: 'hello', finalText: 'hello', usedEnhance: false});
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
});

test('enhance path calls STT then LLM', async () => {
  globalThis.fetch = jest
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({text: 'raw words'}),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({choices: [{message: {content: 'Polished.'}}]}),
    });
  const out = await runDictation({
    ...args(),
    enhance: true,
    llm: {...DEFAULT_SETTINGS.llm, enabled: true, model: 'test-model'},
  });
  expect(out).toEqual({
    rawText: 'raw words',
    finalText: 'Polished.',
    usedEnhance: true,
  });
  expect(globalThis.fetch).toHaveBeenCalledTimes(2);
});

test('enhance network failure degrades to raw + skipped', async () => {
  globalThis.fetch = jest
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({text: 'raw words'}),
    })
    .mockRejectedValueOnce(new TypeError('Network request failed'));
  const out = await runDictation({
    ...args(),
    enhance: true,
    llm: {...DEFAULT_SETTINGS.llm, enabled: true, model: 'test-model'},
  });
  expect(out).toEqual({
    rawText: 'raw words',
    finalText: 'raw words',
    usedEnhance: false,
    enhanceSkipped: true,
  });
});

test('enhance 401 still surfaces (bad key must not hide)', async () => {
  globalThis.fetch = jest
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({text: 'raw words'}),
    })
    .mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'unauthorized',
      text: async () => 'bad key',
    });
  await expect(
    runDictation({
      ...args(),
      enhance: true,
      llm: {...DEFAULT_SETTINGS.llm, enabled: true, model: 'test-model'},
    }),
  ).rejects.toThrow(/401/);
});
test('concurrent runs are rejected', async () => {
  let release!: (v: Response) => void;
  globalThis.fetch = jest.fn().mockReturnValue(
    new Promise<Response>(resolve => {
      release = resolve;
    }),
  );
  const first = runDictation(args());
  await expect(runDictation(args())).rejects.toBeInstanceOf(
    DictationBusyError,
  );
  release({ok: true, json: async () => ({text: 'done'})} as Response);
  await expect(first).resolves.toMatchObject({finalText: 'done'});
});
