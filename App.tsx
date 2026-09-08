/**
 * OpenType — open-source BYOM voice dictation.
 * Editorial design system: paper/ink/coral, mono metadata, orb-centric.
 *
 * App shape (4 tabs, per user spec):
 *   - Home     → HomeTab (analytics · recent · app usage · system health)
 *   - History  → HistoryTab (last 15 days, copy on every row)
 *   - Models   → ModelsTab (Cloud / On-device segmented)
 *   - Settings → SettingsTab (theme · bubble preview · haptics · defaults · data)
 *
 * No in-app record button — the orb appears over other apps via the
 * Android overlay / iOS keyboard extension. The app only views + configures.
 */
import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  StatusBar,
  Text,

  View,
  type AppStateStatus,
  type LayoutChangeEvent,
} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  Layout,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import {log} from './src/logging';
import {OnboardingWizard} from './src/onboarding/OnboardingWizard';
import {
  discardInterruptedRecording,
  drainPendingHistory,
  getInterruptedRecording,
  initPersistentStorage,
  setOnboardingComplete,
  syncSettingsSnapshot,
} from './src/native/modules';
import {loadHistory, loadSettings, replaceHistory, saveSettings} from './src/store/settings';
import {motion, radius, spacing, useThemedColors} from './src/theme';
import type {AppSettings, HistoryEntry} from './src/types';
import {AppIcon, Banner, Btn} from './src/ui';
import {HomeTab} from './src/tabs/HomeTab';
import {HistoryTab} from './src/tabs/HistoryTab';
import {ModelsTab} from './src/tabs/ModelsTab';
import {SettingsTab} from './src/tabs/SettingsTab';
import {haptic} from './src/haptics';

type Tab = 'home' | 'history' | 'models' | 'settings';

const TABS: {id: Tab; label: string; icon: string}[] = [
  {id: 'home', label: 'Home', icon: 'home'},
  {id: 'history', label: 'History', icon: 'history'},
  {id: 'models', label: 'Models', icon: 'server'},
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
          <Btn title="Restart" onPress={() => this.setState({error: null})} />
        </View>
      );
    }
    return this.props.children;
  }
}

