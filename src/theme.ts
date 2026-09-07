import {Platform, useColorScheme} from 'react-native';

/**
 * Calm Flow — Wispr Flow-inspired token system for OpenType.
 *
 * Light = warm paper (Lumen Cream) + ink text + lavender CTA.
 * Dark  = ink chamber + cream text. Shadowless, border-driven.
 *
 * Custom fonts (EB Garamond / Figtree TTFs) can be dropped into
 * assets/fonts/ later — fontFamily constants below will pick them up
 * automatically. Until then they fall back to platform serif/sans,
 * which already gives the editorial feel.
 */

export interface ThemeColors {
  dark: boolean;
  bg: string;
  card: string;
  cardElevated: string;
  text: string;
  subtext: string;
  border: string;
  inputBg: string;
  primary: string;
  primaryText: string;
  danger: string;
  success: string;
  warnBg: string;
  okBg: string;
  errBg: string;
  bar: string;
  barBg: string;
  // Calm Flow extensions
  cream: string;
  ink: string;
  lavender: string;
  lavenderInk: string;
  forest: string;
  forestInk: string;
  ember: string;
  stone: string;
  fog: string;
  overlay: string;
}

const light: ThemeColors = {
  dark: false,
  bg: '#FFFFEB',
  card: '#FFFDF4',
  cardElevated: '#FFFFFF',
  text: '#1A1A1A',
  subtext: '#6E6E60',
  border: '#1A1A1A',
  inputBg: '#FFFFFF',
  primary: '#F0D7FF',
  primaryText: '#1A1A1A',
  danger: '#C93A3A',
  success: '#034F46',
  warnBg: '#FFF3D1',
  okBg: '#DFF2E5',
  errBg: '#FBE0E0',
  bar: '#034F46',
  barBg: '#E4E4D0',
  cream: '#FFFFEB',
  ink: '#1A1A1A',
  lavender: '#F0D7FF',
  lavenderInk: '#1A1A1A',
  forest: '#034F46',
  forestInk: '#FFFFEB',
  ember: '#FFA946',
  stone: '#E4E4D0',
  fog: '#8A8A80',
  overlay: 'rgba(26, 26, 26, 0.45)',
};

const dark: ThemeColors = {
  dark: true,
  bg: '#1A1A1A',
  card: '#222222',
  cardElevated: '#2A2A28',
  text: '#FFFFEB',
  subtext: '#A8A89C',
  border: '#3D3D34',
  inputBg: '#141412',
  primary: '#F0D7FF',
  primaryText: '#1A1A1A',
  danger: '#FF8A8A',
  success: '#3ED598',
  warnBg: '#3A2F10',
  okBg: '#0F3527',
  errBg: '#3D1A1A',
  bar: '#7FD8C4',
  barBg: '#33332E',
  cream: '#FFFFEB',
  ink: '#1A1A1A',
  lavender: '#F0D7FF',
  lavenderInk: '#1A1A1A',
  forest: '#7FD8C4',
  forestInk: '#1A1A1A',
  ember: '#FFA946',
  stone: '#33332E',
  fog: '#8A8A80',
  overlay: 'rgba(0, 0, 0, 0.6)',
};

export const spacing = {xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32} as const;
/** Border-driven radii: generous cards, pill badges, 12px controls. */
export const radius = {sm: 12, md: 20, lg: 28, xl: 36, pill: 9999} as const;
export const fontSize = {
  xs: 12,
  sm: 13,
  md: 16,
  lg: 20,
  xl: 26,
  xxl: 34,
  display: 44,
} as const;

/**
 * Display = editorial serif (EB Garamond when bundled, else platform serif).
 * Body = geometric sans (Figtree when bundled, else system).
 */
export const fonts = {
  display: Platform.select({
    ios: 'Georgia',
    android: 'serif',
    default: 'serif',
  }) as string,
  body: Platform.select({
    ios: 'System',
    android: 'sans-serif',
    default: 'System',
  }) as string,
  mono: Platform.select({
    ios: 'Menlo',
    android: 'monospace',
    default: 'monospace',
  }) as string,
  /** Use these names when you drop TTFs into assets/fonts/. */
  customDisplay: 'EBGaramond',
  customBody: 'Figtree',
} as const;

/** Shared motion language: calm springs, short fades, staggered reveals. */
export const motion = {
  staggerMs: 70,
  fadeMs: 260,
  spring: {damping: 22, stiffness: 190} as const,
  gentleSpring: {damping: 26, stiffness: 140} as const,
} as const;

/** Theme for the current system scheme. No hardcoded colors in screens. */
export function useTheme(): ThemeColors {
  return useColorScheme() === 'dark' ? dark : light;
}

export function themeFor(scheme: 'light' | 'dark'): ThemeColors {
  return scheme === 'dark' ? dark : light;
}
