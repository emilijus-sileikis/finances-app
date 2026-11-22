import type { Language } from '@/i18n/translations';

export function formatEur(amount: number, showDecimals = true): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const abs = Math.abs(safe);
  const formatted = abs.toLocaleString('en-IE', {
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  });
  return `${safe < 0 ? '-' : ''}€${formatted}`;
}

export function getTodayIso(): string {
  const now = new Date();
  return toIsoDate(now);
}

export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isValidIsoDate(input: string): boolean {
  const trimmed = input.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const d = new Date(year, month - 1, day);
  return (
    d.getFullYear() === year &&
    d.getMonth() === month - 1 &&
    d.getDate() === day
  );
}

export function getCurrentMonthKey(): string {
  return getTodayIso().slice(0, 7); // YYYY-MM
}

export function shiftMonthKey(monthKey: string, deltaMonths: number): string {
  const [yStr, mStr] = monthKey.split('-');
  const year = Number(yStr);
  const monthIndex = Number(mStr) - 1;
  const d = new Date(year, monthIndex + deltaMonths, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const LT_MONTHS_LONG = [
  'Sausis',
  'Vasaris',
  'Kovas',
  'Balandis',
  'Gegužė',
  'Birželis',
  'Liepa',
  'Rugpjūtis',
  'Rugsėjis',
  'Spalis',
  'Lapkritis',
  'Gruodis',
];

const LT_MONTHS_SHORT = [
  'Sau',
  'Vas',
  'Kov',
  'Bal',
  'Geg',
  'Bir',
  'Lie',
  'Rgp',
  'Rgs',
  'Spa',
  'Lap',
  'Grd',
];

export function formatMonthLabel(monthKey: string, lang: Language = 'en'): string {
  const [yStr, mStr] = monthKey.split('-');
  const year = Number(yStr);
  const monthIdx = Number(mStr) - 1;
  if (lang === 'lt') {
    const name = LT_MONTHS_LONG[monthIdx] ?? mStr;
    return `${name} ${year}`;
  }
  const d = new Date(year, monthIdx, 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function formatShortMonth(monthKey: string, lang: Language = 'en'): string {
  const [yStr, mStr] = monthKey.split('-');
  const monthIdx = Number(mStr) - 1;
  if (lang === 'lt') {
    return LT_MONTHS_SHORT[monthIdx] ?? mStr;
  }
  const d = new Date(Number(yStr), monthIdx, 1);
  return d.toLocaleDateString('en-US', { month: 'short' });
}

export function formatDisplayDate(isoDate: string, lang: Language = 'en'): string {
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const year = Number(parts[0]);
  const monthIdx = Number(parts[1]) - 1;
  const day = Number(parts[2]);
  if (lang === 'lt') {
    return `${LT_MONTHS_SHORT[monthIdx] ?? parts[1]} ${day}`;
  }
  const d = new Date(year, monthIdx, day);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function getDaysInMonth(monthKey: string): number {
  const [yStr, mStr] = monthKey.split('-');
  return new Date(Number(yStr), Number(mStr), 0).getDate();
}

export function getIsoWeekKey(date: Date): string {
  const copy = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((copy.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${copy.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function getCurrentPeriodKey(
  frequency: 'monthly' | 'weekly' | 'yearly',
  now = new Date()
): string {
  if (frequency === 'weekly') return getIsoWeekKey(now);
  if (frequency === 'yearly') return String(now.getFullYear());
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function normalizeMerchantKey(merchant: string): string {
  return merchant
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

export function parseFlexibleAmount(input: string, allowNegative = false): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const isNegative = trimmed.startsWith('-') || trimmed.startsWith('−');
  if (isNegative && !allowNegative) return null;

  const cleaned = trimmed
    .replace(/^[−-]/, '')
    .replace(/[€$\s]/g, '')
    .replace(/EUR/gi, '')
    .trim();
  if (!cleaned) return null;

  let normalized = cleaned;
  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');

  if (hasComma && hasDot) {
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      normalized = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = cleaned.replace(/,/g, '');
    }
  } else if (hasComma) {
    const afterComma = cleaned.split(',').pop() ?? '';
    if (afterComma.length <= 2) {
      normalized = cleaned.replace(',', '.');
    } else {
      normalized = cleaned.replace(/,/g, '');
    }
  }

  const val = Number(normalized);
  if (!Number.isFinite(val) || val < 0) return null;
  const rounded = Math.round(val * 100) / 100;
  return isNegative ? -rounded : rounded;
}
