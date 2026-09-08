/**
 * Higher-order widgets built on top of the design-system primitives.
 * Lives separately from ui.tsx so that file stays focused on the
 * typography / card / pill vocabulary.
 *
 * Exports: Confetti, BarChart, LanguageChips, ProviderPresetCards,
 *          ConnBadge, AppBreakdown (source-app percentage bars),
 *          CopyButton (one-shot text copy).
 */
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Pressable, Text, View, type StyleProp, type ViewStyle} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, {Rect} from 'react-native-svg';
import {AppIcon} from './icons';
import {fonts, motion, radius, useTheme} from './theme';

/* ------------------------------------------------------------------ */
/* Confetti — drops from top, design-system palette only.              */
/* ------------------------------------------------------------------ */

const CONFETTI_COLORS = ['#E8552B', '#F2B705', '#1A1714', '#F4F1EA'];

export function Confetti({durationMs = 1600}: {durationMs?: number}): React.JSX.Element {
  const pieces = useMemo(
    () =>
      Array.from({length: 24}, (_, i) => ({
        x: Math.random() * 100,
        delay: i * 35,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        rotDir: (i % 2 === 0 ? 1 : -1) as 1 | -1,
      })),
    [],
  );
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '60%',
        overflow: 'hidden',
      }}>
      {pieces.map((p, i) => (
        <ConfettiPiece key={i} {...p} durationMs={durationMs} />
      ))}
    </View>
  );
}

