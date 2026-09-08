/**
 * HomeTab — top-level card stack on the Home tab.
 *
 * Layout (from user spec):
 *   1. Analytics card (4 stats: dictations, words, wpm, insert %)
 *   2. Recent dictations (3 latest, with copy buttons)
 *   3. App usage — horizontal bar chart of top 5 source apps
 *   4. System health — Mic / Overlay / Auto-paste / Battery
 *
 * No record button in-app: dictation happens via the floating orb
 * (bubble / keyboard extension). The Home tab is purely informational
 * + the 4 stat cards.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {RefreshControl, ScrollView, Text, View, type AppStateStatus} from 'react-native';
import {AppState} from 'react-native';
import Animated, {FadeInUp} from 'react-native-reanimated';
import {
  AppIcon,
  Card,
  PageHeader,
  Pill,
  Stagger,
} from '../ui';
import {
  AppBreakdown,
  CopyRow,
  StatCard,
  type AppBreakdownEntry,
} from '../widgets';
import {
  fonts,
  motion,
  spacing,
  useTheme,
} from '../theme';
import type {HistoryEntry} from '../types';

import {
  isAccessibilityEnabled,
  isBatteryExempt,
  isMicrophoneGranted,
  isNativeAvailable,
  isOverlayPermissionGranted,
  openAccessibilitySettings,
  requestBatteryExemption,
  requestMicrophonePermission,
  requestOverlayPermission,
} from '../native/modules';

interface Props {
  history: HistoryEntry[];
}

const SYSTEM_PERMS: Array<{
  id: 'mic' | 'overlay' | 'a11y' | 'battery';
  label: string;
  icon: string;
  check: () => Promise<boolean>;
  onPress: () => Promise<void>;
}> = [
  {
    id: 'mic',
    label: 'Microphone',
    icon: 'microphone',
    check: async () =>
      isNativeAvailable()
        ? isMicrophoneGranted().catch(() => false)
        : true,
    onPress: async () => {
      await requestMicrophonePermission();
    },
  },
  {
    id: 'overlay',
    label: 'Bubble overlay',
    icon: 'circle-double',
    check: async () =>
      isNativeAvailable()
        ? isOverlayPermissionGranted().catch(() => false)
        : true,
    onPress: async () => {
      await requestOverlayPermission();
    },
  },
  {
    id: 'a11y',
    label: 'Auto-paste',
    icon: 'clipboard-check',
    check: async () =>
      isNativeAvailable()
        ? isAccessibilityEnabled().catch(() => false)
        : true,
    onPress: async () => {
      await openAccessibilitySettings();
    },
  },
  {
    id: 'battery',
    label: 'Battery exemption',
    icon: 'battery-check',
    check: async () =>
      isNativeAvailable() ? isBatteryExempt().catch(() => false) : true,
    onPress: async () => {
      try {
        await requestBatteryExemption();
      } catch {
        // Some ROMs lack the intent.
      }
    },
  },
];

export function HomeTab({history}: Props): React.JSX.Element {
  const t = useTheme();
  const [perms, setPerms] = useState<
    Record<'mic' | 'overlay' | 'a11y' | 'battery', boolean | null>
  >({mic: null, overlay: null, a11y: null, battery: null});
  const [refreshing, setRefreshing] = useState(false);

  const refreshPerms = useCallback(async () => {
    const next: typeof perms = {mic: null, overlay: null, a11y: null, battery: null};
    await Promise.all(
      SYSTEM_PERMS.map(async p => {
        try {
          next[p.id] = await p.check();
        } catch {
          next[p.id] = false;
        }
      }),
    );
    setPerms(next);
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

  // Aggregate stats.
  const totalWords = useMemo(
    () => history.reduce((n, h) => n + h.finalText.split(/\s+/).filter(Boolean).length, 0),
    [history],
  );
  const totalSec = useMemo(
    () => history.reduce((n, h) => n + (h.durationSec ?? 0), 0),
    [history],
  );
  const wpm = totalSec > 0 ? Math.round((totalWords / totalSec) * 60) : 0;
  const insertedRate = useMemo(() => {
    if (history.length === 0) {
      return 0;
    }
    const ins = history.filter(h => h.inserted).length;
    return Math.round((ins / history.length) * 100);
  }, [history]);
  const recent = useMemo(() => history.slice(0, 3), [history]);
  const appBreakdown: AppBreakdownEntry[] = useMemo(() => {
    const map = new Map<string, number>();
    for (const h of history) {
      const k = h.sourceApp;
      if (!k) {
        continue;
      }
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([packageName, count]) => ({packageName, count}))
      .sort((a, b) => b.count - a.count);
  }, [history]);

  const permState = useMemo(() => {
    const known = (Object.values(perms) as Array<boolean | null>).filter(
      v => v != null,
    ) as boolean[];
    if (known.length === 0) {
      return 'checking' as const;
    }
    if (known.every(v => v)) {
      return 'all-on' as const;
    }
    const off = known.filter(v => !v).length;
    return off === 1 ? ('one-off' as const) : ('many-off' as const);
  }, [perms]);

  const headerEmoji =
    permState === 'all-on'
      ? 'All systems on'
      : permState === 'one-off'
        ? '1 permission off'
        : permState === 'many-off'
          ? `${Object.values(perms).filter(v => v === false).length} permissions off`
          : 'Checking…';

  return (
    <ScrollView
      contentContainerStyle={{paddingBottom: 40}}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await refreshPerms();
            setRefreshing(false);
          }}
          tintColor={t.coral}
        />
      }>
      <PageHeader eyebrow="Home" title="Your dictation" />

      <View style={{paddingHorizontal: spacing.lg}}>
        {/* 1. Analytics */}
        <Stagger index={0}>
          <Section title="Analytics" />
          <Card framed>
            <View style={{flexDirection: 'row', gap: spacing.sm}}>
              <StatCard label="Dictations" value={history.length} icon="microphone" />
              <StatCard label="Words" value={totalWords} icon="text" />
            </View>
            <View style={{height: spacing.sm}} />
            <View style={{flexDirection: 'row', gap: spacing.sm}}>
              <StatCard
                label="Words / min"
                value={wpm}
                unit="wpm"
                icon="wave"
              />
              <StatCard
                label="Inserted"
                value={insertedRate}
                unit="%"
                icon="check-circle"
              />
            </View>
          </Card>
        </Stagger>

        {/* 2. Recent dictations */}
        <Stagger index={1}>
          <View style={{marginTop: spacing.lg}}>
            <Section title="Recent" trailing={recent.length > 0 ? `${recent.length} / ${history.length}` : undefined} />
            {recent.length === 0 ? (
              <Card>
                <View style={{alignItems: 'center', paddingVertical: spacing.lg}}>
                  <View
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: 32,
                      backgroundColor: t.surfaceMuted,
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: spacing.md,
                    }}>
                    <AppIcon name="microphone" size={28} color={t.coral} />
                  </View>
                  <Text
                    style={{
                      fontFamily: fonts.bodySemiBold,
                      fontSize: 15,
                      color: t.ink,
                      textAlign: 'center',
                    }}>
                    Your first dictation
                  </Text>
                  <Text
                    style={{
                      color: t.inkMid,
                      fontFamily: fonts.body,
                      fontSize: 13,
                      textAlign: 'center',
                      marginTop: 6,
                      lineHeight: 19,
                      maxWidth: 260,
                    }}>
                    Tap any text field in any app — the orb appears. Hold to speak,
                    release to insert.
                  </Text>
                </View>
              </Card>
            ) : (
              <Card style={{padding: 0, overflow: 'hidden'}}>
                {recent.map((h, i) => (
                  <RecentRow
                    key={h.id}
                    entry={h}
                    isLast={i === recent.length - 1}
                  />
                ))}
              </Card>
            )}
          </View>
        </Stagger>

        {/* 3. App usage */}
        <Stagger index={2}>
          <View style={{marginTop: spacing.lg}}>
            <Section title="App usage" trailing={appBreakdown.length > 0 ? `${appBreakdown.length} apps` : undefined} />
            <Card>
              <AppBreakdown entries={appBreakdown} />
            </Card>
          </View>
        </Stagger>

        {/* 4. System health */}
        <Stagger index={3}>
          <View style={{marginTop: spacing.lg}}>
            <Section title="System health" />
            <Card>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingBottom: spacing.md,
                  marginBottom: spacing.sm,
                  borderBottomWidth: 1,
                  borderColor: t.line,
                }}>
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    backgroundColor:
                      permState === 'all-on'
                        ? t.okBg
                        : permState === 'one-off'
                          ? t.amberFaint
                          : permState === 'many-off'
                            ? t.errFaint
                            : t.surfaceMuted,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                  <AppIcon
                    name={
                      permState === 'all-on'
                        ? 'check-circle'
                        : permState === 'checking'
                          ? 'loading'
                          : 'alert'
                    }
                    size={20}
                    color={
                      permState === 'all-on'
                        ? t.done
                        : permState === 'one-off'
                          ? t.amberDark
                          : permState === 'many-off'
                            ? t.err
                            : t.inkMid
                    }
                  />
                </View>
                <Text
                  style={{
                    fontFamily: fonts.bodySemiBold,
                    fontSize: 14,
                    color: t.ink,
                    flex: 1,
                  }}>
                  {headerEmoji}
                </Text>
              </View>
              {SYSTEM_PERMS.map((p, i) => (
                <PermRow
                  key={p.id}
                  icon={p.icon}
                  label={p.label}
                  ok={perms[p.id]}
                  onPress={p.onPress}
                  isLast={i === SYSTEM_PERMS.length - 1}
                />
              ))}
            </Card>
          </View>
        </Stagger>
      </View>
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ */
/* Small presentational helpers used only on Home.                     */
/* ------------------------------------------------------------------ */

