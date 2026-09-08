import {Platform, useColorScheme} from 'react-native';

/**
 * OpenType — editorial design system.
 *
 * Source-of-truth = design-system.html. The look is a paper-and-ink
 * newsroom: warm paper background, ink surface for the orb and text,
 * coral as the "voice" accent, amber reserved for LLM enhance only,
 * mono metadata for the developer texture.
 */

export interface ThemeColors {
  dark: boolean;
  bg: string;          // page surface
  surface: string;     // raised cards / sheets
  surfaceMuted: string;// subtle band / sheets on top of bg
  ink: string;         // primary text + orb surface
  inkSoft: string;     // secondary text on light, primary on dark
  inkMid: string;      // tertiary text
  inkLow: string;      // captions, mono eyebrow
  line: string;        // hairline borders on paper
  lineOnDark: string;  // hairline borders on ink
  // Brand
  coral: string;       // brand.voice
  coralDark: string;
  coralLight: string;
  coralFaint: string;  // tinted backgrounds
  amber: string;       // brand.ai
  amberDark: string;
  amberFaint: string;
  // States
  done: string;        // success check
  err: string;         // error badge
  errFaint: string;
  // Tokens the legacy screens still read
  primary: string;
  primaryText: string;
  success: string;
  danger: string;
  warnBg: string;
  okBg: string;
  errBg: string;
  text: string;
  subtext: string;
  border: string;
  inputBg: string;
  bar: string;
  barBg: string;
}

const light: ThemeColors = {
  dark: false,
  bg: '#F4F1EA',          // paper
  surface: '#FFFFFF',
  surfaceMuted: '#ECE7DC', // paper-2
  ink: '#1A1714',
  inkSoft: '#3A342D',
  inkMid: '#5C554B',
  inkLow: '#9A9184',
  line: '#D8D1C2',
  lineOnDark: '#383129',
  coral: '#E8552B',
  coralDark: '#C43F1A',
  coralLight: '#F27A54',
  coralFaint: '#FBEAE3',
  amber: '#F2B705',
  amberDark: '#C99400',
  amberFaint: '#FDF3D0',
  done: '#0F8E7E',
  err: '#D64524',
  errFaint: '#FBE7E1',
  primary: '#E8552B',
  primaryText: '#FFFFFF',
  success: '#0F8E7E',
  danger: '#D64524',
  warnBg: '#FDF3D0',
  okBg: '#E6F4EF',
  errBg: '#FBE7E1',
  text: '#1A1714',
  subtext: '#5C554B',
  border: '#D8D1C2',
  inputBg: '#FFFFFF',
  bar: '#E8552B',
  barBg: '#ECE7DC',
};

const dark: ThemeColors = {
  dark: true,
  bg: '#161310',
  surface: '#26221D',
  surfaceMuted: '#1F1B17',
  ink: '#EDE7DC',
  inkSoft: '#D8D1C2',
  inkMid: '#A8A89C',
  inkLow: '#6E665A',
  line: '#383129',
  lineOnDark: '#4A443C',
  coral: '#F27A54',
  coralDark: '#E8552B',
  coralLight: '#F9C4B2',
  coralFaint: '#3A1D14',
  amber: '#F2B705',
  amberDark: '#C99400',
  amberFaint: '#3A2F10',
  done: '#3ED598',
  err: '#FF8A6A',
  errFaint: '#3D1A14',
  primary: '#F27A54',
  primaryText: '#161310',
  success: '#3ED598',
  danger: '#FF8A6A',
  warnBg: '#3A2F10',
  okBg: '#0F3527',
  errBg: '#3D1A14',
  text: '#EDE7DC',
  subtext: '#A8A89C',
  border: '#383129',
  inputBg: '#1F1B17',
  bar: '#F27A54',
  barBg: '#26221D',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 22,
  pill: 9999,
} as const;

export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 18,
  xl: 24,
  xxl: 32,
  display: 44,
} as const;

/**
 * Type system:
 *  - Display: system bold, -2% tracking (replaces EB Garamond everywhere).
 *  - Body:    system regular/semibold (replaces Figtree).
 *  - Mono:    SF Mono on iOS, monospace on Android — for metadata, timers,
 *    config, model names. The "developer texture" of the spec.
 */
export const fonts = {
  display: Platform.select({
    ios: 'System',
    android: 'sans-serif',
    default: 'System',
  }) as string,
  body: Platform.select({
    ios: 'System',
    android: 'sans-serif',
    default: 'System',
  }) as string,
  bodyMedium: Platform.select({
    ios: 'System',
    android: 'sans-serif-medium',
    default: 'System',
  }) as string,
  bodySemiBold: Platform.select({
    ios: 'System',
    android: 'sans-serif-medium',
    default: 'System',
  }) as string,
  bodyBold: Platform.select({
    ios: 'System',
    android: 'sans-serif',
    default: 'sans-serif',
  }) as string,
  bodyExtraBold: Platform.select({
    ios: 'System',
    android: 'sans-serif-black',
    default: 'sans-serif',
  }) as string,
  mono: Platform.select({
    ios: 'Menlo',
    android: 'monospace',
    default: 'monospace',
  }) as string,
} as const;

/**
 * Motion language from the design system:
 *   - micro 120ms: press feedback
 *   - small 200ms: fades, input focus
 *   - medium 320ms: panel slides
 *   - Orb snap: damping 15, stiffness 180
 *   - Grow on record: scale 1 → 1.1, 180ms
 *   - Ring pulse: 1.6s ease-out loop
 *   - Shrink to dot: 220ms after 5000ms idle
 */
export const motion = {
  micro: 120,
  small: 200,
  medium: 320,
  pressScale: 0.97,
  staggerMs: 60,
  fadeMs: 220,
  orbSnap: {damping: 15, stiffness: 180} as const,
  spring: {damping: 22, stiffness: 190} as const,
  gentleSpring: {damping: 26, stiffness: 140} as const,
} as const;

export function useTheme(): ThemeColors {
  return useColorScheme() === 'dark' ? dark : light;
}

export function themeFor(scheme: 'light' | 'dark'): ThemeColors {
  return scheme === 'dark' ? dark : light;
}

/**
 * Resolves a theme for a given mode override. 'system' falls back to the
 * platform colorScheme. Used by App.tsx to apply settings.themeMode.
 */
export function useThemedColors(
  mode: 'system' | 'light' | 'dark',
): ThemeColors {
  const system = useColorScheme();
  const resolved = mode === 'system' ? system : mode;
  return resolved === 'dark' ? dark : light;
}