function ConfettiPiece({
  x,
  delay,
  color,
  rotDir,
  durationMs,
}: {
  x: number;
  delay: number;
  color: string;
  rotDir: 1 | -1;
  durationMs: number;
}): React.JSX.Element {
  const y = useSharedValue(-20);
  const rot = useSharedValue(0);
  const opacity = useSharedValue(1);

  useEffect(() => {
    y.value = withDelay(
      delay,
      withTiming(420, {duration: durationMs, easing: Easing.in(Easing.cubic)}),
    );
    rot.value = withDelay(
      delay,
      withRepeat(withTiming(360 * rotDir, {duration: 1200}), -1, false),
    );
    opacity.value = withDelay(
      delay + durationMs * 0.7,
      withTiming(0, {duration: durationMs * 0.3}),
    );
  }, [delay, durationMs, opacity, rot, rotDir, y]);

  const aStyle = useAnimatedStyle(() => ({
    transform: [{translateY: y.value}, {rotate: `${rot.value}deg`}],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: `${x}%`,
          top: 0,
          width: 8,
          height: 14,
        },
        aStyle,
      ]}>
      <Svg width={8} height={14} viewBox="0 0 8 14">
        <Rect x={0} y={0} width={8} height={14} rx={2} fill={color} />
      </Svg>
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ */
/* BarChart — horizontal bar with label + percentage.                  */
/* ------------------------------------------------------------------ */

export interface BarChartItem {
  label: string;
  sublabel?: string;
  value: number;
  /** 0..1 of full bar width. */
  fraction: number;
  /** Optional override color (defaults to coral). */
  color?: string;
}

export function BarChart({items}: {items: BarChartItem[]}): React.JSX.Element {
  const max = Math.max(...items.map(i => i.value), 1);
  return (
    <View>
      {items.map((it, i) => (
        <BarChartRow
          key={it.label}
          item={it}
          max={max}
          delay={i * motion.staggerMs}
          isLast={i === items.length - 1}
        />
      ))}
      {items.length === 0 && (
        <Text
          style={{
            color: '#9A9184',
            fontFamily: fonts.mono,
            fontSize: 11,
            letterSpacing: 1.2,
            textTransform: 'uppercase',
          }}>
          No data yet
        </Text>
      )}
    </View>
  );
}

function BarChartRow({
  item,
  max: _max,
  delay,
  isLast,
}: {
  item: BarChartItem;
  max: number;
  delay: number;
  isLast: boolean;
}): React.JSX.Element {
  const t = useTheme();
  const w = useSharedValue(0);
  useEffect(() => {
    w.value = withDelay(delay, withTiming(item.fraction, {duration: 420}));
  }, [delay, item.fraction, w]);
  const fillStyle = useAnimatedStyle(() => ({flex: w.value}));
  const restStyle = useAnimatedStyle(() => ({flex: Math.max(0.001, 1 - w.value)}));
  const color = item.color ?? t.coral;
  return (
    <View
      style={{
        paddingVertical: 9,
        borderBottomWidth: isLast ? 0 : 1,
        borderColor: t.line,
      }}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 6,
        }}>
        <View style={{flex: 1}}>
          <Text
            style={{
              color: t.ink,
              fontFamily: fonts.bodySemiBold,
              fontSize: 13,
              letterSpacing: -0.1,
            }}
            numberOfLines={1}>
            {item.label}
          </Text>
          {!!item.sublabel && (
            <Text
              style={{
                color: t.inkLow,
                fontFamily: fonts.mono,
                fontSize: 9,
                letterSpacing: 1,
                textTransform: 'uppercase',
                marginTop: 2,
              }}
              numberOfLines={1}>
              {item.sublabel}
            </Text>
          )}
        </View>
        <Text
          style={{
            color: t.ink,
            fontFamily: fonts.mono,
            fontSize: 11,
            letterSpacing: 0.4,
          }}>
          {Math.round(item.fraction * 100)}%
        </Text>
      </View>
      <View
        style={{
          flexDirection: 'row',
          height: 6,
          backgroundColor: t.line,
          borderRadius: 3,
          overflow: 'hidden',
        }}>
        <Animated.View
          style={[{backgroundColor: color, borderRadius: 3}, fillStyle]}
        />
        <Animated.View style={restStyle} />
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* LanguageChips — tappable language selection.                        */
/* ------------------------------------------------------------------ */

export interface LanguageChip {
  code: string;
  label: string;
}

export const COMMON_LANGUAGES: LanguageChip[] = [
  {code: '', label: 'Auto'},
  {code: 'en', label: 'English'},
  {code: 'es', label: 'Spanish'},
  {code: 'hi', label: 'Hindi'},
  {code: 'fr', label: 'French'},
  {code: 'de', label: 'German'},
  {code: 'pt', label: 'Portuguese'},
  {code: 'zh', label: 'Chinese'},
];

export function LanguageChips({
  value,
  onChange,
}: {
  value: string;
  onChange: (code: string) => void;
}): React.JSX.Element {
  const t = useTheme();
  return (
    <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8}}>
      {COMMON_LANGUAGES.map(c => {
        const active = c.code === value;
        return (
          <Pressable
            key={c.code || 'auto'}
            accessibilityRole="button"
            accessibilityState={{selected: active}}
            onPress={() => onChange(c.code)}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: active ? t.coral : t.line,
              backgroundColor: active ? t.coral : t.surface,
            }}>
            <Text
              style={{
                color: active ? '#FFFFFF' : t.ink,
                fontFamily: fonts.bodySemiBold,
                fontSize: 12,
                letterSpacing: 0.2,
              }}>
              {c.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* ProviderPresetCards — tap a logo-like card to auto-fill the form.   */
/* ------------------------------------------------------------------ */

export interface ProviderPresetCard {
  id: string;
  label: string;
  hint: string;
  iconKey: string;
}

export function ProviderPresetCards({
  items,
  value,
  onPick,
}: {
  items: ProviderPresetCard[];
  value: string;
  onPick: (id: string) => void;
}): React.JSX.Element {
  const t = useTheme();
  return (
    <View
      style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 8}}>
      {items.map(p => {
        const active = value === p.id;
        return (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            accessibilityState={{selected: active}}
            onPress={() => onPick(p.id)}
            style={{
              flexBasis: '47%',
              flexGrow: 1,
              borderWidth: active ? 2 : 1,
              borderColor: active ? t.ink : t.line,
              borderRadius: radius.md,
              padding: 12,
              backgroundColor: active ? t.coralFaint : t.surface,
            }}>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  backgroundColor: active ? t.coral : t.surfaceMuted,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                <AppIcon
                  name={p.iconKey}
                  size={16}
                  color={active ? '#FFFFFF' : t.ink}
                />
              </View>
              <Text
                style={{
                  color: t.ink,
                  fontFamily: fonts.bodySemiBold,
                  fontSize: 13,
                  flex: 1,
                  letterSpacing: -0.1,
                }}>
                {p.label}
              </Text>
              {active && (
                <View
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 9,
                    backgroundColor: t.coral,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                  <AppIcon name="check" size={11} color="#FFFFFF" />
                </View>
              )}
            </View>
            <Text
              style={{
                color: t.inkMid,
                fontSize: 11,
                marginTop: 6,
                lineHeight: 15,
              }}>
              {p.hint}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* ConnBadge — connection status pill with 4 states.                   */
/* ------------------------------------------------------------------ */

export type ConnState = 'idle' | 'working' | 'ok' | 'error';

export function ConnBadge({
  state,
  detail,
  latencyMs,
  errorLine,
  onPress,
}: {
  state: ConnState;
  detail?: string;
  latencyMs?: number;
  errorLine?: string;
  onPress?: () => void;
}): React.JSX.Element {
  const t = useTheme();
  const color =
    state === 'ok'
      ? t.done
      : state === 'error'
        ? t.err
        : state === 'working'
          ? t.coral
          : t.inkMid;
  const label =
    state === 'idle'
      ? 'NOT TESTED'
      : state === 'working'
        ? 'TESTING…'
        : state === 'ok'
          ? `CONNECTED${latencyMs != null ? ` · ${latencyMs}ms` : ''}`
          : 'FAILED';
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (state !== 'working') {
      pulse.value = 0;
      return;
    }
    pulse.value = withRepeat(
      withTiming(1, {duration: 600, easing: Easing.inOut(Easing.quad)}),
      withTiming(0, {duration: 600, easing: Easing.inOut(Easing.quad)}),
    );
    return () => {
      pulse.value = 0;
    };
  }, [state, pulse]);
  const dotStyle = useAnimatedStyle(() => ({
    opacity: state === 'working' ? 0.4 + pulse.value * 0.6 : 1,
    transform: [{scale: state === 'working' ? 0.85 + pulse.value * 0.3 : 1}],
  }));
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: t.line,
        backgroundColor: t.surface,
        alignSelf: 'flex-start',
      }}>
      <Animated.View
        style={[
          {
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: color,
          },
          dotStyle,
        ]}
      />
      <Text
        style={{
          color: t.ink,
          fontFamily: fonts.mono,
          fontSize: 10,
          letterSpacing: 1.4,
          textTransform: 'uppercase',
        }}>
        {label}
      </Text>
      {!!detail && (
        <Text
          style={{
            color: t.inkMid,
            fontFamily: fonts.body,
            fontSize: 12,
          }}
          numberOfLines={1}>
          {detail}
        </Text>
      )}
      {state === 'error' && !!errorLine && (
        <Text
          style={{
            color: t.err,
            fontFamily: fonts.mono,
            fontSize: 11,
            maxWidth: 220,
          }}
          numberOfLines={1}>
          {errorLine}
        </Text>
      )}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* AppBreakdown — turns sourceApp strings into a BarChart.            */
/* ------------------------------------------------------------------ */

export interface AppBreakdownEntry {
  packageName: string;
  count: number;
}

const APP_LABELS: Record<string, string> = {
  'com.whatsapp': 'WhatsApp',
  'org.telegram.messenger': 'Telegram',
  'com.google.android.apps.messaging': 'Messages',
  'com.google.android.gm': 'Gmail',
  'com.google.android.googlequicksearchbox': 'Google Search',
  'com.google.android.youtube': 'YouTube',
  'com.android.chrome': 'Chrome',
  'com.instagram.android': 'Instagram',
  'com.facebook.katana': 'Facebook',
  'com.twitter.android': 'Twitter',
  'com.slack': 'Slack',
  'com.microsoft.teams': 'Teams',
  'com.discord': 'Discord',
  'com.google.android.keep': 'Google Keep',
  'com.google.android.notes': 'Notes',
  'com.samsung.android.app.notes': 'Samsung Notes',
  'com.microsoft.office.outlook': 'Outlook',
  'com.linkedin.android': 'LinkedIn',
  'com.reddit.frontpage': 'Reddit',
  'com.zhiliaoapp.musically': 'TikTok',
  'com.openai.chatgpt': 'ChatGPT',
  'com.google.android.apps.docs': 'Google Docs',
  'com.google.android.apps.sheets': 'Google Sheets',
  'com.google.android.apps.slides': 'Google Slides',
  'com.notion.android': 'Notion',
};

export function labelForPackage(packageName: string): string {
  return APP_LABELS[packageName] ?? prettyPackage(packageName);
}

function prettyPackage(p: string): string {
  const last = p.split('.').pop() ?? p;
  return last.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function AppBreakdown({
  entries,
}: {
  entries: AppBreakdownEntry[];
}): React.JSX.Element {
  const items: BarChartItem[] = useMemo(() => {
    const total = entries.reduce((s, e) => s + e.count, 0);
    return entries.slice(0, 5).map((e, i) => ({
      label: labelForPackage(e.packageName),
      sublabel: e.packageName,
      value: e.count,
      fraction: total > 0 ? e.count / total : 0,
      color:
        i === 0
          ? '#E8552B'
          : i === 1
            ? '#F27A54'
            : i === 2
              ? '#F2B705'
              : i === 3
                ? '#C99400'
                : '#5C554B',
    }));
  }, [entries]);
  if (items.every(i => i.fraction === 0)) {
    return (
      <View style={{paddingVertical: 6}}>
        <Text
          style={{
            color: '#9A9184',
            fontFamily: fonts.mono,
            fontSize: 11,
            letterSpacing: 1.2,
            textTransform: 'uppercase',
          }}>
          No dictations yet
        </Text>
        <Text
          style={{
            color: '#5C554B',
            fontFamily: fonts.body,
            fontSize: 13,
            marginTop: 4,
            lineHeight: 18,
          }}>
          Once you dictate into other apps, you'll see where you use OpenType the most.
        </Text>
      </View>
    );
  }
  return <BarChart items={items} />;
}

/* ------------------------------------------------------------------ */
/* CopyRow — used on Home + History to copy with one tap.              */
/* ------------------------------------------------------------------ */

export function CopyRow({
  text,
  hint,
  style,
}: {
  text: string;
  hint?: string;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const t = useTheme();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    [],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={hint}
      onPress={() => {
        const {Clipboard} = require('react-native');
        try {
          Clipboard.setString(text);
        } catch {
          // Best-effort.
        }
        setCopied(true);
        if (timer.current) {
          clearTimeout(timer.current);
        }
        timer.current = setTimeout(() => setCopied(false), 1400);
      }}
      style={style}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingVertical: 6,
          paddingHorizontal: 10,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: t.line,
          backgroundColor: copied ? t.coral : t.surface,
        }}>
        <AppIcon name={copied ? 'check' : 'content-copy'} size={14} color={copied ? '#fff' : t.ink} />
        <Text
          style={{
            color: copied ? '#fff' : t.ink,
            fontFamily: fonts.mono,
            fontSize: 10,
            letterSpacing: 1.4,
            textTransform: 'uppercase',
          }}>
          {copied ? 'Copied' : 'Copy'}
        </Text>
      </View>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* StatCard — analytics card with count-up number.                     */
/* ------------------------------------------------------------------ */

export function StatCard({
  label,
  value,
  unit,
  icon,
}: {
  label: string;
  value: number;
  unit?: string;
  icon?: string;
}): React.JSX.Element {
  const t = useTheme();
  const displayed = useSharedValue(0);
  useEffect(() => {
    displayed.value = withTiming(value, {duration: 600, easing: Easing.out(Easing.cubic)});
  }, [displayed, value]);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setShown(Math.round(displayed.value));
    }, 60);
    return () => clearInterval(id);
  }, [displayed, value]);
  const displayValue = formatStatValue(shown);
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: t.surface,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: t.line,
        paddingVertical: 14,
        paddingHorizontal: 12,
        minHeight: 96,
        justifyContent: 'space-between',
      }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
        <Text
          style={{
            color: t.inkLow,
            fontFamily: fonts.mono,
            fontSize: 9,
            letterSpacing: 1.2,
            textTransform: 'uppercase',
            flex: 1,
          }}
          numberOfLines={1}>
          {label}
        </Text>
        {icon && <AppIcon name={icon} size={14} color={t.inkLow} />}
      </View>
      <View style={{flexDirection: 'row', alignItems: 'baseline', gap: 3}}>
        <Text
          style={{
            fontFamily: fonts.bodyExtraBold,
            fontSize: 26,
            color: t.ink,
            letterSpacing: -0.6,
          }}>
          {displayValue}
        </Text>
        {!!unit && (
          <Text
            style={{
              fontFamily: fonts.mono,
              fontSize: 11,
              color: t.inkMid,
              letterSpacing: 0.5,
            }}>
            {unit}
          </Text>
        )}
      </View>
    </View>
  );
}

function formatStatValue(n: number): string {
  if (n >= 100000) {
    return `${(n / 1000).toFixed(0)}k`;
  }
  if (n >= 10000) {
    return `${(n / 1000).toFixed(1)}k`;
  }
  return String(n);
}