function Section({
  title,
  trailing,
}: {
  title: string;
  trailing?: string;
}): React.JSX.Element {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        marginBottom: spacing.sm,
      }}>
      <Text
        style={{
          fontFamily: fonts.mono,
          fontSize: 10,
          color: t.inkLow,
          letterSpacing: 1.4,
          textTransform: 'uppercase',
        }}>
        {title}
      </Text>
      {trailing && (
        <Text
          style={{
            fontFamily: fonts.mono,
            fontSize: 10,
            color: t.inkLow,
            letterSpacing: 1,
          }}>
          {trailing}
        </Text>
      )}
    </View>
  );
}

function RecentRow({
  entry,
  isLast,
}: {
  entry: HistoryEntry;
  isLast: boolean;
}): React.JSX.Element {
  const t = useTheme();
  return (
    <Animated.View entering={FadeInUp.duration(motion.small)}>
      <View
        style={{
          paddingVertical: 13,
          paddingHorizontal: spacing.lg,
          borderBottomWidth: isLast ? 0 : 1,
          borderColor: t.line,
        }}>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 6,
          }}>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
            <Text
              style={{
                fontFamily: fonts.mono,
                fontSize: 9,
                color: t.inkLow,
                letterSpacing: 1,
                textTransform: 'uppercase',
              }}>
              {formatStamp(entry.createdAt)}
            </Text>
            <Pill
              tone={entry.usedEnhance ? 'amber' : 'neutral'}
              text={entry.usedEnhance ? 'Polished' : 'Raw'}
            />
          </View>
          <CopyRow text={entry.finalText} />
        </View>
        <Text
          style={{
            fontFamily: fonts.body,
            fontSize: 14,
            color: t.inkSoft,
            lineHeight: 20,
          }}
          numberOfLines={3}>
          {entry.finalText}
        </Text>
      </View>
    </Animated.View>
  );
}

