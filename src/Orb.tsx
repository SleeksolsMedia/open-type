import React, {useEffect} from 'react';
import {View, type ViewStyle} from 'react-native';
import Svg, {Path} from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {fonts, motion, radius, spacing, useTheme} from './theme';

/**
 * VoicebarOrb — the floating voice bubble from design-system.html.
 *
 * Spec (section 02 of the design system):
 *   - Surface: ink (#1A1714), perfect circle, drop shadow.
 *   - Mark:    5-bar equalizer caret.
 *   - States:  idle / shrunk / listening / enhancing / done / error.
 *   - Sizes:   70/85/100/115 (% of 66dp base) — surfaced via sizeScale.
 *   - Behavior: orb grows 1 → 1.1 on listening; coral ring pulses 1.6s loop;
 *               bars bounce to live mic amplitude.
 *
 * The 5 bars are drawn with plain Views (not SVG Lines) so each bar's
 * height can be driven by a Reanimated shared value — the SVG path
 * approach can't reactively resize inside a single Svg tree.
 */

export type OrbState =
  | 'idle'
  | 'shrunk'
  | 'listening'
  | 'enhancing'
  | 'done'
  | 'error';

export interface OrbProps {
  state?: OrbState;
  /** Live amplitude 0–1, drives bar bounce while listening. */
  level?: number;
  /** 0.7 / 0.85 / 1.0 / 1.15 — the size steps from settings. */
  sizeScale?: number;
  /** Opacity of the resting state (active states always render at 1). */
  idleOpacity?: number;
  /** Compact mode for in-card use; trims shadow/ring outset. */
  inline?: boolean;
  style?: ViewStyle;
}

const BASE_DIAMETER = 66;
const RING_OUTSET = 6;

// Mark layout: 5 bars inside a 100x100 box. h values are the rest
// heights in viewBox units. h=64 is the tallest (center); h=24 is the
// shortest (outer). All scale linearly from maxBarHeight.
const BAR_SPECS: ReadonlyArray<{x: number; h: number; o: number}> = [
  {x: 26, h: 24, o: 0.55},
  {x: 38, h: 44, o: 0.78},
  {x: 50, h: 64, o: 1},
  {x: 62, h: 44, o: 0.78},
  {x: 74, h: 24, o: 0.55},
];

const CORAL = '#E8552B';
const CORAL_LIGHT = '#F27A54';
const AMBER = '#F2B705';
const DONE = '#0F8E7E';
const INK = '#1A1714';

/* ------------------------------------------------------------------ */
/* 5-bar mark — rendered as 5 View "bars" (RoundCappedViews)         */
/* ------------------------------------------------------------------ */

function BarsMark({
  size,
  live,
  level,
  color,
}: {
  size: number;
  live: boolean;
  level: number;
  color: string;
}): React.JSX.Element {
  // The mark is a 100x100 logical box scaled to `size` dp on screen.
  // Each bar is a column ~9dp wide with a vertical animated height.
  const barW = size * 0.09;
  const gap = size * 0.025;
const maxBarHeight = size * 0.72; // tallest bar (center) at rest = 0.64 * size

  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
        }}>
        {BAR_SPECS.map((spec, i) => (
          <BarColumn
            key={i}
            restHeightPct={spec.h / 64}
            opacity={spec.o}
            width={barW}
            maxBarHeight={maxBarHeight}
            gap={i === 0 ? 0 : gap}
            live={live}
            level={level}
            color={color}
          />
        ))}
      </View>
    </View>
  );
}

/* * BarColumn — one vertical bar with animated height. Uses scaleY so
 * the bar grows/shrinks around its center, exactly matching the
 * amplitude-driven bounce from the design system. */
