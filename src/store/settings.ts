import { DEFAULT_SETTINGS, type AppSettings, type HistoryEntry, type SttConfig } from '../types';

const SETTINGS_KEY = 'opentype.settings.v1';
const HISTORY_KEY = 'opentype.history.v1';
const MAX_HISTORY = 100;

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** Falls back to memory when no persistent storage is injected (tests, early boot). */
class MemoryStorage implements KeyValueStorage {
  private map = new Map<string, string>();
  async getItem(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }
  async setItem(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
}

let storage: KeyValueStorage = new MemoryStorage();

export function injectStorage(s: KeyValueStorage): void {
  storage = s;
}

function mergeSettings(raw: unknown): AppSettings {
  if (typeof raw !== 'object' || raw === null) {
    return DEFAULT_SETTINGS;
  }
  const parsed = raw as Partial<AppSettings>;
  const parsedStt = (parsed.stt ?? {}) as Partial<SttConfig>;
  return {
    ...DEFAULT_SETTINGS,
    ...parsed,
    stt: {
      ...DEFAULT_SETTINGS.stt,
      ...parsedStt,
      live: {...DEFAULT_SETTINGS.stt.live, ...(parsedStt.live ?? {})},
    },
    llm: { ...DEFAULT_SETTINGS.llm, ...(parsed.llm ?? {}) },
    onboarding: { ...DEFAULT_SETTINGS.onboarding, ...(parsed.onboarding ?? {}) },
  };
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await storage.getItem(SETTINGS_KEY);
    if (!raw) {
      return DEFAULT_SETTINGS;
    }
    return mergeSettings(JSON.parse(raw) as unknown);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export async function loadHistory(): Promise<HistoryEntry[]> {
  try {
    const raw = await storage.getItem(HISTORY_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export async function appendHistory(entry: HistoryEntry): Promise<HistoryEntry[]> {
  const current = await loadHistory();
  const next = [entry, ...current].slice(0, MAX_HISTORY);
  await storage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

export async function clearHistory(): Promise<void> {
  await storage.setItem(HISTORY_KEY, JSON.stringify([]));
}

/** Overwrite history (used when merging headless-task entries). */
export async function replaceHistory(list: HistoryEntry[]): Promise<void> {
  await storage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, MAX_HISTORY)));
}

export async function deleteHistoryEntry(id: string): Promise<HistoryEntry[]> {
  const current = await loadHistory();
  const next = current.filter(h => h.id !== id);
  await storage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}
