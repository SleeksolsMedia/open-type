import {
  appendHistory,
  clearHistory,
  deleteHistoryEntry,
  loadHistory,
  loadSettings,
  saveSettings,
} from '../src/store/settings';
import {DEFAULT_SETTINGS, type HistoryEntry} from '../src/types';

const entry = (id: string): HistoryEntry => ({
  id,
  createdAt: 1,
  rawText: 'r',
  finalText: 'f',
  usedEnhance: false,
  inserted: false,
});

beforeEach(async () => {
  await clearHistory();
});

test('defaults load when storage is empty', async () => {
  // Memory storage starts empty in a fresh module registry per test file.
  const s = await loadSettings();
  expect(s.stt.model).toBe(DEFAULT_SETTINGS.stt.model);
  expect(s.onboarding.completed).toBe(false);
});

test('partial saved settings merge over defaults', async () => {
  await saveSettings({
    ...DEFAULT_SETTINGS,
    stt: {...DEFAULT_SETTINGS.stt, model: 'whisper-large-v3-turbo'},
    onboarding: {completed: true, step: 7},
  });
  const s = await loadSettings();
  expect(s.stt.model).toBe('whisper-large-v3-turbo');
  expect(s.onboarding.completed).toBe(true);
  expect(s.llm.model).toBe(DEFAULT_SETTINGS.llm.model);
});

test('history caps at 100, newest first', async () => {
  for (let i = 0; i < 105; i++) {
    await appendHistory(entry(`id-${i}`));
  }
  const h = await loadHistory();
  expect(h).toHaveLength(100);
  expect(h[0].id).toBe('id-104');
});

test('deleteHistoryEntry removes one row', async () => {
  await appendHistory(entry('a'));
  await appendHistory(entry('b'));
  const next = await deleteHistoryEntry('a');
  expect(next.map(e => e.id)).toEqual(['b']);
});