function BarColumn({
  restHeightPct,
  opacity,
  width,
  maxBarHeight,
  gap,
  live,
  level,
  color,
}: {
  restHeightPct: number;
  opacity: number;
  width: number;
  maxBarHeight: number;
  gap: number;
  live: boolean;
  level: number;
  color: string;
}): React.JSX.Element {
  const restPx = restHeightPct * maxBarHeight;
  const h = useSharedValue(restPx);

  useEffect(() => {
    if (!live) {
      h.value = withTiming(restPx, {duration: motion.small});
      return;
    }
    const target = Math.max(restPx * 0.4, Math.min(restPx * 1.25, restPx * (0.55 + level * 0.65)));
    h.value = withRepeat(
      withSequence(
        withTiming(target, {duration: 280, easing: Easing.inOut(Easing.quad)}),
        withTiming(restPx * 0.6, {duration: 280, easing: Easing.inOut(Easing.quad)}),
      ),
      -1,
      true,
    );
    return () => {
      h.value = restPx;
    };
  }, [live, level, restPx, h]);

  const animStyle = useAnimatedStyle(() => ({height: h.value}));

  return (
    <Animated.View
      style={[
        {
          width,
          marginLeft: gap,
          backgroundColor: color,
          borderRadius: width / 2,
          opacity,
        },
        animStyle,
      ]}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Amber spark (LLM enhancing)                                        */
/* ------------------------------------------------------------------ */

function SparkMark({size}: {size: number}): React.JSX.Element {
  const spin = useSharedValue(0);
  useEffect(() => {
    spin.value = withRepeat(
      withTiming(360, {duration: 2400, easing: Easing.linear}),
      -1,
      false,
    );
    return () => {
      spin.value = 0;
    };
  }, [spin]);
  const animStyle = useAnimatedStyle(() => ({transform: [{rotate: `${spin.value}deg`}]}));
  return (
    <Animated.View style={animStyle}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Path
          d="M50 12 l4 22 22 4 -22 4 -4 22 -4 -22 -22 -4 22 -4z"
          fill={AMBER}
        />
      </Svg>
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ */
/* Done check                                                          */
/* ------------------------------------------------------------------ */

function DoneCheck({size}: {size: number}): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <Path
        d="M28 52 L46 70 L74 36"
        stroke="#FFFFFF"
        strokeWidth={10}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/* ------------------------------------------------------------------ */
/* Coral pulse ring (listening)                                       */
/* ------------------------------------------------------------------ */

function PulseRing({active}: {active: boolean}): React.JSX.Element | null {
  const scale = useSharedValue(0.9);
  const opacity = useSharedValue(0);
  useEffect(() => {
    if (!active) {
      scale.value = 0.9;
      opacity.value = 0;
      return;
    }
    scale.value = 0.9;
    opacity.value = 0.55;
    scale.value = withRepeat(
      withTiming(1.5, {duration: 1600, easing: Easing.out(Easing.cubic)}),
      -1,
      false,
    );
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.55, {duration: 200}),
        withTiming(0, {duration: 1400, easing: Easing.out(Easing.cubic)}),
      ),
      -1,
      false,
    );
    return () => {
      scale.value = 0.9;
      opacity.value = 0;
    };
  }, [active, scale, opacity]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{scale: scale.value}],
    opacity: opacity.value,
  }));

  if (!active) {
    return null;
  }
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: 9999,
          borderWidth: 2,
          borderColor: CORAL,
        },
        animStyle,
      ]}
    />
  );
}

/* ------------------------------------------------------------------ */
/* VoicebarOrb — the public component                                  */
/* ------------------------------------------------------------------ */

