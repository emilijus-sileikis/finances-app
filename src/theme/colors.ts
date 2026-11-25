export type ThemeMode = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

export interface ThemeColors {
  bg: string;
  surface: string;
  surfaceElevated: string;
  surfaceMuted: string;
  border: string;
  borderLight: string;

  text: string;
  textSecondary: string;
  textMuted: string;

  primary: string;
  primaryDark: string;
  primarySoft: string;

  accent: string;
  accentSoft: string;

  warning: string;
  warningSoft: string;

  danger: string;
  dangerSoft: string;

  purple: string;
  purpleSoft: string;

  white: string;
  black: string;
}

export const DARK_COLORS: ThemeColors = {
  bg: '#090E1A',
  surface: '#111827',
  surfaceElevated: '#1A2438',
  surfaceMuted: '#0F172A',
  border: '#1F2D45',
  borderLight: '#2A3B58',

  text: '#F8FAFC',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',

  primary: '#10B981', // Emerald
  primaryDark: '#059669',
  primarySoft: 'rgba(16, 185, 129, 0.14)',

  accent: '#38BDF8', // Sky
  accentSoft: 'rgba(56, 189, 248, 0.14)',

  warning: '#F59E0B',
  warningSoft: 'rgba(245, 158, 11, 0.14)',

  danger: '#F43F5E',
  dangerSoft: 'rgba(244, 63, 94, 0.14)',

  purple: '#A78BFA',
  purpleSoft: 'rgba(167, 139, 250, 0.14)',

  white: '#FFFFFF',
  black: '#000000',
};

export const LIGHT_COLORS: ThemeColors = {
  bg: '#F1F5F9',
  surface: '#FFFFFF',
  surfaceElevated: '#F8FAFC',
  surfaceMuted: '#E2E8F0',
  border: '#E2E8F0',
  borderLight: '#CBD5E1',

  text: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#64748B',

  primary: '#059669',
  primaryDark: '#047857',
  primarySoft: 'rgba(5, 150, 105, 0.12)',

  accent: '#0284C7',
  accentSoft: 'rgba(2, 132, 199, 0.12)',

  warning: '#D97706',
  warningSoft: 'rgba(217, 119, 6, 0.12)',

  danger: '#E11D48',
  dangerSoft: 'rgba(225, 29, 72, 0.11)',

  purple: '#7C3AED',
  purpleSoft: 'rgba(124, 58, 237, 0.12)',

  white: '#FFFFFF',
  black: '#000000',
};

export function isThemeMode(val: string | null | undefined): val is ThemeMode {
  return val === 'dark' || val === 'light' || val === 'system';
}

export function resolveThemeMode(
  mode: ThemeMode,
  systemScheme: string | null | undefined
): ResolvedTheme {
  if (mode === 'light') return 'light';
  if (mode === 'dark') return 'dark';
  return systemScheme === 'light' ? 'light' : 'dark';
}

export function getThemeColors(resolved: ResolvedTheme): ThemeColors {
  return resolved === 'light' ? LIGHT_COLORS : DARK_COLORS;
}

/** Default dark palette fallback */
export const Colors = DARK_COLORS;
