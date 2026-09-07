/**
 * OpenType — open-source BYOM voice dictation.
 * Android-first: floating bubble + Accessibility auto-paste + clipboard fallback.
 * Calm Flow UI: warm paper, ink borders, lavender CTA, lively motion.
 */

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Pressable,
  ScrollView,
  StatusBar,
  Switch,
  Text,
  Vibration,
  View,
  type AppStateStatus,
} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import Animated, {FadeIn} from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ReactNativeBlobUtil from 'react-native-blob-util';
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import {LlmEditor} from './src/LlmEditor';
import {SttEditor} from './src/SttEditor';
import {formatLogs, getLogs, log} from './src/logging';
import {friendlyHttpError} from './src/net';
import {OnboardingWizard} from './src/onboarding/OnboardingWizard';
import {runDictation, type PipelineStage} from './src/services/pipeline';
import {
  appendHistory,
  clearHistory,
  deleteHistoryEntry,
  loadHistory,
  loadSettings,
  newId,
  replaceHistory,
  saveSettings,
} from './src/store/settings';
import {
  cancelRecording,
  discardInterruptedRecording,
  drainPendingHistory,
  getInterruptedRecording,
  getRecorderState,
  initPersistentStorage,
  insertOrCopy,
  isAccessibilityEnabled,
  isBatteryExempt,
  isBubbleEnabled,
  isMicrophoneGranted,
  isNativeAvailable,
  isOverlayPermissionGranted,
  onRecordingAutoStopped,
  openAccessibilitySettings,
  requestBatteryExemption,
  requestMicrophonePermission,
  requestOverlayPermission,
  setBubbleAppearance,
  setBubbleEnabled,
  setOnboardingComplete,
  startRecording,
  stopRecording,
  syncSettingsSnapshot,
} from './src/native/modules';
import {fonts, radius, spacing, useTheme} from './src/theme';
import type {AppSettings, HistoryEntry} from './src/types';
import {
  Banner,
  Btn,
  Card,
  CardTitle,
  EmptyState,
  Hero,
  LiveWaveform,
  Pill,
  RecordButton,
  Row,
  SegmentedControl,
  Stagger,
  formatMB,
  formatTime,
} from './src/ui';

type Tab = 'home' | 'providers' | 'history' | 'settings';

const TABS: {id: Tab; label: string; icon: string}[] = [
  {id: 'home', label: 'Home', icon: 'home'},
  {id: 'providers', label: 'Models', icon: 'server'},
  {id: 'history', label: 'History', icon: 'history'},
  {id: 'settings', label: 'Settings', icon: 'cog'},
];

class ErrorBoundary extends React.Component<
  {children: React.ReactNode},
  {error: string | null}
> {
  state = {error: null as string | null};

  static getDerivedStateFromError(e: unknown): {error: string} {
    return {error: e instanceof Error ? e.message : String(e)};
  }

  componentDidCatch(e: unknown): void {
    log('error', 'ui', e instanceof Error ? e.stack ?? e.message : String(e));
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <View style={{flex: 1, padding: 24, justifyContent: 'center'}}>
          <Banner kind="err" text={`Something broke: ${this.state.error}`} />
          <Btn
            title="Restart screen"
            onPress={() => this.setState({error: null})}
          />
        </View>
      );
    }
    return this.props.children;
  }
}

