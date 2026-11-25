import type { CategoryId, Expense } from '@/types/finance';
import { getTodayIso } from '@/utils/format';

export interface YearMonthPoint {
  monthIndex: number; // 0..11
  monthKey: string; // YYYY-MM
  total: number;
}

export interface YearCategoryRank {
  category: CategoryId;
  total: number;
  count: number;
  share: number;
}

export interface YearMerchantRank {
  merchant: string;
  total: number;
  count: number;
}

export interface YearReviewStats {
  year: number;
  availableYears: number[];
  totalSpent: number;
  prevYearSpent: number;
  yoyChangePct: number | null;
  receiptCount: number;
  activeMonthsCount: number;
  avgMonthlySpend: number;
  avgDailySpend: number;
  totalTaxes: number;
  estimatedAnnualSaved: number | null;
  savingsRatePct: number | null;
  noSpendDaysYear: number;
  monthlyTotals: YearMonthPoint[];
  biggestMonth: YearMonthPoint | null;
  lightestActiveMonth: YearMonthPoint | null;
  biggestExpense: Expense | null;
  topCategories: YearCategoryRank[];
  topMerchants: YearMerchantRank[];
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function getElapsedDaysInYear(year: number, todayIso: string): number {
  const todayYear = Number(todayIso.slice(0, 4));
  if (year < todayYear) return isLeapYear(year) ? 366 : 365;
  if (year > todayYear) return 0;
  const start = Date.UTC(year, 0, 1);
  const [y, m, d] = todayIso.split('-').map(Number);
  const current = Date.UTC(y, m - 1, d);
  return Math.max(1, Math.floor((current - start) / 86_400_000) + 1);
}

function getElapsedMonthsInYear(year: number, todayIso: string): number {
  const todayYear = Number(todayIso.slice(0, 4));
  if (year < todayYear) return 12;
  if (year > todayYear) return 0;
  return Math.max(1, Number(todayIso.slice(5, 7)));
}

export function getAvailableYears(
  expenses: Expense[],
  todayIso: string = getTodayIso()
): number[] {
  const set = new Set<number>([Number(todayIso.slice(0, 4))]);
  for (const exp of expenses) {
    const y = Number(exp.date.slice(0, 4));
    if (Number.isInteger(y) && y >= 2000 && y <= 2100) {
      set.add(y);
    }
  }
  return Array.from(set).sort((a, b) => b - a);
}

export function computeYearReview(
  expenses: Expense[],
  year: number,
  monthlyIncome = 0,
  todayIso: string = getTodayIso()
): YearReviewStats {
  const yearPrefix = `${year}-`;
  const prevPrefix = `${year - 1}-`;
  const availableYears = getAvailableYears(expenses, todayIso);

  const yearExpenses: Expense[] = [];
  let prevYearSpent = 0;

  for (const exp of expenses) {
    if (exp.date.startsWith(yearPrefix)) {
      yearExpenses.push(exp);
    } else if (exp.date.startsWith(prevPrefix)) {
      prevYearSpent += Number(exp.amount);
    }
  }

  prevYearSpent = Math.round(prevYearSpent * 100) / 100;

  const monthBuckets = Array.from({ length: 12 }, (_, idx) => ({
    monthIndex: idx,
    monthKey: `${year}-${String(idx + 1).padStart(2, '0')}`,
    total: 0,
  }));

  const catMap = new Map<CategoryId, { total: number; count: number }>();
  const merchantMap = new Map<string, { display: string; total: number; count: number }>();
  const spendDaysSet = new Set<string>();

  let totalSpent = 0;
  let totalTaxes = 0;
  let biggestExpense: Expense | null = null;

  for (const exp of yearExpenses) {
    const amt = Number(exp.amount);
    totalSpent += amt;
    totalTaxes += exp.category === 'taxes' ? amt : Number(exp.taxAmount || 0);

    if (!biggestExpense || amt > biggestExpense.amount) {
      biggestExpense = exp;
    }

    if (exp.date <= todayIso) {
      spendDaysSet.add(exp.date);
    }

    const mIdx = Number(exp.date.slice(5, 7)) - 1;
    if (mIdx >= 0 && mIdx < 12) {
      monthBuckets[mIdx].total += amt;
    }

    const cPrev = catMap.get(exp.category) ?? { total: 0, count: 0 };
    catMap.set(exp.category, { total: cPrev.total + amt, count: cPrev.count + 1 });

    const rawMerchant = (exp.merchant || exp.title || '').trim();
    if (rawMerchant) {
      const mKey = rawMerchant.toLowerCase();
      const mPrev = merchantMap.get(mKey) ?? { display: rawMerchant, total: 0, count: 0 };
      merchantMap.set(mKey, {
        display: mPrev.display,
        total: mPrev.total + amt,
        count: mPrev.count + 1,
      });
    }
  }

  totalSpent = Math.round(totalSpent * 100) / 100;
  totalTaxes = Math.round(totalTaxes * 100) / 100;

  const monthlyTotals: YearMonthPoint[] = monthBuckets.map((b) => ({
    ...b,
    total: Math.round(b.total * 100) / 100,
  }));

  const activeMonths = monthlyTotals.filter((m) => m.total > 0);
  const activeMonthsCount = activeMonths.length;

  let biggestMonth: YearMonthPoint | null = null;
  let lightestActiveMonth: YearMonthPoint | null = null;
  for (const m of activeMonths) {
    if (!biggestMonth || m.total > biggestMonth.total) biggestMonth = m;
    if (!lightestActiveMonth || m.total < lightestActiveMonth.total) {
      lightestActiveMonth = m;
    }
  }

  const elapsedDays = getElapsedDaysInYear(year, todayIso);
  const elapsedMonths = getElapsedMonthsInYear(year, todayIso);
  const noSpendDaysYear = Math.max(0, elapsedDays - spendDaysSet.size);

  const avgMonthlySpend =
    activeMonthsCount > 0
      ? Math.round((totalSpent / activeMonthsCount) * 100) / 100
      : 0;
  const avgDailySpend =
    elapsedDays > 0 ? Math.round((totalSpent / elapsedDays) * 100) / 100 : 0;

  const yoyChangePct =
    prevYearSpent > 0
      ? Math.round(((totalSpent - prevYearSpent) / prevYearSpent) * 100)
      : null;

  const annualIncomeSoFar = monthlyIncome > 0 ? monthlyIncome * elapsedMonths : 0;
  const estimatedAnnualSaved =
    annualIncomeSoFar > 0
      ? Math.round((annualIncomeSoFar - totalSpent) * 100) / 100
      : null;
  const savingsRatePct =
    annualIncomeSoFar > 0 && estimatedAnnualSaved !== null
      ? Math.round((estimatedAnnualSaved / annualIncomeSoFar) * 100)
      : null;

  const topCategories: YearCategoryRank[] = Array.from(catMap.entries())
    .map(([category, v]) => ({
      category,
      total: Math.round(v.total * 100) / 100,
      count: v.count,
      share: totalSpent > 0 ? v.total / totalSpent : 0,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  const topMerchants: YearMerchantRank[] = Array.from(merchantMap.values())
    .map((m) => ({
      merchant: m.display,
      total: Math.round(m.total * 100) / 100,
      count: m.count,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  return {
    year,
    availableYears,
    totalSpent,
    prevYearSpent,
    yoyChangePct,
    receiptCount: yearExpenses.length,
    activeMonthsCount,
    avgMonthlySpend,
    avgDailySpend,
    totalTaxes,
    estimatedAnnualSaved,
    savingsRatePct,
    noSpendDaysYear,
    monthlyTotals,
    biggestMonth,
    lightestActiveMonth,
    biggestExpense,
    topCategories,
    topMerchants,
  };
}
