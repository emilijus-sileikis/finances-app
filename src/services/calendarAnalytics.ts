import { getCurrencyMeta, type CurrencyCode } from '@/constants/currencies';
import type { Expense } from '@/types/finance';
import { getDaysInMonth, getTodayIso } from '@/utils/format';

export interface DaySpendSummary {
  isoDate: string;
  day: number;
  total: number;
  count: number;
  /** 0 = no spend, 1 = low, 2 = medium, 3 = high */
  level: 0 | 1 | 2 | 3;
  isFuture: boolean;
  isToday: boolean;
}

export interface MonthCalendarStats {
  monthKey: string;
  daysInMonth: number;
  /** Number of blank cells before day 1 in a Monday-first grid (0=Mon .. 6=Sun) */
  leadingBlanks: number;
  days: DaySpendSummary[];
  noSpendDaysCount: number;
  spendDaysCount: number;
  currentNoSpendStreak: number;
  longestNoSpendStreak: number;
  maxDailySpend: number;
  busiestDay: DaySpendSummary | null;
  avgSpendDay: number;
}

/**
 * Computes daily spending heatmap cells and no-spend streaks for a YYYY-MM month.
 * Uses a Monday-first calendar layout and respects today's date so future days
 * are never counted as "no-spend" days.
 */
export function computeMonthCalendar(
  expenses: Expense[],
  monthKey: string,
  currency: CurrencyCode = 'EUR',
  todayIso: string = getTodayIso()
): MonthCalendarStats {
  const [yearStr, monthStr] = monthKey.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const daysInMonth = getDaysInMonth(monthKey);

  // JS getDay(): 0=Sun, 1=Mon ... 6=Sat -> convert to Monday-first 0..6
  const firstDowJs = new Date(year, month - 1, 1).getDay();
  const leadingBlanks = (firstDowJs + 6) % 7;

  const dayTotals = new Map<string, { total: number; count: number }>();
  for (const exp of expenses) {
    if (!exp.date.startsWith(monthKey)) continue;
    const prev = dayTotals.get(exp.date) ?? { total: 0, count: 0 };
    dayTotals.set(exp.date, {
      total: prev.total + Number(exp.amount),
      count: prev.count + 1,
    });
  }

  let maxDailySpend = 0;
  for (const v of dayTotals.values()) {
    if (v.total > maxDailySpend) maxDailySpend = v.total;
  }

  const scale = getCurrencyMeta(currency).eurRateApprox;
  const lowAnchor = Math.max(15 * scale, maxDailySpend * 0.33);
  const medAnchor = Math.max(45 * scale, maxDailySpend * 0.68);

  const days: DaySpendSummary[] = [];
  let noSpendDaysCount = 0;
  let spendDaysCount = 0;
  let spendDaysSum = 0;
  let busiestDay: DaySpendSummary | null = null;

  for (let d = 1; d <= daysInMonth; d++) {
    const isoDate = `${monthKey}-${String(d).padStart(2, '0')}`;
    const isToday = isoDate === todayIso;
    const isFuture = isoDate > todayIso;
    const entry = dayTotals.get(isoDate);
    const total = entry ? Math.round(entry.total * 100) / 100 : 0;
    const count = entry?.count ?? 0;

    let level: 0 | 1 | 2 | 3 = 0;
    if (total > 0) {
      if (total <= lowAnchor) level = 1;
      else if (total <= medAnchor) level = 2;
      else level = 3;
    }

    const summary: DaySpendSummary = {
      isoDate,
      day: d,
      total,
      count,
      level,
      isFuture,
      isToday,
    };
    days.push(summary);

    if (total > 0) {
      spendDaysCount += 1;
      spendDaysSum += total;
      if (!busiestDay || total > busiestDay.total) {
        busiestDay = summary;
      }
    } else if (!isFuture) {
      noSpendDaysCount += 1;
    }
  }

  // Compute longest and current no-spend streaks across elapsed days in this month
  let longestNoSpendStreak = 0;
  let running = 0;
  let lastElapsedIdx = -1;

  for (let i = 0; i < days.length; i++) {
    const cell = days[i];
    if (cell.isFuture) continue;
    lastElapsedIdx = i;
    if (cell.total === 0) {
      running += 1;
      if (running > longestNoSpendStreak) longestNoSpendStreak = running;
    } else {
      running = 0;
    }
  }

  let currentNoSpendStreak = 0;
  for (let i = lastElapsedIdx; i >= 0; i--) {
    if (days[i].total === 0) {
      currentNoSpendStreak += 1;
    } else {
      break;
    }
  }

  return {
    monthKey,
    daysInMonth,
    leadingBlanks,
    days,
    noSpendDaysCount,
    spendDaysCount,
    currentNoSpendStreak,
    longestNoSpendStreak,
    maxDailySpend: Math.round(maxDailySpend * 100) / 100,
    busiestDay,
    avgSpendDay:
      spendDaysCount > 0 ? Math.round((spendDaysSum / spendDaysCount) * 100) / 100 : 0,
  };
}
