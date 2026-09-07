import React, {useEffect} from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeInUp,
  Layout,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {
  fonts,
  fontSize,
  motion,
  radius,
  spacing,
  useTheme,
  type ThemeColors,
} from './theme';

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

export function Screen({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const t = useTheme();
  return (
    <View style={[{flex: 1, backgroundColor: t.bg}, style]}>{children}</View>
  );
}

export function Hero({
  title,
  subtitle,
  align = 'left',
}: {
  title: string;
  subtitle?: string;
  align?: 'left' | 'center';
}): React.JSX.Element {
  const t = useTheme();
  return (
    <Animated.View
      entering={FadeInUp.duration(motion.fadeMs).springify()}
      style={{alignItems: align === 'center' ? 'center' : 'flex-start'}}>
      <Text
        style={{
          fontFamily: fonts.display,
          fontSize: fontSize.display,
          lineHeight: fontSize.display * 1.02,
          letterSpacing: -0.5,
          color: t.text,
          textAlign: align,
        }}>
        {title}
      </Text>
      {!!subtitle && (
        <Text
          style={{
            color: t.subtext,
            fontSize: fontSize.md,
            lineHeight: 24,
            marginTop: spacing.sm,
            textAlign: align,
          }}>
          {subtitle}
        </Text>
      )}
    </Animated.View>
  );
}

/** Staggered reveal wrapper — index drives the delay. */
export function Stagger({
  index = 0,
  children,
  style,
}: {
  index?: number;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  return (
    <Animated.View
      entering={FadeInUp.delay(index * motion.staggerMs)
        .duration(motion.fadeMs)
        .springify()}
      style={style}>
      {children}
    </Animated.View>
  );
}

export function Row({children}: {children: React.ReactNode}): React.JSX.Element {
  return <View style={styles.row}>{children}</View>;
}

/* ------------------------------------------------------------------ */
/* Cards                                                               */
/* ------------------------------------------------------------------ */

export function Card({
  children,
  framed,
  style,
}: {
  children: React.ReactNode;
  framed?: boolean;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const t = useTheme();
  return (
    <Animated.View
      entering={FadeInUp.duration(motion.fadeMs).springify()}
      style={[
        styles.card,
        {
          backgroundColor: t.card,
          borderColor: framed ? t.ink : t.dark ? t.border : t.stone,
          borderWidth: framed ? 2 : 1.5,
        },
        style,
      ]}>
      {children}
    </Animated.View>
  );
}

/** Back-compat alias with the Calm Flow card. */
export const FlowCard = Card;

export function CardTitle({
  children,
  serif,
  style,
}: {
  children: React.ReactNode;
  serif?: boolean;
  style?: StyleProp<TextStyle>;
}): React.JSX.Element {
  const t = useTheme();
  return (
    <Text
      style={[
        styles.cardTitle,
        serif && {fontFamily: fonts.display, fontWeight: '400'},
        {color: t.text},
        style,
      ]}>
      {children}
    </Text>
  );
}

/* ------------------------------------------------------------------ */
/* Buttons — lavender CTA + ink ring, springy press                     */
/* ------------------------------------------------------------------ */

function usePressScale(disabled?: boolean) {
  const s = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({transform: [{scale: s.value}]}));
  return {
    anim,
    onIn: () => {
      if (!disabled) {
        s.value = withSpring(0.96, motion.spring);
      }
    },
    onOut: () => {
      if (!disabled) {
        s.value = withSpring(1, motion.spring);
      }
    },
  };
}

export function Btn({
  title,
  onPress,
  kind = 'primary',
  disabled,
  loading,
  icon,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  icon?: string;
}): React.JSX.Element {
  const t = useTheme();
  const press = usePressScale(disabled || loading);
  const bg =
    kind === 'primary'
      ? t.lavender
      : kind === 'danger'
        ? t.danger
        : 'transparent';
  const fg =
    kind === 'primary'
      ? t.lavenderInk
      : kind === 'danger'
        ? '#FFFFFF'
        : t.text;
  return (
    <Animated.View style={[press.anim, {flexShrink: 1}]}>
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        disabled={disabled || loading}
        onPressIn={press.onIn}
        onPressOut={press.onOut}
        style={[
          styles.btn,
          {
            backgroundColor: bg,
            opacity: disabled && !loading ? 0.45 : 1,
            borderWidth: kind === 'ghost' ? 1.5 : 2,
            borderColor:
              kind === 'ghost'
                ? t.dark
                  ? t.border
                  : t.stone
                : t.dark && kind !== 'primary'
                  ? t.border
                  : t.ink,
          },
        ]}>
        {loading ? (
          <Animated.View entering={FadeIn.duration(160)}>
            <Icon name="loading" size={20} color={fg} />
          </Animated.View>
        ) : (
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
            {!!icon && <Icon name={icon} size={18} color={fg} />}
            <Text style={[styles.btnText, {color: fg}]}>{title}</Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

/** Big circular record button with breathing idle + ember recording state. */
export function RecordButton({
  recording,
  working,
  onPress,
  size = 88,
}: {
  recording: boolean;
  working: boolean;
  onPress: () => void;
  size?: number;
}): React.JSX.Element {
  const t = useTheme();
  const pulse = useSharedValue(1);
  const press = useSharedValue(1);

  useEffect(() => {
    if (recording) {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1.08, {duration: 900}),
          withTiming(1, {duration: 900}),
        ),
        -1,
        true,
      );
    } else {
      pulse.value = withTiming(1, {duration: 240});
    }
  }, [pulse, recording]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{scale: pulse.value * press.value}],
  }));

  const bg = recording ? t.ember : working ? t.forest : t.lavender;
  const fg = recording ? t.ink : working ? t.forestInk : t.lavenderInk;

  return (
    <Animated.View style={pulseStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={recording ? 'Stop recording' : 'Start recording'}
        onPress={onPress}
        onPressIn={() => {
          press.value = withSpring(0.93, motion.spring);
        }}
        onPressOut={() => {
          press.value = withSpring(1, motion.spring);
        }}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: bg,
          borderWidth: 2,
          borderColor: t.dark ? t.cream : t.ink,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <Icon
          name={recording ? 'stop' : working ? 'brain' : 'microphone'}
          size={size * 0.38}
          color={fg}
        />
      </Pressable>
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

export function Field({
  title,
  value,
  onChange,
  secret,
  multiline,
  placeholder,
  keyboardType,
}: {
  title: string;
  value: string;
  onChange: (v: string) => void;
  secret?: boolean;
  multiline?: boolean;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
}): React.JSX.Element {
  const t = useTheme();
  const [focused, setFocused] = React.useState(false);
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldTitle, {color: t.text}]}>{title}</Text>
      <TextInput
        style={[
          styles.input,
          {
            color: t.text,
            borderColor: focused
              ? t.dark
                ? t.lavender
                : t.ink
              : t.dark
                ? t.border
                : t.stone,
            backgroundColor: t.inputBg,
            borderWidth: focused ? 2 : 1.5,
          },
          multiline && styles.inputMultiline,
        ]}
        placeholderTextColor={t.subtext}
        value={value}
        onChangeText={onChange}
        secureTextEntry={secret}
        multiline={multiline}
        placeholder={placeholder}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Status: banners, pills, dots, progress                             */
/* ------------------------------------------------------------------ */

const BANNER_ICON: Record<string, string> = {
  ok: 'check-circle',
  warn: 'alert',
  err: 'close-circle',
  info: 'information',
};

export function Banner({
  kind,
  text,
}: {
  kind: 'ok' | 'warn' | 'err' | 'info';
  text: string;
}): React.JSX.Element {
  const t = useTheme();
  const bg =
    kind === 'ok'
      ? t.okBg
      : kind === 'err'
        ? t.errBg
        : kind === 'warn'
          ? t.warnBg
          : t.dark
            ? t.cardElevated
            : '#F2F2DF';
  const fg =
    kind === 'ok'
      ? t.success
      : kind === 'err'
        ? t.danger
        : kind === 'warn'
          ? t.dark
            ? t.ember
            : '#7A5A00'
          : t.text;
  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      style={[styles.banner, {backgroundColor: bg}]}>
      <Icon
        name={BANNER_ICON[kind]}
        size={18}
        color={fg}
        style={{marginTop: 1}}
      />
      <Text style={[styles.bannerText, {color: t.text, flex: 1}]}>{text}</Text>
    </Animated.View>
  );
}

export function Pill({
  tone = 'neutral',
  text,
  dot,
}: {
  tone?: 'live' | 'ok' | 'warn' | 'neutral' | 'lavender';
  text: string;
  dot?: boolean;
}): React.JSX.Element {
  const t = useTheme();
  const bg =
    tone === 'live'
      ? t.ember
      : tone === 'ok'
        ? t.dark
          ? t.okBg
          : t.forest
        : tone === 'warn'
          ? t.warnBg
          : tone === 'lavender'
            ? t.lavender
            : t.dark
              ? t.cardElevated
              : t.stone;
  const fg =
    tone === 'ok' && !t.dark
      ? '#FFFFEB'
      : tone === 'warn'
        ? t.dark
          ? t.ember
          : '#7A5A00'
        : t.dark && (tone === 'neutral' || tone === 'ok')
          ? t.text
          : t.ink;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: bg,
        borderRadius: radius.pill,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderWidth: tone === 'lavender' || tone === 'live' ? 1.5 : 0,
        borderColor: t.dark ? t.cream : t.ink,
        alignSelf: 'flex-start',
      }}>
      {dot && (
        <View
          style={{width: 7, height: 7, borderRadius: 4, backgroundColor: fg}}
        />
      )}
      <Text style={{color: fg, fontWeight: '700', fontSize: fontSize.xs}}>
        {text}
      </Text>
    </View>
  );
}

