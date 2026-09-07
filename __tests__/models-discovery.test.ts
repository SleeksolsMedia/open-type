import {
  isModelsUnsupported,
  listModels,
  normalizeBaseUrl,
  requireBaseUrl,
} from '../src/net';

const ok = (body: unknown) =>
  ({ok: true, json: async () => body} as unknown as Response);
const fail = (status: number, body = 'err') =>
  ({
    ok: false,
    status,
    statusText: 'err',
    text: async () => body,
  } as unknown as Response);

test('normalize strips full-endpoint pastes', () => {
  expect(normalizeBaseUrl('https://api.openai.com/v1/chat/completions')).toBe(
    'https://api.openai.com/v1',
  );
  expect(
    normalizeBaseUrl('https://api.openai.com/v1/audio/transcriptions/'),
  ).toBe('https://api.openai.com/v1');
  expect(normalizeBaseUrl('https://api.openai.com/v1/')).toBe(
    'https://api.openai.com/v1',
  );
  expect(normalizeBaseUrl('  https://x.example/v1  ')).toBe(
    'https://x.example/v1',
  );
});

test('normalize adds scheme (https, http for local)', () => {
  expect(normalizeBaseUrl('api.openai.com/v1')).toBe(
    'https://api.openai.com/v1',
  );
  expect(normalizeBaseUrl('192.168.1.10:9000/v1')).toBe(
    'http://192.168.1.10:9000/v1',
  );
  expect(normalizeBaseUrl('localhost:11434/v1')).toBe(
    'http://localhost:11434/v1',
  );
  expect(normalizeBaseUrl('')).toBe('');
});

test('requireBaseUrl rejects garbage', () => {
  expect(() => requireBaseUrl('')).toThrow(/missing/);
  expect(() => requireBaseUrl('not a url')).toThrow(/Base URL/);
});

test('listModels parses, dedupes, sorts', async () => {
  globalThis.fetch = jest.fn().mockResolvedValue(
    ok({data: [{id: 'b'}, {id: 'a'}, {id: 'a'}, {id: 3}, {}]}),
  );
  await expect(listModels('https://x/v1', 'k')).resolves.toEqual(['a', 'b']);
  const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0] as [
    string,
    RequestInit,
  ];
  expect(url).toBe('https://x/v1/models');
  expect((init.headers as Record<string, string>).Authorization).toBe(
    'Bearer k',
  );
});

test('listModels maps 401 to invalid key', async () => {
  globalThis.fetch = jest.fn().mockResolvedValue(fail(401, 'bad key'));
  await expect(listModels('https://x/v1', 'k')).rejects.toThrow(
    /Invalid API key/,
  );
});

test('listModels 404 becomes fallback signal', async () => {
  globalThis.fetch = jest.fn().mockResolvedValue(fail(404));
  const err = await listModels('https://x/v1', '').catch(e => e);
  expect(isModelsUnsupported(err)).toBe(true);
});

test('listModels non-JSON becomes fallback signal', async () => {
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => {
      throw new Error('no json');
    },
  });
  const err = await listModels('https://x/v1', '').catch(e => e);
  expect(isModelsUnsupported(err)).toBe(true);
});

test('listModels missing data array becomes fallback signal', async () => {
  globalThis.fetch = jest.fn().mockResolvedValue(ok({models: []}));
  const err = await listModels('https://x/v1', '').catch(e => e);
  expect(isModelsUnsupported(err)).toBe(true);
});