export default function App(): React.JSX.Element {
  const t = useTheme();
  return (
    <GestureHandlerRootView style={{flex: 1}}>
      <SafeAreaProvider>
        <StatusBar barStyle={t.dark ? 'light-content' : 'dark-content'} />
        <ErrorBoundary>
          <Root />
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Root(): React.JSX.Element {
  const t = useTheme();
  const [tab, setTab] = useState<Tab>('home');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [recovered, setRecovered] = useState<string | null>(null);

  const update = useCallback(async (next: AppSettings) => {
    setSettings(next);
    try {
      await saveSettings(next);
      await syncSettingsSnapshot(JSON.stringify(next));
    } catch (e) {
      log('error', 'settings', e instanceof Error ? e.message : String(e));
    }
  }, []);

  const drainPending = useCallback(async () => {
    try {
      const raws = await drainPendingHistory();
      if (raws.length === 0) {
        return;
      }
      let current = await loadHistory();
      for (const raw of raws) {
        try {
          const parsed = JSON.parse(raw) as Partial<HistoryEntry>;
          if (typeof parsed.id === 'string' && typeof parsed.finalText === 'string') {
            current = [parsed as HistoryEntry, ...current].slice(0, 100);
          }
        } catch {
          // Skip malformed entries.
        }
      }
      await replaceHistory(current);
      setHistory(current);
    } catch (e) {
      log('error', 'history', e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await initPersistentStorage();
      const loaded = await loadSettings();
      setSettings(loaded);
      setHistory(await loadHistory());
      if (loaded.onboarding.completed) {
        await setOnboardingComplete();
      }
      await syncSettingsSnapshot(JSON.stringify(loaded));
      await drainPending();
      const interrupted = await getInterruptedRecording().catch(() => null);
      if (interrupted) {
        log('warn', 'recovery', `Found interrupted recording: ${interrupted}`);
        setRecovered(interrupted);
      }
    })();
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') {
        drainPending();
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!settings) {
    return (
      <View style={{flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: t.bg}}>
        <ActivityIndicator size="large" color={t.forest} />
        <Text style={{color: t.subtext, marginTop: 12}}>Loading OpenType…</Text>
      </View>
    );
  }

  if (!settings.onboarding.completed) {
    return (
      <SafeAreaView style={{flex: 1, backgroundColor: t.bg}} edges={['top', 'bottom']}>
        <OnboardingWizard
          settings={settings}
          onChange={update}
          onComplete={() => setTab('home')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{flex: 1, backgroundColor: t.bg}} edges={['top']}>
      {recovered && (
        <View style={{paddingHorizontal: spacing.lg, paddingTop: spacing.sm}}>
          <Banner
            kind="warn"
            text="The app closed during a recording. Transcribe the recovered audio or discard it."
          />
          <Row>
            <Btn
              title="Transcribe recovered"
              onPress={async () => {
                const path = recovered;
                setRecovered(null);
                setTab('home');
                await transcribeRecoveredRef.current?.(path);
              }}
            />
            <Btn
              title="Discard"
              kind="ghost"
              onPress={async () => {
                await discardInterruptedRecording();
                setRecovered(null);
              }}
            />
          </Row>
        </View>
      )}
      <View style={{flex: 1}}>
        <Animated.View key={tab} entering={FadeIn.duration(220)} style={{flex: 1}}>
          {tab === 'home' && (
            <HomeTab settings={settings} history={history} onHistory={setHistory} />
          )}
          {tab === 'providers' && (
            <ProvidersTab settings={settings} onChange={update} />
          )}
          {tab === 'history' && (
            <HistoryTab history={history} onHistory={setHistory} />
          )}
          {tab === 'settings' && (
            <SettingsTab settings={settings} onChange={update} />
          )}
        </Animated.View>
      </View>
      <BottomNav tab={tab} onChange={setTab} historyCount={history.length} />
    </SafeAreaView>
  );
}

function BottomNav({
  tab,
  onChange,
  historyCount,
}: {
  tab: Tab;
  onChange: (t: Tab) => void;
  historyCount: number;
}): React.JSX.Element {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        paddingHorizontal: spacing.lg,
        paddingBottom: Math.max(insets.bottom, 12),
        paddingTop: 4,
        backgroundColor: t.bg,
      }}>
      <View
        style={{
          flexDirection: 'row',
          backgroundColor: t.dark ? t.card : '#FFFFFF',
          borderRadius: radius.pill,
          borderWidth: 2,
          borderColor: t.dark ? t.border : t.ink,
          padding: 6,
        }}>
        {TABS.map(x => {
          const active = tab === x.id;
          return (
            <Pressable
              key={x.id}
              accessibilityRole="tab"
              onPress={() => onChange(x.id)}
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                borderRadius: radius.pill,
                paddingVertical: 11,
                backgroundColor: active ? t.lavender : 'transparent',
                borderWidth: active ? 1.5 : 0,
                borderColor: t.dark ? t.cream : t.ink,
              }}>
              <Icon
                name={x.icon}
                size={19}
                color={active ? t.lavenderInk : t.subtext}
              />
              <Text
                style={{
                  fontWeight: active ? '800' : '600',
                  fontSize: 13,
                  color: active ? t.lavenderInk : t.subtext,
                }}>
                {x.label}
              </Text>
              {x.id === 'history' && historyCount > 0 && (
                <View
                  style={{
                    backgroundColor: active ? t.lavenderInk : t.forest,
                    borderRadius: 10,
                    minWidth: 20,
                    height: 20,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: 5,
                  }}>
                  <Text
                    style={{
                      color: active ? t.lavender : t.forestInk,
                      fontSize: 11,
                      fontWeight: '800',
                    }}>
                    {historyCount > 99 ? '99' : historyCount}
                  </Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// Module-level ref so the recovery banner can trigger transcription.
const transcribeRecoveredRef: {
  current: ((fileUri: string) => Promise<void>) | null;
} = {current: null};

function HomeTab({
  settings,
  history,
  onHistory,
}: {
  settings: AppSettings;
  history: HistoryEntry[];
  onHistory: (h: HistoryEntry[]) => void;
}): React.JSX.Element {
  const t = useTheme();
  const [perms, setPerms] = useState({
    mic: null as boolean | null,
    overlay: null as boolean | null,
    a11y: null as boolean | null,
    battery: null as boolean | null,
  });
  const [recording, setRecording] = useState(false);
  const [levels, setLevels] = useState<number[]>(new Array(28).fill(0));
  const [elapsedMs, setElapsedMs] = useState(0);
  const [sizeBytes, setSizeBytes] = useState(0);
  const [stage, setStage] = useState<PipelineStage | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Idle — tap the mic and speak.');
  const [result, setResult] = useState<{raw: string; final: string} | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [enhance, setEnhance] = useState(settings.enhanceByDefault);
  const abort = useRef<AbortController | null>(null);
  const live = useRef({settings, enhance});
  live.current = {settings, enhance};

  const stats = useMemo(() => {
    const words = history.reduce(
      (n, h) => n + h.finalText.split(/\s+/).filter(Boolean).length,
      0,
    );
    const inserted = history.filter(h => h.inserted).length;
    return {
      count: history.length,
      words,
      rate: history.length ? Math.round((inserted / history.length) * 100) : 0,
    };
  }, [history]);

  const statusPill = recording
    ? {tone: 'live' as const, text: 'Recording'}
    : stage
      ? {tone: 'lavender' as const, text: 'Working'}
      : {tone: 'ok' as const, text: 'Ready'};

  const refreshPerms = useCallback(async () => {
    if (!isNativeAvailable()) {
      setPerms({mic: true, overlay: true, a11y: true, battery: true});
      return;
    }
    const [mic, overlay, a11y, battery] = await Promise.all([
      isMicrophoneGranted().catch(() => false),
      isOverlayPermissionGranted().catch(() => false),
      isAccessibilityEnabled().catch(() => false),
      isBatteryExempt().catch(() => false),
    ]);
    setPerms({mic, overlay, a11y, battery});
  }, []);

  useEffect(() => {
    refreshPerms();
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') {
        refreshPerms();
      }
    });
    return () => sub.remove();
  }, [refreshPerms]);

  const processFile = useCallback(
    async (fileUri: string, durationSec?: number) => {
      const {settings: s, enhance: e} = live.current;
      const ctrl = new AbortController();
      abort.current = ctrl;
      setStage('transcribing');
      setProgress(0);
      setStatus('Transcribing…');
      try {
        const out = await runDictation({
          audioFileUri: fileUri,
          audioMimeType: 'audio/wav',
          stt: s.stt,
          llm: s.llm,
          enhance: e && s.llm.enabled,
          signal: ctrl.signal,
          onStage: st => {
            setStage(st);
            setStatus(
              st === 'transcribing'
                ? 'Transcribing…'
                : st === 'enhancing'
                  ? 'Polishing with LLM…'
                  : 'Done.',
            );
          },
          onTranscribeProgress: setProgress,
        });
        setResult({raw: out.rawText, final: out.finalText});
        const {inserted} = await insertOrCopy(out.finalText);
        onHistory(
          await appendHistory({
            id: newId(),
            createdAt: Date.now(),
            rawText: out.rawText,
            finalText: out.finalText,
            usedEnhance: out.usedEnhance,
            inserted,
            durationSec,
            enhanceSkipped: out.enhanceSkipped,
          }),
        );
        const skippedNote = out.enhanceSkipped
          ? ' (LLM polish skipped — no connection)'
          : '';
        setStatus(
          inserted
            ? `Inserted into the focused field.${skippedNote}`
            : `No text field in focus — copied to clipboard.${skippedNote}`,
        );
        Vibration.vibrate(30);
      } catch (err) {
        const msg = err instanceof Error ? err.message : friendlyHttpError(err);
        setStatus(msg === 'Cancelled.' ? 'Cancelled.' : `Failed: ${msg}`);
        log('error', 'dictate', msg);
      } finally {
        abort.current = null;
        setStage(null);
      }
    },
    [onHistory],
  );

  useEffect(() => {
    transcribeRecoveredRef.current = processFile;
    return () => {
      transcribeRecoveredRef.current = null;
    };
  }, [processFile]);

  // 10-minute native auto-stop lands here.
  useEffect(() => {
    const off = onRecordingAutoStopped(path => {
      setRecording(false);
      setStatus('Hit the 10-minute cap — transcribing what was captured…');
      processFile(path, 600);
    });
    return off;
  }, [processFile]);

  // Waveform + timer polling — only while recording.
  useEffect(() => {
    if (!recording) {
      return;
    }
    const id = setInterval(async () => {
      const st = await getRecorderState().catch(() => null);
      if (!st) {
        return;
      }
      setElapsedMs(st.durationMs);
      setSizeBytes(st.sizeBytes);
      setLevels(prev => [...prev.slice(1), st.amplitude]);
    }, 200);
    return () => clearInterval(id);
  }, [recording]);

  const onRecord = useCallback(async () => {
    setResult(null);
    setShowRaw(false);
    try {
      if (!(await requestMicrophonePermission())) {
        setStatus('Microphone permission denied — grant it to dictate.');
        return;
      }
      await startRecording();
      setRecording(true);
      setLevels(new Array(28).fill(0));
      setElapsedMs(0);
      setSizeBytes(0);
      setStatus('Recording… tap stop when done.');
      Vibration.vibrate(20);
    } catch (e) {
      setStatus(`Could not start: ${errMsg(e)}`);
    }
  }, []);

  const onStop = useCallback(async () => {
    try {
      const raw = await stopRecording();
      setRecording(false);
      const uri = raw.startsWith('file://') ? raw : `file://${raw}`;
      const secs = Math.max(1, Math.round(elapsedMs / 1000));
      await processFile(uri, secs);
    } catch (e) {
      setRecording(false);
      setStatus(`Stop failed: ${errMsg(e)}`);
    }
  }, [elapsedMs, processFile]);

  const onCancelRecord = useCallback(async () => {
    await cancelRecording().catch(() => undefined);
    setRecording(false);
    setStatus('Recording discarded.');
  }, []);

  const onCancelPipeline = useCallback(() => {
    abort.current?.abort();
  }, []);

  return (
    <ScrollView contentContainerStyle={{padding: spacing.lg, paddingBottom: 24}}>
      <Stagger index={0}>
        <View style={{marginBottom: spacing.md}}>
          <Hero
            title="Don't type, just speak."
            subtitle="Tap the mic, talk naturally, and your words land where the cursor is."
          />
        </View>
      </Stagger>

      <Stagger index={1}>
        <View style={{marginBottom: spacing.md}}>
          <Pill tone={statusPill.tone} text={statusPill.text} dot />
        </View>
      </Stagger>

      <Stagger index={2}>
        <Card framed>
          <View style={{alignItems: 'center', paddingVertical: spacing.sm}}>
            <RecordButton
              recording={recording}
              working={!!stage}
              onPress={recording ? onStop : stage ? onCancelPipeline : onRecord}
            />
            <Text
              style={{
                fontFamily: fonts.display,
                fontSize: 30,
                color: t.text,
                marginTop: spacing.md,
              }}>
              {recording
                ? `${formatTime(elapsedMs)} · ${formatMB(sizeBytes)}`
                : stage
                  ? status
                  : 'Ready to flow'}
            </Text>
            {(recording || !!stage) && (
              <View style={{width: '100%', marginTop: spacing.sm}}>
                <LiveWaveform levels={levels} framed />
              </View>
            )}
            <Text
              style={{
                color: t.subtext,
                fontSize: 13,
                marginTop: spacing.sm,
                textAlign: 'center',
              }}>
              {!recording && !stage
                ? status
                : recording
                  ? progress > 0
                    ? `On-device: ${Math.round(progress * 100)}%`
                    : 'Listening… speak naturally.'
                  : status}
            </Text>
            {recording && (
              <Row>
                <Btn title="Stop" icon="stop" onPress={onStop} />
                <Btn title="Discard" icon="delete" kind="danger" onPress={onCancelRecord} />
              </Row>
            )}
            {!!stage && (
              <Row>
                <Btn title="Cancel" kind="ghost" onPress={onCancelPipeline} />
              </Row>
            )}
            {!recording && !stage && (
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: spacing.sm,
                  width: '100%',
                }}>
                <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
                  <Icon name="sparkles" size={18} color={t.forest} />
                  <Text style={{color: t.text, fontWeight: '600'}}>Enhance with LLM</Text>
                </View>
                <Switch
                  value={enhance}
                  onValueChange={setEnhance}
                  disabled={!settings.llm.enabled}
                  trackColor={{false: t.stone, true: t.lavender}}
                  thumbColor={t.dark ? t.cream : t.ink}
                />
              </View>
            )}
          </View>
        </Card>
      </Stagger>

      <Stagger index={3}>
        <View style={{flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md}}>
          {[
            {label: 'Dictations', value: String(stats.count), icon: 'microphone'},
            {label: 'Words', value: stats.words > 999 ? `${(stats.words / 1000).toFixed(1)}k` : String(stats.words), icon: 'text'},
            {label: 'Inserted', value: `${stats.rate}%`, icon: 'check-circle'},
          ].map(s => (
            <View
              key={s.label}
              style={{
                flex: 1,
                backgroundColor: t.card,
                borderRadius: radius.md,
                borderWidth: 1.5,
                borderColor: t.dark ? t.border : t.stone,
                padding: spacing.md,
                alignItems: 'center',
              }}>
              <Icon name={s.icon} size={20} color={t.forest} />
              <Text style={{fontFamily: fonts.display, fontSize: 24, color: t.text, marginTop: 4}}>
                {s.value}
              </Text>
              <Text style={{color: t.subtext, fontSize: 12, fontWeight: '600'}}>{s.label}</Text>
            </View>
          ))}
        </View>
      </Stagger>

      {result && (
        <Stagger index={4}>
          <Card framed>
            <CardTitle serif>Result</CardTitle>
            <Text style={{color: t.text, fontSize: 16, lineHeight: 24}} selectable>
              {showRaw ? result.raw : result.final}
            </Text>
            {result.raw !== result.final && (
              <Row>
                <Btn
                  title={showRaw ? 'Show polished' : 'Show raw'}
                  kind="ghost"
                  onPress={() => setShowRaw(v => !v)}
                />
              </Row>
            )}
            <Row>
              <Btn
                title="Insert / Copy"
                icon="content-copy"
                onPress={async () => {
                  const {inserted} = await insertOrCopy(result.final);
                  setStatus(
                    inserted ? 'Inserted.' : 'Copied to clipboard.',
                  );
                }}
              />
            </Row>
          </Card>
        </Stagger>
      )}

      <Stagger index={5}>
        <Card>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.sm}}>
            <Icon name="circle-double" size={20} color={t.forest} />
            <CardTitle>Bubble status</CardTitle>
          </View>
          <PermRow
            icon="microphone"
            label="Microphone"
            ok={perms.mic}
            onPress={async () => {
              await requestMicrophonePermission();
              refreshPerms();
            }}
          />
          <PermRow
            icon="circle-double"
            label="Bubble overlay"
            ok={perms.overlay}
            onPress={async () => {
              await requestOverlayPermission();
              refreshPerms();
            }}
          />
          <PermRow
            icon="clipboard-check"
            label="Auto-paste"
            ok={perms.a11y}
            onPress={async () => {
              await openAccessibilitySettings();
              refreshPerms();
            }}
          />
          <PermRow
            icon="battery-check"
            label="Battery exemption"
            ok={perms.battery}
            onPress={async () => {
              try {
                await requestBatteryExemption();
              } catch {
                // Some ROMs lack the intent.
              }
              refreshPerms();
            }}
          />
          <Text style={{color: t.subtext, fontSize: 13, marginTop: 4, lineHeight: 19}}>
            The bubble appears automatically whenever you focus a text field in
            any app — tap it to dictate without opening OpenType.
          </Text>
          <Row>
            <Btn title="Refresh status" icon="refresh" kind="ghost" onPress={refreshPerms} />
          </Row>
        </Card>
      </Stagger>

      {history.length > 0 && (
        <Stagger index={6}>
          <Card>
            <CardTitle serif>Recent dictations</CardTitle>
            {history.slice(0, 3).map(h => (
              <View
                key={h.id}
                style={{
                  paddingVertical: spacing.sm,
                  borderTopWidth: 1,
                  borderColor: t.dark ? t.border : t.stone,
                }}>
                <Text style={{color: t.subtext, fontSize: 12, marginBottom: 2}}>
                  {new Date(h.createdAt).toLocaleString()}
                  {h.durationSec ? ` · ${h.durationSec}s` : ''} ·{' '}
                  {h.usedEnhance ? 'polished' : 'raw'}
                </Text>
                <Text style={{color: t.text, fontSize: 15}} numberOfLines={2}>
                  {h.finalText}
                </Text>
              </View>
            ))}
          </Card>
        </Stagger>
      )}
    </ScrollView>
  );
}

