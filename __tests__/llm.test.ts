import {enhanceTranscript, probeLlm} from '../src/providers/llm';
import {DEFAULT_SYSTEM_PROMPT, type LlmConfig} from '../src/types';

const base: LlmConfig = {
  enabled: true,
  preset: 'openai',
  baseUrl: 'https://example.com/v1',
  apiKey: 'k',
  model: 'm',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
};

test('disabled config returns input unchanged without network', async () => {
  globalThis.fetch = jest.fn();
  await expect(
    enhanceTranscript({text: ' hi ', config: {...base, enabled: false}}),
  ).resolves.toEqual({text: 'hi', usedEnhance: false});
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

test('enhance returns trimmed content', async () => {
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({choices: [{message: {content: '  Clean.  '}}]}),
  });
  await expect(enhanceTranscript({text: 'raw', config: base})).resolves.toEqual(
    {text: 'Clean.', usedEnhance: true},
  );
});

test('probe accepts OK reply', async () => {
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({choices: [{message: {content: 'OK'}}]}),
  });
  await expect(probeLlm(base)).resolves.toBeUndefined();
});

test('probe rejects surprising replies', async () => {
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({choices: [{message: {content: 'Something else'}}]}),
  });
  await expect(probeLlm(base)).rejects.toThrow(/Unexpected/);
});

test('missing model throws before network', async () => {
  globalThis.fetch = jest.fn();
  await expect(
    enhanceTranscript({text: 'x', config: {...base, model: ''}}),
  ).rejects.toThrow(/model/);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