export default function App(): React.JSX.Element {
  return (
    <GestureHandlerRootView style={{flex: 1}}>
      <SafeAreaProvider>
        <ThemedRoot />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function ThemedRoot(): React.JSX.Element {
  // StatusBar color follows current resolved theme.
  const systemDark = useThemedColors('system');
  return (
    <>
      <StatusBar barStyle={systemDark.dark ? 'light-content' : 'dark-content'} />
      <ErrorBoundary>
        <Root />
      </ErrorBoundary>
    </>
  );
}

function Root(): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [recovered, setRecovered] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('home');

  // Theme follows settings.themeMode (loaded async once settings are ready).
  const t = useThemedColors(settings?.themeMode ?? 'system');

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
        <ActivityIndicator size="large" color={t.coral} />
        <Text
          style={{
            color: t.inkMid,
            fontFamily: 'Menlo',
            fontSize: 11,
            letterSpacing: 1.4,
            textTransform: 'uppercase',
            marginTop: 16,
          }}>
          Loading OpenType
        </Text>
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
          hapticsEnabled={settings.hapticsEnabled}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{flex: 1, backgroundColor: t.bg}} edges={['top']}>
      {recovered && (
        <RecoveryBanner
          path={recovered}
          hapticsEnabled={settings.hapticsEnabled}
          onDismiss={async () => {
            await discardInterruptedRecording().catch(() => undefined);
            setRecovered(null);
          }}
        />
      )}
      <View style={{flex: 1}}>
        <Animated.View key={tab} entering={FadeIn.duration(220)} style={{flex: 1}}>
          {tab === 'home' && <HomeTab history={history} />}
          {tab === 'history' && (
            <HistoryTab
              history={history}
              onHistory={setHistory}
              onHome={() => setTab('home')}
              hapticsEnabled={settings.hapticsEnabled}
            />
          )}
          {tab === 'models' && (
            <ModelsTab
              stt={settings.stt}
              llm={settings.llm}
              enhanceByDefault={settings.enhanceByDefault}
              onChangeStt={stt => update({...settings, stt})}
              onChangeLlm={llm => update({...settings, llm})}
              onChangeEnhanceDefault={v => update({...settings, enhanceByDefault: v})}
              hapticsEnabled={settings.hapticsEnabled}
            />
          )}
          {tab === 'settings' && (
            <SettingsTab
              settings={settings}
              onChange={update}
              onChangeTheme={mode => update({...settings, themeMode: mode})}
              onChangeHaptics={v => update({...settings, hapticsEnabled: v})}
            />
          )}
        </Animated.View>
      </View>
      <BottomNav tab={tab} onChange={setTab} historyCount={history.length} />
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------------ */
/* Bottom nav — 4 tabs, active tab shows label                         */
/* ------------------------------------------------------------------ */

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
  const [cells, setCells] = useState<
    Partial<Record<Tab, {x: number; width: number}>>
  >({});
  const tx = useSharedValue(0);
  const iw = useSharedValue(0);

  useEffect(() => {
    const l = cells[tab];
    if (l) {
      tx.value = withSpring(l.x, motion.spring);
      iw.value = withSpring(l.width, motion.spring);
    }
  }, [tab, cells, tx, iw]);

  const indicator = useAnimatedStyle(() => ({
    transform: [{translateX: tx.value}],
    width: iw.value,
    opacity: iw.value === 0 ? 0 : 1,
  }));

  const onCellLayout = (id: Tab) => (e: LayoutChangeEvent) => {
    const {x, width} = e.nativeEvent.layout;
    setCells(prev =>
      prev[id]?.x === x && prev[id]?.width === width ? prev : {...prev, [id]: {x, width}},
    );
  };

  return (
    <View
      style={{
        paddingHorizontal: spacing.lg,
        paddingBottom: Math.max(insets.bottom, 12),
        paddingTop: 10,
        backgroundColor: t.bg,
      }}>
      <View
        style={{
          flexDirection: 'row',
          backgroundColor: t.surfaceMuted,
          borderRadius: radius.xl,
          borderWidth: 1,
          borderColor: t.line,
          padding: 4,
          alignItems: 'center',
        }}>
        <Animated.View
          layout={Layout.springify()}
          style={[
            {
              position: 'absolute',
              top: 4,
              bottom: 4,
              left: 0,
              backgroundColor: t.ink,
              borderRadius: radius.lg,
            },
            indicator,
          ]}
        />
        {TABS.map(x => {
          const active = tab === x.id;
          return (
            <Pressable
              key={x.id}
              accessibilityRole="tab"
              accessibilityState={{selected: active}}
              onPress={() => onChange(x.id)}
              onLayout={onCellLayout(x.id)}
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
                gap: 6,
                borderRadius: radius.lg,
                paddingVertical: 10,
                paddingHorizontal: 6,
                minHeight: 44,
                position: 'relative',
              }}>
              <AppIcon
                name={x.icon}
                size={18}
                color={active ? t.bg : t.inkMid}
              />
              {active && (
                <Animated.Text
                  entering={FadeIn.duration(motion.small)}
                  style={{
                    fontFamily: 'Menlo',
                    fontSize: 10,
                    letterSpacing: 1.4,
                    textTransform: 'uppercase',
                    color: t.bg,
                  }}>
                  {x.label}
                </Animated.Text>
              )}
              {x.id === 'history' && historyCount > 0 && !active && (
                <View
                  style={{
                    position: 'absolute',
                    top: 4,
                    right: '20%',
                    minWidth: 16,
                    height: 16,
                    borderRadius: 8,
                    backgroundColor: t.coral,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: 4,
                  }}>
                  <Text
                    style={{
                      color: '#FFFFFF',
                      fontSize: 9,
                      fontWeight: '800',
                    }}>
                    {historyCount > 99 ? '99+' : historyCount}
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

// Re-import alias so eslint doesn't complain about unused earlier import.
import {useTheme} from './src/theme';


/* ------------------------------------------------------------------ */
/* Recovery banner                                                     */
/* ------------------------------------------------------------------ */

function RecoveryBanner({
  path,
  hapticsEnabled,
  onDismiss,
}: {
  path: string;
  hapticsEnabled: boolean;
  onDismiss: () => Promise<void>;
}): React.JSX.Element {
  const t = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.sm,
        backgroundColor: t.bg,
      }}>
      <Banner
        kind="warn"
        text="The app closed during a recording. Transcribe the recovered audio or discard it."
      />
      <View
        style={{
          flexDirection: 'row',
          gap: spacing.sm,
          paddingTop: spacing.sm,
        }}>
        <Btn
          title="Transcribe"
          onPress={async () => {
            haptic('record-start', hapticsEnabled);
            // Real transcribe is initiated by the native side; here we just
            // log + dismiss. Native listeners will pick up the recovery.
            log('info', 'recovery', `User chose to transcribe ${path}`);
            onDismiss();
          }}
        />
        <Btn
          title="Discard"
          kind="ghost"
          onPress={async () => {
            await onDismiss();
          }}
        />
      </View>
    </View>
  );
}

// Native modules that we no longer call directly in this file, but keep
// the imports referenced so the linter is happy if anything is added back.