function PermRow({
  icon,
  label,
  ok,
  onPress,
}: {
  icon: string;
  label: string;
  ok: boolean | null;
  onPress: () => void;
}): React.JSX.Element {
  const t = useTheme();
  const dot = ok == null ? t.subtext : ok ? t.forest : t.danger;
  const word = ok == null ? '…' : ok ? 'on' : 'off — tap to fix';
  return (
    <Pressable onPress={onPress}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingVertical: 10,
        }}>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 10}}>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: t.dark ? t.cardElevated : '#F2F2DF',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <Icon name={icon} size={18} color={t.text} />
          </View>
          <Text style={{color: t.text, fontWeight: '600'}}>{label}</Text>
        </View>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 6}}>
          <View style={{width: 8, height: 8, borderRadius: 4, backgroundColor: dot}} />
          <Text style={{color: dot, fontWeight: '700', fontSize: 13}}>{word}</Text>
        </View>
      </View>
    </Pressable>
  );
}

function ProvidersTab({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (s: AppSettings) => void;
}): React.JSX.Element {
  const t = useTheme();
  return (
    <ScrollView contentContainerStyle={{padding: spacing.lg, paddingBottom: 24}}>
      <Stagger index={0}>
        <View style={{marginBottom: spacing.md}}>
          <Hero
            title="Your models."
            subtitle="Bring any OpenAI-compatible transcription server, plus optional LLM polish."
          />
        </View>
      </Stagger>
      <Stagger index={1}>
        <Card framed>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
            <Icon name="microphone" size={20} color={t.forest} />
            <CardTitle>Speech-to-text</CardTitle>
          </View>
          <SttEditor
            stt={settings.stt}
            onChange={stt => onChange({...settings, stt})}
          />
        </Card>
      </Stagger>
      <Stagger index={2}>
        <Card>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
            <Icon name="sparkles" size={20} color={t.forest} />
            <CardTitle>LLM enhance</CardTitle>
          </View>
          <LlmEditor
            llm={settings.llm}
            onChange={llm => onChange({...settings, llm})}
          />
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: 8,
            }}>
            <Text style={{color: t.text, fontWeight: '600'}}>Enhance by default</Text>
            <Switch
              value={settings.enhanceByDefault}
              onValueChange={v => onChange({...settings, enhanceByDefault: v})}
              trackColor={{false: t.stone, true: t.lavender}}
              thumbColor={t.dark ? t.cream : t.ink}
            />
          </View>
        </Card>
      </Stagger>
    </ScrollView>
  );
}

