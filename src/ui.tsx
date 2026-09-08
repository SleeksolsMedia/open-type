import React, {useEffect} from 'react';
import {
  Modal,
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
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {
  fonts,
  fontSize,
  motion,
  radius,
  spacing,
  useTheme,
  type ThemeColors,
} from './theme';
import {AppIcon} from './icons';
import {VoicebarOrb, type OrbState} from './Orb';

/* ------------------------------------------------------------------ */
/* Icons & Orb re-export                                              */
/* ------------------------------------------------------------------ */
export {AppIcon, ICON_NAMES} from './icons';
export {VoicebarOrb, OrbPressable, type OrbState} from './Orb';

/* ------------------------------------------------------------------ */
/* Section eyebrow + page header (mono eyebrow, system-bold title)     */
/* ------------------------------------------------------------------ */

export function PageHeader({
  eyebrow,
  title,
  trailing,
}: {
  eyebrow?: string;
  title: string;
  trailing?: React.ReactNode;
}): React.JSX.Element {
  const t = useTheme();
  return (
    <Animated.View
      entering={FadeInUp.duration(motion.small)}
      style={{
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.sm,
        paddingBottom: spacing.md,
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: spacing.md,
      }}>
      <View style={{flex: 1}}>
        {!!eyebrow && (
          <Text
            style={{
              fontFamily: fonts.mono,
              fontSize: fontSize.xs,
              color: t.inkLow,
              letterSpacing: 1.4,
              textTransform: 'uppercase',
              marginBottom: 6,
            }}>
            {eyebrow}
          </Text>
        )}
        <Text
          style={{
            fontFamily: fonts.bodyExtraBold,
            fontSize: fontSize.display,
            lineHeight: fontSize.display * 0.98,
            letterSpacing: -1.2,
            color: t.ink,
          }}>
          {title}
        </Text>
      </View>
      {trailing}
    </Animated.View>
  );
}

export function SectionEyebrow({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const t = useTheme();
  return (
    <Text
      style={[
        {
          fontFamily: fonts.mono,
          fontSize: 10,
          color: t.inkLow,
          letterSpacing: 1.2,
          textTransform: 'uppercase',
          marginTop: spacing.md,
          marginBottom: 6,
          paddingHorizontal: spacing.lg,
        },
        style,
      ]}>
      {children}
    </Text>
  );
}

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

export function Row({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  return <View style={[styles.row, style]}>{children}</View>;
}

/* ------------------------------------------------------------------ */
/* Cards — flat, hairline border, 14dp radius                          */
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
          backgroundColor: t.surface,
          borderColor: t.line,
          borderWidth: 1,
        },
        framed && {borderColor: t.ink, borderWidth: 1.5},
        style,
      ]}>
      {children}
    </Animated.View>
  );
}

export const FlowCard = Card;

export function CardTitle({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
}): React.JSX.Element {
  const t = useTheme();
  return (
    <Text
      style={[
        {
          fontFamily: fonts.bodySemiBold,
          fontSize: fontSize.lg,
          color: t.ink,
          marginBottom: spacing.sm,
          letterSpacing: -0.2,
        },
        style,
      ]}>
      {children}
    </Text>
  );
}

/* ------------------------------------------------------------------ */
/* Setting rows                                                       */
/* ------------------------------------------------------------------ */