function PermRow({
  icon,
  label,
  ok,
  onPress,
  isLast,
}: {
  icon: string;
  label: string;
  ok: boolean | null;
  onPress: () => void;
  isLast: boolean;
}): React.JSX.Element {
  const t = useTheme();
  const dot = ok == null ? t.inkLow : ok ? t.done : t.err;
  const word = ok == null ? 'CHECKING' : ok ? 'ON' : 'OFF · TAP TO FIX';
  return (
    <Animated.View entering={FadeInUp.duration(motion.small)}>
      <View
        onTouchEnd={onPress}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingVertical: 12,
          borderBottomWidth: isLast ? 0 : 1,
          borderColor: t.line,
        }}>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 12}}>
          <AppIcon name={icon} size={18} color={t.ink} />
          <Text
            style={{
              color: t.ink,
              fontFamily: fonts.bodySemiBold,
              fontSize: 14,
            }}>
            {label}
          </Text>
        </View>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
          <View
            style={{width: 8, height: 8, borderRadius: 4, backgroundColor: dot}}
          />
          <Text
            style={{
              color: dot,
              fontFamily: fonts.mono,
              fontSize: 10,
              letterSpacing: 1.2,
              textTransform: 'uppercase',
            }}>
            {word}
          </Text>
        </View>
      </View>
    </Animated.View>
  );
}

function formatStamp(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = ((h + 11) % 12) + 1;
  const time = `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
  if (sameDay) {
    return time;
  }
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) {
    return `Yesterday ${time}`;
  }
  return d.toLocaleDateString();
}