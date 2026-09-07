/**
 * Shared domain types for OpenType dictation.
 */

export type SttProviderKind = 'openai-compatible' | 'on-device';

/** One-tap server presets. 'custom' = user-typed URL. */
export type SttPresetId = 'openai' | 'groq' | 'selfhost' | 'custom';

export interface SttPreset {
  id: SttPresetId;
  label: string;
  hint: string;
  baseUrl: string;
  model: string;
  needsKey: boolean;
}

export const STT_PRESETS: SttPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    hint: 'api.openai.com · needs API key',
    baseUrl: 'https://api.openai.com/v1',
    model: 'whisper-1',
    needsKey: true,
  },
  {
    id: 'groq',
    label: 'Groq',
    hint: 'Fast whisper-large-v3-turbo · needs API key',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'whisper-large-v3-turbo',
    needsKey: true,
  },
  {
    id: 'selfhost',
    label: 'Self-hosted',
    hint: 'Your faster-whisper server · usually no key',
    baseUrl: 'http://192.168.1.10:9000/v1',
    model: 'whisper-1',
    needsKey: false,
  },
  {
    id: 'custom',
    label: 'Custom URL',
    hint: 'Any OpenAI-compatible endpoint',
    baseUrl: '',
    model: 'whisper-1',
    needsKey: true,
  },
];

export interface SttConfig {
  kind: SttProviderKind;
  preset: SttPresetId;
  /** e.g. https://api.openai.com/v1 or http://<host>:9000/v1 for self-hosted faster-whisper */
  baseUrl?: string;
  apiKey?: string;
  /** e.g. whisper-1, whisper-large-v3-turbo. Sent as `model` for OpenAI-compatible servers. */
  model?: string;
  /** BCP-47 code (en, hi, es...). Empty = auto-detect. */
  language?: string;
  /** Downloaded on-device model id (whisper.cpp ggml file). */
  onDeviceModelId?: string;
}

export interface LlmConfig {
  enabled: boolean;
  preset: LlmPresetId;
  /** e.g. https://api.openai.com/v1 or http://<host>:4000/v1 for LiteLLM/Ollama gateways */
  baseUrl?: string;
  apiKey?: string;
  /** Chosen from the provider's live model list. Empty until Test connection. */
  model?: string;
  systemPrompt: string;
}

/** One-tap LLM providers. 'custom' = user-typed URL. */
export type LlmPresetId = 'openai' | 'groq' | 'custom';

export interface LlmPreset {
  id: LlmPresetId;
  label: string;
  hint: string;
  baseUrl: string;
  needsKey: boolean;
}

export const LLM_PRESETS: LlmPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    hint: 'api.openai.com · needs API key',
    baseUrl: 'https://api.openai.com/v1',
    needsKey: true,
  },
  {
    id: 'groq',
    label: 'Groq',
    hint: 'Fast Llama models · needs API key',
    baseUrl: 'https://api.groq.com/openai/v1',
    needsKey: true,
  },
  {
    id: 'custom',
    label: 'Custom URL',
    hint: 'Any OpenAI-compatible endpoint',
    baseUrl: '',
    needsKey: true,
  },
];

export interface OnboardingState {
  completed: boolean;
  /** Last reached step index (for resume after process death). */
  step: number;
}

export interface AppSettings {
  stt: SttConfig;
  llm: LlmConfig;
  onboarding: OnboardingState;
  /** Default per-dictation enhance toggle. */
  enhanceByDefault: boolean;
  bubbleSize: number;
  bubbleOpacity: number;
}

export interface DictationResult {
  rawText: string;
  finalText: string;
  usedEnhance: boolean;
  /** True when enhance was requested but skipped (offline / server down). */
  enhanceSkipped?: boolean;
}

export interface HistoryEntry {
  id: string;
  createdAt: number;
  rawText: string;
  finalText: string;
  usedEnhance: boolean;
  inserted: boolean;
  /** Seconds of audio, for display. */
  durationSec?: number;
  enhanceSkipped?: boolean;
}

/** Downloadable whisper.cpp model. */
export interface OnDeviceModel {
  id: string;
  label: string;
  detail: string;
  sizeMB: number;
  fileName: string;
  url: string;
}

export const DEFAULT_SYSTEM_PROMPT =
  'You clean up voice dictation transcripts. Fix punctuation, capitalization, and obvious ' +
  'misheard words using context. Remove filler words (um, uh, like) and false starts. ' +
  'Apply self-corrections ("5pm... actually 6pm" becomes "6pm"). ' +
  'Preserve the original language and meaning. Never add new facts or commentary. ' +
  'Reply with ONLY the cleaned text, no quotes or explanations.';

export const DEFAULT_SETTINGS: AppSettings = {
  stt: {
    kind: 'openai-compatible',
    preset: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'whisper-1',
    language: '',
    onDeviceModelId: 'tiny.en',
  },
  llm: {
    enabled: false,
    preset: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: '',
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
  },
  onboarding: {completed: false, step: 0},
  enhanceByDefault: false,
  bubbleSize: 100,
  bubbleOpacity: 80,
};
