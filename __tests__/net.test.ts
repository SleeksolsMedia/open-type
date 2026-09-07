import {HttpError, fetchWithRetry, friendlyHttpError} from '../src/net';

const ok = (body: unknown) =>
  ({ok: true, json: async () => body} as unknown as Response);
const fail = (status: number, body = 'err') =>
  ({
    ok: false,
    status,
    statusText: 'err',
    text: async () => body,
  } as unknown as Response);

beforeEach(() => {
  jest.useRealTimers();
});

test('returns response on success', async () => {
  globalThis.fetch = jest.fn().mockResolvedValue(ok({}));
  const res = await fetchWithRetry('http://x', {}, {retries: 0});
  expect(res.ok).toBe(true);
});

test('retries 500 then succeeds', async () => {
  globalThis.fetch = jest
    .fn()
    .mockResolvedValueOnce(fail(500))
    .mockResolvedValueOnce(ok({}));
  const res = await fetchWithRetry(
    'http://x',
    {},
    {retries: 2, baseBackoffMs: 10},
  );
  expect(res.ok).toBe(true);
  expect(globalThis.fetch).toHaveBeenCalledTimes(2);
});

test('does not retry 400', async () => {
  globalThis.fetch = jest.fn().mockResolvedValue(fail(400, 'bad'));
  await expect(
    fetchWithRetry('http://x', {}, {retries: 3, baseBackoffMs: 10}),
  ).rejects.toBeInstanceOf(HttpError);
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
});

test('times out with a readable message', async () => {
  globalThis.fetch = jest.fn().mockReturnValue(new Promise(() => {}));
  await expect(
    fetchWithRetry('http://x', {}, {timeoutMs: 50, retries: 0}),
  ).rejects.toThrow(/Timed out/);
});

test('aborted signal rejects as Cancelled', async () => {
  globalThis.fetch = jest.fn().mockReturnValue(new Promise(() => {}));
  const ctrl = new AbortController();
  ctrl.abort();
  await expect(
    fetchWithRetry('http://x', {}, {timeoutMs: 5000, signal: ctrl.signal}),
  ).rejects.toThrow('Cancelled.');
});

test('friendlyHttpError maps auth failures', () => {
  expect(friendlyHttpError(new HttpError(401, ''))).toMatch(/API key/);
  expect(friendlyHttpError(new HttpError(404, ''))).toMatch(/Base URL/);
  expect(friendlyHttpError(new HttpError(500, ''))).toMatch(/Server error/);
});
