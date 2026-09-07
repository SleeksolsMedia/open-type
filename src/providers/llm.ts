import {
  chatCompletionsUrl,
  fetchWithRetry,
  requireBaseUrl,
} from '../net';
import type {LlmConfig} from '../types';

export interface EnhanceArgs {
  text: string;
  config: LlmConfig;
  signal?: AbortSignal;
}

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

async function chatCompletion(
  config: LlmConfig,
  messages: ChatMessage[],
  maxTokens: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  const base = requireBaseUrl(config.baseUrl);
  const model = (config.model ?? '').trim();
  if (!model) {
    throw new Error('Pick a model first (Test connection to list them).');
  }
  const headers: Record<string, string> = {'Content-Type': 'application/json'};
  const apiKey = (config.apiKey ?? '').trim();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  const res = await fetchWithRetry(
    chatCompletionsUrl(base),
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: maxTokens,
        messages,
      }),
    },
    {timeoutMs, retries: 1, signal, tag: 'llm'},
  );
  const json = (await res.json()) as {
    choices?: Array<{message?: {content?: unknown}}>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('LLM returned an empty result.');
  }
  return content.trim();
}

/**
 * Optional LLM cleanup pass over a raw transcript via an OpenAI-compatible
 * `POST {baseUrl}/chat/completions` endpoint (OpenAI, OpenRouter,
 * self-hosted LiteLLM/Ollama gateways, ...).
 * Returns the input unchanged when disabled.
 */
export async function enhanceTranscript({
  text,
  config,
  signal,
}: EnhanceArgs): Promise<{text: string; usedEnhance: boolean}> {
  const input = text.trim();
  if (!config.enabled || !input) {
    return {text: input, usedEnhance: false};
  }
  const out = await chatCompletion(
    config,
    [
      {role: 'system', content: config.systemPrompt},
      {role: 'user', content: input},
    ],
    2000,
    90000,
    signal,
  );
  return {text: out, usedEnhance: true};
}

/** Cheap connectivity probe used by onboarding + provider Test buttons. */
export async function probeLlm(
  config: LlmConfig,
  signal?: AbortSignal,
): Promise<void> {
  const out = await chatCompletion(
    {...config, enabled: true},
    [{role: 'user', content: 'Reply with exactly: OK'}],
    8,
    30000,
    signal,
  );
  if (!/ok/i.test(out)) {
    throw new Error(`Unexpected probe reply: ${out.slice(0, 80)}`);
  }
}