export function VoicebarOrb({
  state = 'idle',
  level = 0,
  sizeScale = 1,
  idleOpacity = 1,
  inline,
  style,
}: OrbProps): React.JSX.Element {
  const t = useTheme();
  const diameter = BASE_DIAMETER * sizeScale;
  const isActive =
    state === 'listening' || state === 'enhancing' || state === 'done';
  const opacity = isActive ? 1 : idleOpacity;

  // Grow on record (idle → listening): scale 1 → 1.1, ~180ms.
  const grow = useSharedValue(1);
  useEffect(() => {
    if (state === 'listening') {
      grow.value = withSpring(1.1, {damping: 18, stiffness: 200});
    } else if (state === 'shrunk') {
      grow.value = withSpring(0.34, motion.orbSnap);
    } else if (state === 'done') {
      grow.value = withSequence(
        withSpring(1.06, {damping: 16, stiffness: 220}),
        withSpring(1, motion.orbSnap),
      );
    } else {
      grow.value = withSpring(1, motion.orbSnap);
    }
  }, [state, grow]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{scale: grow.value}],
  }));

  const surfaceBg =
    state === 'done'
      ? DONE
      : state === 'error'
        ? INK
        : INK;

  // Mark color: coral-light on dark surfaces, coral on light.
  const barColor = t.dark ? CORAL_LIGHT : CORAL;

  // Mark size — roughly 62% of diameter.
  const markSize = Math.max(20, Math.round(diameter * 0.78));
  const wrapperStyle: ViewStyle = {
    width: diameter,
    height: diameter,
    borderRadius: diameter / 2,
    backgroundColor: surfaceBg,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
    opacity,
    shadowColor: INK,
    shadowOpacity: 0.34,
    shadowRadius: 26,
    shadowOffset: {width: 0, height: inline ? 4 : 10},
    elevation: inline ? 2 : 8,
    margin: inline ? 0 : RING_OUTSET,
  };

  return (
    <Animated.View style={[animStyle, style]}>
      <View style={wrapperStyle}>
        <PulseRing active={state === 'listening'} />
        {state === 'shrunk' ? (
          <View
            style={{
              width: markSize * 0.18,
              height: markSize * 0.7,
              backgroundColor: barColor,
              borderRadius: markSize * 0.09,
            }}
          />
        ) : state === 'enhancing' ? (
          <SparkMark size={markSize} />
        ) : state === 'done' ? (
          <DoneCheck size={markSize} />
        ) : state === 'error' ? (
          <View style={{alignItems: 'center', justifyContent: 'center'}}>
            <BarsMark size={markSize} live={false} level={0} color={barColor} />
            <ErrorBadge size={diameter * 0.36} color={t.err} />
          </View>
        ) : (
          <BarsMark
            size={markSize}
            live={state === 'listening'}
            level={level}
            color={barColor}
          />
        )}
      </View>
    </Animated.View>
  );
}

function ErrorBadge({size, color}: {size: number; color: string}): React.JSX.Element {
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: -size * 0.32,
        right: -size * 0.32,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <View
        style={{
          width: size * 0.14,
          height: size * 0.5,
          backgroundColor: '#FFFFFF',
          borderRadius: 2,
        }}
      />
      <View
        style={{
          position: 'absolute',
          bottom: size * 0.18,
          width: size * 0.14,
          height: size * 0.14,
          borderRadius: size * 0.07,
          backgroundColor: '#FFFFFF',
        }}
      />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Pressable wrapper — for hold-to-speak + tap (used by FABs)        */
/* ------------------------------------------------------------------ */

export function OrbPressable({
  state,
  level,
  sizeScale,
  onPress: _onPress,
  onLongPressStart: _onLongPressStart,
  onLongPressEnd: _onLongPressEnd,
  idleOpacity,
  style,
}: OrbProps & {
  onPress?: () => void;
  onLongPressStart?: () => void;
  onLongPressEnd?: () => void;
}): React.JSX.Element {
  // Press handlers are accepted for API compatibility but unused — hosts
  // wire their own Pressable wrappers around <VoicebarOrb />.
  const press = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({transform: [{scale: press.value}]}));
  return (
    <Animated.View style={[animStyle, style]}>
      <VoicebarOrb
        state={state}
        level={level}
        sizeScale={sizeScale}
        idleOpacity={idleOpacity}
      />
    </Animated.View>
  );
}

// Legacy alias.
export {VoicebarOrb as Orb};

export const orbStyles = {spacing, radius, fonts};