function HistoryTab({
  history,
  onHistory,
}: {
  history: HistoryEntry[];
  onHistory: (h: HistoryEntry[]) => void;
}): React.JSX.Element {
  const t = useTheme();
  const [note, setNote] = useState('');

  if (history.length === 0) {
    return (
      <ScrollView contentContainerStyle={{padding: spacing.lg}}>
        <Hero
          title="History."
          subtitle="Every transcript lands here — on this phone only."
        />
        <EmptyState
          title="No dictations yet"
          body="Tap the mic on Home and speak. Your words will appear here."
          icon="history"
        />
      </ScrollView>
    );
  }

  return (
    <View style={{flex: 1, padding: spacing.lg}}>
      <Hero title="History." subtitle={`${history.length} dictation${history.length === 1 ? '' : 's'} on this device.`} />
      {!!note && <Banner kind="info" text={note} />}
      <Row>
        <Btn
          title="Clear all"
          icon="delete"
          kind="danger"
          onPress={() =>
            Alert.alert('Clear history?', 'This cannot be undone.', [
              {text: 'Cancel', style: 'cancel'},
              {
                text: 'Clear',
                style: 'destructive',
                onPress: async () => {
                  await clearHistory();
                  onHistory([]);
                },
              },
            ])
          }
        />
      </Row>
      <FlatList
        data={history}
        keyExtractor={h => h.id}
        contentContainerStyle={{paddingBottom: 12}}
        renderItem={({item, index}) => (
          <Stagger index={Math.min(index, 5)}>
            <View
              style={{
                backgroundColor: t.card,
                borderColor: t.dark ? t.border : t.stone,
                borderWidth: 1.5,
                borderRadius: radius.md,
                padding: 16,
                marginBottom: 10,
              }}>
              <View style={{flexDirection: 'row', gap: 6, marginBottom: 6, flexWrap: 'wrap'}}>
                <Pill
                  tone="neutral"
                  text={`${new Date(item.createdAt).toLocaleString()}${item.durationSec ? ` · ${item.durationSec}s` : ''}`}
                />
                <Pill
                  tone={item.usedEnhance ? 'ok' : 'neutral'}
                  text={item.usedEnhance ? 'polished' : item.enhanceSkipped ? 'raw · LLM skipped' : 'raw'}
                />
                <Pill tone="neutral" text={item.inserted ? 'inserted' : 'clipboard'} />
              </View>
              <Text style={{color: t.text, fontSize: 15, lineHeight: 22}} numberOfLines={4}>
                {item.finalText}
              </Text>
              <Row>
                <Btn
                  title="Copy"
                  icon="content-copy"
                  kind="ghost"
                  onPress={async () => {
                    await insertOrCopy(item.finalText);
                    setNote('Copied.');
                  }}
                />
                <Btn
                  title="Delete"
                  icon="delete"
                  kind="ghost"
                  onPress={async () => {
                    onHistory(await deleteHistoryEntry(item.id));
                  }}
                />
              </Row>
            </View>
          </Stagger>
        )}
      />
    </View>
  );
}