export function StepDots({
  index,
  total,
}: {
  index: number;
  total: number;
}): React.JSX.Element {
  const t = useTheme();
  return (
    <View style={styles.dots}>
      {Array.from({length: total}, (_, i) => {
        const active = i === index;
        const done = i < index;
        return (
          <Animated.View
            key={i}
            layout={Layout.springify()}
            style={[
              styles.dot,
              {
                flex: active ? 2.2 : 1,
                backgroundColor: active
                  ? t.lavender
                  : done
                    ? t.dark
                      ? t.forest
                      : t.forest
                    : t.barBg,
                borderWidth: active ? 1.5 : 0,
                borderColor: t.dark ? t.cream : t.ink,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

export function ProgressBar({fraction}: {fraction: number}): React.JSX.Element {
  const t = useTheme();
  const f = Math.max(0, Math.min(1, fraction));
  const w = useSharedValue(f);
  useEffect(() => {
    w.value = withTiming(f, {duration: 300});
  }, [f, w]);
  const fill = useAnimatedStyle(() => ({flex: w.value}));
  const rest = useAnimatedStyle(() => ({flex: 1 - w.value}));
  return (
    <View style={[styles.pbar, {backgroundColor: t.barBg}]}>
      <Animated.View style={[styles.pfill, {backgroundColor: t.bar}, fill]} />
      <Animated.View style={rest} />
    </View>
  );
}

export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  renderLabel,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  renderLabel?: (v: T) => string;
}): React.JSX.Element {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: t.dark ? t.cardElevated : t.stone,
        borderRadius: radius.pill,
        padding: 4,
        gap: 4,
      }}>
      {options.map(o => {
        const active = o === value;
        return (
          <Pressable
            key={String(o)}
            onPress={() => onChange(o)}
            style={{
              flex: 1,
              borderRadius: radius.pill,
              paddingVertical: 10,
              alignItems: 'center',
              backgroundColor: active ? t.lavender : 'transparent',
              borderWidth: active ? 1.5 : 0,
              borderColor: t.dark ? t.cream : t.ink,
            }}>
            <Text
              style={{
                color: active ? t.lavenderInk : t.subtext,
                fontWeight: active ? '800' : '600',
                fontSize: fontSize.sm,
              }}>
              {renderLabel ? renderLabel(o) : String(o)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function EmptyState({
  title,
  body,
  icon = 'microphone-message',
}: {
  title: string;
  body: string;
  icon?: string;
}): React.JSX.Element {
  const t = useTheme();
  return (
    <Animated.View
      entering={FadeInUp.duration(motion.fadeMs).springify()}
      style={{alignItems: 'center', paddingVertical: spacing.xxl}}>
      <View
        style={{
          width: 76,
          height: 76,
          borderRadius: 38,
          backgroundColor: t.lavender,
          borderWidth: 2,
          borderColor: t.dark ? t.cream : t.ink,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: spacing.lg,
        }}>
        <Icon name={icon} size={34} color={t.lavenderInk} />
      </View>
      <Text
        style={{
          fontFamily: fonts.display,
          fontSize: fontSize.xl,
          color: t.text,
          textAlign: 'center',
        }}>
        {title}
      </Text>
      <Text
        style={{
          color: t.subtext,
          fontSize: fontSize.md,
          textAlign: 'center',
          marginTop: spacing.sm,
          lineHeight: 24,
          maxWidth: 280,
        }}>
        {body}
      </Text>
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ */
/* Waveform — lively bars tinted by amplitude                          */
/* ------------------------------------------------------------------ */

function barColor(l: number, t: ThemeColors): string {
  if (l > 0.72) {
    return t.ember;
  }
  if (l > 0.35) {
    return t.bar;
  }
  return t.barBg;
}

export function Waveform({levels}: {levels: number[]}): React.JSX.Element {
  const t = useTheme();
  return (
    <View style={[styles.wave, {backgroundColor: 'transparent'}]}>
      {levels.map((l, i) => {
        const v = Math.max(0, Math.min(1, l));
        return (
          <View
            key={i}
            style={[
              styles.wbar,
              {
                backgroundColor: barColor(v, t),
                height: 5 + v * 46,
                opacity: 0.45 + v * 0.55,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

/** Calm Flow alias — same lively visualizer, pill-framed when asked. */
export function LiveWaveform({
  levels,
  framed,
}: {
  levels: number[];
  framed?: boolean;
}): React.JSX.Element {
  const t = useTheme();
  if (!framed) {
    return <Waveform levels={levels} />;
  }
  return (
    <View
      style={{
        borderRadius: radius.pill,
        borderWidth: 1.5,
        borderColor: t.dark ? t.cream : t.ink,
        backgroundColor: t.dark ? t.cardElevated : '#FFFFFF',
        paddingHorizontal: 16,
        paddingVertical: 6,
      }}>
      <Waveform levels={levels} />
    </View>
  );
}

/* ------------------------------------------------------------------ */

export function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    padding: spacing.lg + 4,
    marginBottom: spacing.md,
  },
  cardTitle: {fontWeight: '700', marginBottom: spacing.sm, fontSize: 18},
  btn: {
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    flexShrink: 1,
  },
  btnText: {fontWeight: '700', fontSize: fontSize.md},
  field: {marginVertical: spacing.sm},
  fieldTitle: {fontWeight: '600', marginBottom: 6, fontSize: fontSize.sm},
  input: {
    borderRadius: 14,
    padding: 14,
    fontSize: fontSize.md,
  },
  inputMultiline: {minHeight: 96, textAlignVertical: 'top'},
  banner: {
    borderRadius: 16,
    padding: 12,
    marginVertical: spacing.sm,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  bannerText: {fontSize: fontSize.sm, lineHeight: 20},
  dots: {flexDirection: 'row', gap: 6, marginVertical: spacing.sm},
  dot: {height: 8, flex: 1, borderRadius: 5},
  pbar: {
    height: 10,
    borderRadius: 6,
    flexDirection: 'row',
    overflow: 'hidden',
    marginVertical: 6,
  },
  pfill: {borderRadius: 6},
  wave: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 58,
    marginVertical: spacing.sm,
  },
  wbar: {width: 4, borderRadius: 2},
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginVertical: spacing.sm,
    flexWrap: 'wrap',
  },
});

export type {ThemeColors};