export function SettingRow({
  icon,
  title,
  subtitle,
  trailing,
  onPress,
}: {
  icon?: string;
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode | 'chevron';
  onPress?: () => void;
}): React.JSX.Element {
  const t = useTheme();
  const inner = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingVertical: 13,
        paddingHorizontal: spacing.lg,
        minHeight: 60,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderColor: t.line,
      }}>
      {icon && (
        <View
          style={{
            width: 24,
            height: 24,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <AppIcon name={icon} size={20} color={t.ink} />
        </View>
      )}
      <View style={{flex: 1}}>
        <Text
          style={{
            color: t.ink,
            fontFamily: fonts.bodySemiBold,
            fontSize: 14,
            letterSpacing: -0.1,
          }}>
          {title}
        </Text>
        {!!subtitle && (
          <Text
            style={{
              color: t.inkMid,
              fontFamily: fonts.body,
              fontSize: 12,
              marginTop: 2,
              lineHeight: 16,
            }}>
            {subtitle}
          </Text>
        )}
      </View>
      {trailing === 'chevron' ? (
        <AppIcon name="chevron-right" size={20} color={t.inkLow} />
      ) : (
        trailing
      )}
    </View>
  );
  if (!onPress) {
    return inner;
  }
  return (
    <Pressable accessibilityRole="button" onPress={onPress}>
      {inner}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* Status row + status pill                                           */
/* ------------------------------------------------------------------ */

export type StatusState = 'checking' | 'ok' | 'attention' | 'error';

const STATUS_META: Record<StatusState, {icon: string}> = {
  checking: {icon: 'loading'},
  ok: {icon: 'check-circle'},
  attention: {icon: 'alert'},
  error: {icon: 'close-circle'},
};

export function StatusRow({
  state,
  title,
  body,
  actionLabel,
  onAction,
}: {
  state: StatusState;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}): React.JSX.Element {
  const t = useTheme();
  const fg =
    state === 'ok'
      ? t.done
      : state === 'error'
        ? t.err
        : state === 'attention'
          ? t.amberDark
          : t.inkMid;
  return (
    <SettingRow
      icon={STATUS_META[state].icon}
      title={title}
      subtitle={body}
      trailing={
        actionLabel && onAction ? (
          <Pressable
            accessibilityRole="button"
            onPress={onAction}
            style={{
              borderRadius: radius.pill,
              paddingHorizontal: 14,
              paddingVertical: 8,
              backgroundColor: t.coral,
            }}>
            <Text
              style={{
                color: '#fff',
                fontFamily: fonts.bodySemiBold,
                fontSize: 12,
              }}>
              {actionLabel}
            </Text>
          </Pressable>
        ) : (
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 6}}>
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: fg,
              }}
            />
            <Text
              style={{
                color: fg,
                fontFamily: fonts.mono,
                fontSize: 10,
                letterSpacing: 1,
                textTransform: 'uppercase',
              }}>
              {state === 'ok'
                ? 'Ready'
                : state === 'checking'
                  ? 'Checking'
                  : state === 'attention'
                    ? 'Needs action'
                    : 'Failed'}
            </Text>
          </View>
        )
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Buttons — coral CTA + ghost                                         */
/* ------------------------------------------------------------------ */

function usePressScale(disabled?: boolean) {
  const s = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({transform: [{scale: s.value}]}));
  return {
    anim,
    onIn: () => {
      if (!disabled) {
        s.value = withTiming(motion.pressScale, {duration: motion.micro});
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
  fullWidth,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  icon?: string;
  fullWidth?: boolean;
}): React.JSX.Element {
  const t = useTheme();
  const press = usePressScale(disabled || loading);
  const bg =
    kind === 'primary' ? t.coral : kind === 'danger' ? t.err : 'transparent';
  const fg =
    kind === 'primary' ? '#FFFFFF' : kind === 'danger' ? '#FFFFFF' : t.ink;
  return (
    <Animated.View
      style={[
        press.anim,
        {flexShrink: 1, alignSelf: fullWidth ? 'stretch' : 'auto'},
      ]}>
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
            borderWidth: kind === 'ghost' ? 1 : 0,
            borderColor: t.line,
          },
        ]}>
        {loading ? (
          <Animated.View entering={FadeIn.duration(motion.small)}>
            <AppIcon name="loading" size={20} color={fg} />
          </Animated.View>
        ) : (
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
            {!!icon && <AppIcon name={icon} size={18} color={fg} />}
            <Text
              style={{
                color: fg,
                fontFamily: fonts.bodySemiBold,
                fontSize: 14,
                letterSpacing: -0.1,
              }}>
              {title}
            </Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ */
/* Orb FAB — replaces the big circular RecordButton on Home           */
/* ------------------------------------------------------------------ */

export function OrbRecord({
  state,
  level,
  onPress,
  sizeScale = 1,
}: {
  state: OrbState;
  level?: number;
  onPress: () => void;
  sizeScale?: number;
}): React.JSX.Element {
  const press = useSharedValue(1);
  const onIn = () => {
    press.value = withTiming(motion.pressScale, {duration: motion.micro});
  };
  const onOut = () => {
    press.value = withSpring(1, motion.spring);
  };
  const animStyle = useAnimatedStyle(() => ({transform: [{scale: press.value}]}));
  return (
    <Animated.View style={animStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          state === 'listening'
            ? 'Stop recording'
            : state === 'enhancing'
              ? 'Cancel'
              : 'Start recording'
        }
        onPress={onPress}
        onPressIn={onIn}
        onPressOut={onOut}>
        <VoicebarOrb state={state} level={level} sizeScale={sizeScale} />
      </Pressable>
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ */
/* Inputs                                                             */
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
      <Text
        style={{
          fontFamily: fonts.mono,
          fontSize: 10,
          color: t.inkLow,
          letterSpacing: 1.4,
          textTransform: 'uppercase',
          marginBottom: 6,
        }}>
        {title}
      </Text>
      <TextInput
        style={[
          styles.input,
          {
            color: t.ink,
            fontFamily: fonts.body,
            borderColor: focused ? t.ink : t.line,
            backgroundColor: t.surface,
            borderWidth: focused ? 1.5 : 1,
          },
          multiline && styles.inputMultiline,
        ]}
        placeholderTextColor={t.inkLow}
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
/* Banners, pills, badges, mono segmented, status dots                 */
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
  const {bg, fg, iconColor} =
    kind === 'ok'
      ? {bg: t.okBg, fg: t.ink, iconColor: t.done}
      : kind === 'err'
        ? {bg: t.errBg, fg: t.ink, iconColor: t.err}
        : kind === 'warn'
          ? {bg: t.warnBg, fg: t.ink, iconColor: t.amberDark}
          : {bg: t.surfaceMuted, fg: t.ink, iconColor: t.ink};
  return (
    <Animated.View
      entering={FadeIn.duration(motion.small)}
      style={[
        styles.banner,
        {backgroundColor: bg, borderColor: t.line, borderWidth: 1},
      ]}>
      <AppIcon name={BANNER_ICON[kind]} size={18} color={iconColor} style={{marginTop: 1}} />
      <Text
        style={{
          color: fg,
          fontFamily: fonts.body,
          fontSize: 13,
          lineHeight: 19,
          flex: 1,
        }}>
        {text}
      </Text>
    </Animated.View>
  );
}

/**
 * Pill — coral/amber/lavender-styled chip with mono text.
 */
export function Pill({
  tone = 'neutral',
  text,
  dot,
}: {
  tone?: 'live' | 'ok' | 'warn' | 'neutral' | 'amber' | 'coral';
  text: string;
  dot?: boolean;
}): React.JSX.Element {
  const t = useTheme();
  const pair =
    tone === 'coral' || tone === 'live'
      ? {bg: t.coral, fg: '#FFFFFF'}
      : tone === 'amber'
        ? {bg: t.amber, fg: t.ink}
        : tone === 'ok'
          ? {bg: t.ink, fg: '#FFFFFF'}
          : tone === 'warn'
            ? {bg: t.amberFaint, fg: t.amberDark}
            : {bg: t.surfaceMuted, fg: t.ink};
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: pair.bg,
        borderRadius: radius.pill,
        paddingHorizontal: 12,
        paddingVertical: 5,
        alignSelf: 'flex-start',
      }}>
      {dot && (
        <View
          style={{width: 7, height: 7, borderRadius: 4, backgroundColor: pair.fg}}
        />
      )}
      <Text
        style={{
          color: pair.fg,
          fontFamily: fonts.mono,
          fontSize: 10,
          letterSpacing: 1,
          textTransform: 'uppercase',
        }}>
        {text}
      </Text>
    </View>
  );
}

/**
 * Count badge — small monochrome counter.
 */
export function Badge({count, max = 99}: {count: number; max?: number}): React.JSX.Element {
  const t = useTheme();
  if (count <= 0) {
    return <View />;
  }
  return (
    <View
      style={{
        backgroundColor: t.ink,
        borderRadius: 10,
        minWidth: 20,
        height: 20,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 5,
      }}>
      <Text
        style={{
          color: t.bg,
          fontSize: 11,
          fontFamily: fonts.bodyBold,
        }}>
        {count > max ? `${max}` : count}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Segmented control — square cells, mono labels, ink fill on active    */
/* ------------------------------------------------------------------ */

export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  renderLabel,
  mono,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  renderLabel?: (v: T) => string;
  mono?: boolean;
}): React.JSX.Element {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: t.surfaceMuted,
        borderRadius: 10,
        padding: 3,
        gap: 0,
        borderWidth: 1,
        borderColor: t.line,
      }}>
      {options.map(o => {
        const active = o === value;
        return (
          <Pressable
            key={String(o)}
            accessibilityRole="button"
            accessibilityState={{selected: active}}
            onPress={() => onChange(o)}
            style={{
              flex: 1,
              borderRadius: 8,
              paddingVertical: 8,
              paddingHorizontal: 6,
              minHeight: 36,
              justifyContent: 'center',
              alignItems: 'center',
              backgroundColor: active ? t.ink : 'transparent',
            }}>
            <Text
              style={{
                color: active ? t.bg : t.inkMid,
                fontFamily: mono || typeof o === 'number' ? fonts.mono : fonts.bodySemiBold,
                fontSize: mono || typeof o === 'number' ? 11 : 12,
                letterSpacing: mono || typeof o === 'number' ? 0.6 : 0,
              }}>
              {renderLabel ? renderLabel(o) : String(o)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* ToggleSwitch — replaces the platform Switch in design-system look   */
/* ------------------------------------------------------------------ */

export function ToggleSwitch({
  value,
  onValueChange,
  disabled,
}: {
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const t = useTheme();
  const bg = value ? t.coral : t.inkLow;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{checked: value, disabled}}
      onPress={() => !disabled && onValueChange(!value)}
      style={{
        width: 36,
        height: 21,
        borderRadius: 999,
        backgroundColor: bg,
        padding: 2,
        opacity: disabled ? 0.4 : 1,
        justifyContent: 'center',
      }}>
      <View
        style={{
          width: 17,
          height: 17,
          borderRadius: 999,
          backgroundColor: '#FFFFFF',
          alignSelf: value ? 'flex-end' : 'flex-start',
        }}
      />
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* Empty state                                                        */
/* ------------------------------------------------------------------ */

export function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}): React.JSX.Element {
  const t = useTheme();
  return (
    <Animated.View
      entering={FadeInUp.duration(motion.fadeMs).springify()}
      style={{alignItems: 'center', paddingVertical: spacing.xxl}}>
      <VoicebarOrb state="idle" inline sizeScale={1} />
      <Text
        style={{
          fontFamily: fonts.bodyExtraBold,
          fontSize: fontSize.xl,
          color: t.ink,
          textAlign: 'center',
          marginTop: spacing.lg,
          letterSpacing: -0.4,
        }}>
        {title}
      </Text>
      <Text
        style={{
          color: t.inkMid,
          fontFamily: fonts.body,
          fontSize: fontSize.md,
          textAlign: 'center',
          marginTop: spacing.sm,
          lineHeight: 22,
          maxWidth: 280,
        }}>
        {body}
      </Text>
      {!!actionLabel && !!onAction && (
        <View style={{marginTop: spacing.lg}}>
          <Btn title={actionLabel} icon="microphone" onPress={onAction} />
        </View>
      )}
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ */
/* Sheet + Toast                                                       */
/* ------------------------------------------------------------------ */

export function ConfirmSheet({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive,
  confirming,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  confirming?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const t = useTheme();
  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={onCancel}>
      <View
        style={{
          flex: 1,
          justifyContent: 'flex-end',
          backgroundColor: t.dark ? 'rgba(0,0,0,0.6)' : 'rgba(26,23,20,0.45)',
        }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          onPress={onCancel}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View
          entering={FadeInUp.duration(motion.medium).springify()}
          style={{
            backgroundColor: t.surface,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            borderTopWidth: 1,
            borderColor: t.line,
            padding: spacing.lg,
            paddingBottom: spacing.xl,
          }}>
          <Text
            style={{
              fontFamily: fonts.bodyExtraBold,
              fontSize: fontSize.xl,
              color: t.ink,
              letterSpacing: -0.4,
            }}>
            {title}
          </Text>
          <Text
            style={{
              color: t.inkMid,
              fontFamily: fonts.body,
              fontSize: 14,
              lineHeight: 21,
              marginTop: spacing.sm,
            }}>
            {body}
          </Text>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'flex-end',
              gap: spacing.sm,
              marginTop: spacing.lg,
            }}>
            <Btn title={cancelLabel} kind="ghost" onPress={onCancel} />
            <Btn
              title={confirmLabel}
              kind={destructive ? 'danger' : 'primary'}
              loading={confirming}
              onPress={onConfirm}
            />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

export function Toast({
  messageKey,
  message,
  onHide,
}: {
  messageKey: string;
  message: string | null;
  onHide: () => void;
}): React.JSX.Element | null {
  const t = useTheme();
  useEffect(() => {
    if (!message) {
      return;
    }
    const id = setTimeout(onHide, 3000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageKey]);
  if (!message) {
    return null;
  }
  return (
    <Animated.View
      entering={FadeInUp.duration(motion.small).springify()}
      style={{
        position: 'absolute',
        bottom: 24,
        left: 24,
        right: 24,
        backgroundColor: t.ink,
        borderRadius: 10,
        padding: 11,
        paddingHorizontal: 16,
      }}>
      <Text
        style={{
          color: t.bg,
          fontFamily: fonts.bodySemiBold,
          fontSize: 13,
          textAlign: 'center',
        }}>
        {message}
      </Text>
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ */
/* Live waveform — 5 coral bars, amplitude-driven                      */
/* ------------------------------------------------------------------ */

function barColor(l: number, t: ThemeColors): string {
  if (l > 0.7) {
    return t.coralLight;
  }
  if (l > 0.3) {
    return t.coral;
  }
  return t.line;
}

export function Waveform({levels}: {levels: number[]}): React.JSX.Element {
  return (
    <View style={[styles.wave, {backgroundColor: 'transparent'}]}>
      {levels.map((l, i) => {
        const v = Math.max(0, Math.min(1, l));
        return <WaveBar key={i} value={v} />;
      })}
    </View>
  );
}

function WaveBar({value}: {value: number}): React.JSX.Element {
  const t = useTheme();
  return (
    <View
      style={[
        styles.wbar,
        {
          backgroundColor: barColor(value, t),
          height: 5 + value * 46,
        },
      ]}
    />
  );
}

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
        borderWidth: 1,
        borderColor: t.line,
        backgroundColor: t.surface,
        paddingHorizontal: 16,
        paddingVertical: 6,
      }}>
      <Waveform levels={levels} />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Stats row — three mono-stamped counters                            */
/* ------------------------------------------------------------------ */

export function StatsRow({
  items,
}: {
  items: {label: string; value: string; icon?: string}[];
}): React.JSX.Element {
  const t = useTheme();
  return (
    <View style={{flexDirection: 'row', gap: spacing.sm}}>
      {items.map(s => (
        <View
          key={s.label}
          style={{
            flex: 1,
            backgroundColor: t.surface,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: t.line,
            paddingVertical: spacing.md,
            paddingHorizontal: spacing.md,
            alignItems: 'flex-start',
          }}>
          {s.icon && (
            <AppIcon name={s.icon} size={16} color={t.inkLow} />
          )}
          <Text
            style={{
              fontFamily: fonts.bodyExtraBold,
              fontSize: 22,
              color: t.ink,
              marginTop: 4,
              letterSpacing: -0.4,
            }}>
            {s.value}
          </Text>
          <Text
            style={{
              color: t.inkLow,
              fontFamily: fonts.mono,
              fontSize: 10,
              letterSpacing: 1.2,
              textTransform: 'uppercase',
              marginTop: 2,
            }}>
            {s.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Note row — mono timestamp on left, body on right                   */
/* ------------------------------------------------------------------ */

export function NoteRow({
  when,
  source,
  body,
  selected,
  onPress,
  onLongPress,
}: {
  when: string;
  source: string;
  body: string;
  selected?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
}): React.JSX.Element {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      onLongPress={onLongPress}>
      <View
        style={{
          paddingVertical: 13,
          paddingHorizontal: spacing.lg,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderColor: t.line,
          backgroundColor: selected ? t.surfaceMuted : 'transparent',
        }}>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            marginBottom: 5,
          }}>
          <Text
            style={{
              fontFamily: fonts.mono,
              fontSize: 9,
              color: t.inkLow,
              letterSpacing: 1,
              textTransform: 'uppercase',
            }}>
            {when}
          </Text>
          <Text
            style={{
              fontFamily: fonts.mono,
              fontSize: 9,
              color: t.coral,
              letterSpacing: 1,
              textTransform: 'uppercase',
            }}>
            {source}
          </Text>
        </View>
        <Text
          style={{
            fontFamily: fonts.body,
            fontSize: 13,
            color: t.inkSoft,
            lineHeight: 18,
          }}
          numberOfLines={2}>
          {body}
        </Text>
      </View>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* Step dots + progress bar                                            */
/* ------------------------------------------------------------------ */

export function StepDots({
  index,
  total,
  label,
}: {
  index: number;
  total: number;
  label?: string;
}): React.JSX.Element {
  const t = useTheme();
  return (
    <View>
      {!!label && (
        <Text
          style={{
            color: t.inkLow,
            fontFamily: fonts.mono,
            fontSize: 10,
            letterSpacing: 1.2,
            textTransform: 'uppercase',
            marginBottom: 6,
          }}>
          {label}
        </Text>
      )}
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
                    ? t.coral
                    : done
                      ? t.ink
                      : t.line,
                },
              ]}
            />
          );
        })}
      </View>
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
    <View style={[styles.pbar, {backgroundColor: t.line}]}>
      <Animated.View style={[styles.pfill, {backgroundColor: t.coral}, fill]} />
      <Animated.View style={rest} />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Legacy export — RecordButton alias so anything still importing it   */
/* doesn't break. Now points at the orb at 100%.                       */
/* ------------------------------------------------------------------ */
export function RecordButton({
  recording,
  working,
  onPress,
  size = 76,
}: {
  recording: boolean;
  working: boolean;
  onPress: () => void;
  size?: number;
}): React.JSX.Element {
  const state: OrbState = working
    ? 'enhancing'
    : recording
      ? 'listening'
      : 'idle';
  const sizeScale = size / 66;
  return <OrbRecord state={state} onPress={onPress} sizeScale={sizeScale} />;
}

/* ------------------------------------------------------------------ */
/* Section header (legacy)                                             */
/* ------------------------------------------------------------------ */

export function SectionHeader({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}): React.JSX.Element {
  const t = useTheme();
  return (
    <View style={{marginTop: spacing.md, marginBottom: spacing.sm}}>
      <Text
        style={{
          color: t.inkLow,
          fontFamily: fonts.mono,
          fontSize: 10,
          letterSpacing: 1.4,
          textTransform: 'uppercase',
        }}>
        {title}
      </Text>
      {!!hint && (
        <Text
          style={{
            color: t.inkMid,
            fontFamily: fonts.body,
            fontSize: 12,
            marginTop: 2,
          }}>
          {hint}
        </Text>
      )}
    </View>
  );
}

export function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function Hero(props: {title: string; subtitle?: string; align?: 'left' | 'center'}): React.JSX.Element {
  const t = useTheme();
  const align = props.align ?? 'left';
  return (
    <Animated.View entering={FadeInUp.duration(motion.fadeMs).springify()} style={{paddingHorizontal: spacing.lg, paddingVertical: spacing.md}}>
      <Text style={{fontFamily: fonts.bodyExtraBold, fontSize: fontSize.display, lineHeight: fontSize.display * 0.98, letterSpacing: -1.2, color: t.ink, textAlign: align}}>
        {props.title}
      </Text>
      {!!props.subtitle && (
        <Text style={{color: t.inkMid, fontFamily: fonts.body, fontSize: fontSize.md, lineHeight: 22, marginTop: spacing.sm, textAlign: align}}>
          {props.subtitle}
        </Text>
      )}
    </Animated.View>
  );
}

export function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  btn: {
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    flexShrink: 1,
  },
  field: {marginVertical: spacing.sm},
  input: {
    borderRadius: 10,
    padding: 13,
    fontSize: 15,
  },
  inputMultiline: {minHeight: 96, textAlignVertical: 'top'},
  banner: {
    borderRadius: 12,
    padding: 12,
    marginVertical: spacing.sm,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  dots: {flexDirection: 'row', gap: 6, marginVertical: spacing.sm},
  dot: {height: 6, flex: 1, borderRadius: 3},
  pbar: {
    height: 8,
    borderRadius: 4,
    flexDirection: 'row',
    overflow: 'hidden',
    marginVertical: 6,
  },
  pfill: {borderRadius: 4},
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