function SettingsTab({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (s: AppSettings) => void;
}): React.JSX.Element {
  const t = useTheme();
  const [logPath, setLogPath] = useState('');
  const [bubbleOn, setBubbleOn] = useState<boolean | null>(null);

  useEffect(() => {
    isBubbleEnabled().then(setBubbleOn).catch(() => setBubbleOn(true));
  }, []);

  const setAppearance = (size: number, opacity: number) => {
    onChange({...settings, bubbleSize: size, bubbleOpacity: opacity});
    setBubbleAppearance(size, opacity);
  };

  const exportLogs = async () => {
    try {
      const path = `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/opentype-logs.txt`;
      await ReactNativeBlobUtil.fs.writeFile(
        path,
        formatLogs(getLogs()),
        'utf8',
      );
      setLogPath(path);
      log('info', 'settings', `Logs exported to ${path}`);
    } catch (e) {
      setLogPath(`Export failed: ${errMsg(e)}`);
    }
  };

  return (
    <ScrollView contentContainerStyle={{padding: spacing.lg, paddingBottom: 24}}>
      <Stagger index={0}>
        <View style={{marginBottom: spacing.md}}>
          <Hero title="Settings." subtitle="Tune the bubble and your data." />
        </View>
      </Stagger>
      <Stagger index={1}>
        <Card framed>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
            <Icon name="circle-double" size={20} color={t.forest} />
            <CardTitle>Bubble</CardTitle>
          </View>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: spacing.md,
            }}>
            <Text style={{color: t.text, fontWeight: '600', flex: 1, paddingRight: 12}}>
              Show automatically in text fields
            </Text>
            <Switch
              value={bubbleOn ?? true}
              onValueChange={async v => {
                setBubbleOn(v);
                await setBubbleEnabled(v);
              }}
              trackColor={{false: t.stone, true: t.lavender}}
              thumbColor={t.dark ? t.cream : t.ink}
            />
          </View>
          <Text style={{color: t.text, fontWeight: '600', marginBottom: 8}}>
            Size · {settings.bubbleSize}%
          </Text>
          <SegmentedControl
            options={[70, 85, 100, 115] as const}
            value={settings.bubbleSize as 70 | 85 | 100 | 115}
            onChange={v => setAppearance(v, settings.bubbleOpacity)}
            renderLabel={v => `${v}`}
          />
          <Text style={{color: t.text, fontWeight: '600', marginBottom: 8, marginTop: spacing.md}}>
            Opacity · {settings.bubbleOpacity}%
          </Text>
          <SegmentedControl
            options={[40, 60, 80, 100] as const}
            value={settings.bubbleOpacity as 40 | 60 | 80 | 100}
            onChange={v => setAppearance(settings.bubbleSize, v)}
            renderLabel={v => `${v}`}
          />
        </Card>
      </Stagger>
      <Stagger index={2}>
        <Card>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
            <Icon name="cog" size={20} color={t.forest} />
            <CardTitle>Setup & data</CardTitle>
          </View>
          <Row>
            <Btn
              title="Redo setup wizard"
              icon="refresh"
              onPress={() =>
                onChange({
                  ...settings,
                  onboarding: {completed: false, step: 0},
                })
              }
            />
          </Row>
          <Row>
            <Btn title="Export debug logs" icon="file-export" kind="ghost" onPress={exportLogs} />
          </Row>
          {!!logPath && <Banner kind="info" text={logPath} />}
        </Card>
      </Stagger>
      <Stagger index={3}>
        <Card>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
            <Icon name="information" size={20} color={t.forest} />
            <CardTitle>About</CardTitle>
          </View>
          <Text style={{color: t.subtext, fontSize: 13, lineHeight: 20}}>
            OpenType · open-source BYOM dictation{'\n'}Transcription:{' '}
            {settings.stt.kind === 'on-device'
              ? `on-device (${settings.stt.onDeviceModelId})`
              : `${settings.stt.baseUrl}`}
            {'\n'}LLM: {settings.llm.enabled ? 'enabled' : 'off'}
          </Text>
        </Card>
      </Stagger>
    </ScrollView>
  );
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
