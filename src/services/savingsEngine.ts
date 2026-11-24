import { CATEGORIES, getCategoryMeta } from '@/constants/categories';
import {
  formatCurrency,
  getCurrencyMeta,
  type CurrencyCode,
} from '@/constants/currencies';
import { getCategoryLabel, type Language } from '@/i18n/translations';
import type {
  CategoryBudget,
  CategoryId,
  CategoryMeta,
  Expense,
  RecurringExpense,
  SavingsTip,
} from '@/types/finance';
import {
  getCurrentMonthKey,
  getDaysInMonth,
  shiftMonthKey,
} from '@/utils/format';

export interface CategoryTotal {
  category: CategoryId;
  total: number;
  count: number;
  share: number;
  budget: number | null;
}

export function getMonthExpenses(expenses: Expense[], monthKey: string): Expense[] {
  return expenses.filter((e) => e.date.startsWith(monthKey));
}

export function computeCategoryTotals(
  monthExpenses: Expense[],
  budgets: CategoryBudget[]
): CategoryTotal[] {
  const budgetMap = new Map<CategoryId, number>();
  for (const b of budgets) {
    budgetMap.set(b.category, b.monthlyLimit);
  }

  const grandTotal = monthExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const grouped = new Map<CategoryId, { total: number; count: number }>();

  for (const exp of monthExpenses) {
    const prev = grouped.get(exp.category) ?? { total: 0, count: 0 };
    grouped.set(exp.category, {
      total: prev.total + Number(exp.amount),
      count: prev.count + 1,
    });
  }

  return Array.from(grouped.entries())
    .map(([category, data]) => ({
      category,
      total: Math.round(data.total * 100) / 100,
      count: data.count,
      share: grandTotal > 0 ? data.total / grandTotal : 0,
      budget: budgetMap.get(category) ?? null,
    }))
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      if (b.count !== a.count) return b.count - a.count;
      return a.category.localeCompare(b.category);
    });
}

export function computeMonthlyTrend(
  expenses: Expense[],
  anchorMonth: string,
  monthsCount = 6
): { monthKey: string; total: number }[] {
  const result: { monthKey: string; total: number }[] = [];
  for (let i = monthsCount - 1; i >= 0; i--) {
    const mk = shiftMonthKey(anchorMonth, -i);
    const total = expenses
      .filter((e) => e.date.startsWith(mk))
      .reduce((sum, e) => sum + Number(e.amount), 0);
    result.push({ monthKey: mk, total: Math.round(total * 100) / 100 });
  }
  return result;
}

export function computeDiscretionaryTotal(
  monthExpenses: Expense[],
  customCategories: CategoryMeta[] = []
): number {
  return monthExpenses.reduce((sum, e) => {
    const meta = getCategoryMeta(e.category, customCategories);
    return meta.isDiscretionary ? sum + Number(e.amount) : sum;
  }, 0);
}

export function generateSavingsTips(
  allExpenses: Expense[],
  budgets: CategoryBudget[],
  recurring: RecurringExpense[],
  monthKey: string,
  lang: Language = 'en',
  currency: CurrencyCode = 'EUR',
  customCategories: CategoryMeta[] = []
): SavingsTip[] {
  const isLt = lang === 'lt';
  const curMeta = getCurrencyMeta(currency);
  const scale = curMeta.eurRateApprox;
  const fmt = (val: number, decimals?: boolean) => formatCurrency(val, currency, decimals);

  const tips: SavingsTip[] = [];
  const monthExpenses = getMonthExpenses(allExpenses, monthKey);
  const prevMonthKey = shiftMonthKey(monthKey, -1);
  const prevMonthExpenses = getMonthExpenses(allExpenses, prevMonthKey);

  const totalSpent = monthExpenses.reduce((s, e) => s + Number(e.amount), 0);
  if (totalSpent === 0) {
    return [
      {
        id: 'empty',
        severity: 'good',
        title: isLt
          ? 'Pridėkite čekių, kad gautumėte asmeninius patarimus'
          : 'Add receipts to unlock personalized savings tips',
        body: isLt
          ? 'Nuskenuokite arba įkelkite kelis čekius bei nusistatykite mėnesio biudžetus. Taupymo patarėjas automatiškai parodys kur galima sutaupyti.'
          : 'Scan or upload a few receipts and set monthly category budgets. Your local savings coach will automatically spot overspending, spikes, and easy wins.',
      },
    ];
  }

  const catTotals = computeCategoryTotals(monthExpenses, budgets);
  const prevCatMap = new Map<CategoryId, number>();
  for (const e of prevMonthExpenses) {
    prevCatMap.set(e.category, (prevCatMap.get(e.category) ?? 0) + Number(e.amount));
  }

  const isCurrentMonth = monthKey === getCurrentMonthKey();
  const daysInMonth = getDaysInMonth(monthKey);
  const dayOfMonth = isCurrentMonth ? Math.max(1, new Date().getDate()) : daysInMonth;
  const monthProgress = dayOfMonth / daysInMonth;

  // 1. Over-budget & Pace warnings
  for (const item of catTotals) {
    if (!item.budget || item.budget <= 0) continue;
    const label = getCategoryLabel(item.category, lang, customCategories);

    if (item.total > item.budget) {
      const over = item.total - item.budget;
      tips.push({
        id: `over-${item.category}`,
        severity: 'high',
        category: item.category,
        title: isLt
          ? `„${label}“ viršijo biudžetą ${fmt(over)}`
          : `${label} is ${fmt(over)} over budget`,
        body: isLt
          ? `Išleidote ${fmt(item.total)} (limitas ${fmt(item.budget)}). Sustabdžius nebūtinas šios kategorijos išlaidas likusį mėnesį, išvengsite ${fmt(over * 12, false)}/metus pertekliaus.`
          : `You spent ${fmt(item.total)} against your ${fmt(item.budget)} limit. Pausing non-essential ${label.toLowerCase()} purchases for the rest of the month prevents a ${fmt(over * 12, false)}/year leak.`,
        potentialMonthlySavings: over,
      });
    } else if (isCurrentMonth && monthProgress >= 0.25 && monthProgress < 0.92) {
      const projected = item.total / monthProgress;
      if (projected > item.budget * 1.15 && projected - item.budget >= 15 * scale) {
        const projectedOver = projected - item.budget;
        const remaining = Math.max(0, item.budget - item.total);
        const daysLeft = Math.max(1, daysInMonth - dayOfMonth);
        tips.push({
          id: `pace-${item.category}`,
          severity: 'medium',
          category: item.category,
          title: isLt
            ? `„${label}“ artėja prie biudžeto viršijimo`
            : `${label} is pacing over budget`,
          body: isLt
            ? `Šiuo tempu mėnesio pabaigoje išleisite ~${fmt(projected, false)}. Likusias ${daysLeft} d. neišleiskite daugiau nei ${fmt(remaining / daysLeft)}/d., kad tilptumėte į limitą.`
            : `At this rate you'll hit ~${fmt(projected, false)} this month. Keep ${label.toLowerCase()} under ${fmt(remaining / daysLeft)}/day for the remaining ${daysLeft} days to stay on target.`,
          potentialMonthlySavings: projectedOver,
        });
      }
    }
  }

  // 2. Month-over-Month category spikes
  for (const item of catTotals) {
    if (item.category === 'mortgage' || item.category === 'taxes') continue;
    const prev = prevCatMap.get(item.category) ?? 0;
    if (prev >= 20 * scale && item.total > prev * 1.3 && item.total - prev >= 20 * scale) {
      const diff = item.total - prev;
      const pct = Math.round(((item.total - prev) / prev) * 100);
      const label = getCategoryLabel(item.category, lang, customCategories);
      tips.push({
        id: `spike-${item.category}`,
        severity: 'medium',
        category: item.category,
        title: isLt
          ? `„${label}“ išaugo +${pct}% palyginti su praeitu mėn.`
          : `${label} jumped +${pct}% vs last month`,
        body: isLt
          ? `Išleidote ${fmt(diff)} daugiau nei praeitą mėnesį (${fmt(prev)}). Grįžus prie praeito mėnesio lygio sutaupytumėte ${fmt(diff)}/mėn. (${fmt(diff * 12, false)}/metus).`
          : `Up ${fmt(diff)} from ${fmt(prev)} last month. Returning to last month's level saves ${fmt(diff)}/mo (${fmt(diff * 12, false)}/yr).`,
        potentialMonthlySavings: diff,
      });
    }
  }

  // 3. Discretionary share analysis
  const discretionaryTotal = computeDiscretionaryTotal(monthExpenses, customCategories);
  const discretionaryShare = discretionaryTotal / totalSpent;
  if (discretionaryTotal >= 60 * scale && discretionaryShare >= 0.22) {
    const trim20 = discretionaryTotal * 0.2;
    const topDisc = catTotals
      .filter((c) => getCategoryMeta(c.category, customCategories).isDiscretionary)
      .slice(0, 2)
      .map((c) => getCategoryLabel(c.category, lang, customCategories))
      .join(' & ');
    tips.push({
      id: 'discretionary-share',
      severity: discretionaryShare >= 0.35 ? 'high' : 'medium',
      title: isLt
        ? `Nebūtinos išlaidos sudaro ${Math.round(discretionaryShare * 100)}% visų išlaidų`
        : `Discretionary spending is ${Math.round(discretionaryShare * 100)}% of your total`,
      body: isLt
        ? `Pramogoms ir norams (${topDisc || 'laisvalaikiui'}) išleidote ${fmt(discretionaryTotal)}. Sumažinus jas 20%, sutaupysite ${fmt(trim20)}/mėn. — net ${fmt(trim20 * 12, false)} per metus.`
        : `You spent ${fmt(discretionaryTotal)} on wants (led by ${topDisc || 'leisure'}). Trimming these by 20% saves ${fmt(trim20)}/mo — that's ${fmt(trim20 * 12, false)} extra in a year.`,
      potentialMonthlySavings: trim20,
    });
  }

  // 4. Small impulse purchases
  const smallCap = Math.round(18 * scale);
  const smallDiscretionary = monthExpenses.filter(
    (e) => e.amount <= smallCap && getCategoryMeta(e.category, customCategories).isDiscretionary
  );
  const smallSum = smallDiscretionary.reduce((s, e) => s + Number(e.amount), 0);
  if (smallDiscretionary.length >= 4 && smallSum >= 35 * scale) {
    const half = smallSum * 0.5;
    tips.push({
      id: 'small-leaks',
      severity: 'medium',
      title: isLt
        ? `${smallDiscretionary.length} smulkūs pirkiniai susidėjo į ${fmt(smallSum)}`
        : `${smallDiscretionary.length} small impulse purchases added up to ${fmt(smallSum)}`,
      body: isLt
        ? `Pirkiniai iki ${fmt(smallCap, false)} atrodo menki, bet atsisakius bent pusės jų sutaupysite ${fmt(half)}/mėn. (${fmt(half * 12, false)}/metus).`
        : `Purchases under ${fmt(smallCap, false)} feel tiny individually, yet cutting just half of them puts ${fmt(half)}/mo (${fmt(half * 12, false)}/yr) straight into savings.`,
      potentialMonthlySavings: half,
    });
  }

  // 5. Optional recurring bills audit
  const optionalRecurring = recurring.filter(
    (r) => r.active && getCategoryMeta(r.category, customCategories).isDiscretionary
  );
  const optionalRecurringMonthly = optionalRecurring.reduce((sum, r) => {
    if (r.frequency === 'weekly') return sum + r.amount * 4.33;
    if (r.frequency === 'yearly') return sum + r.amount / 12;
    return sum + r.amount;
  }, 0);
  if (optionalRecurringMonthly >= 15 * scale) {
    tips.push({
      id: 'recurring-audit',
      severity: 'medium',
      title: isLt
        ? `Peržiūrėkite ${optionalRecurring.length} pasikartojančias prenumeratas`
        : `Review ${optionalRecurring.length} discretionary recurring bill${optionalRecurring.length > 1 ? 's' : ''}`,
      body: isLt
        ? `Nebūtinos prenumeratos kainuoja ~${fmt(optionalRecurringMonthly)}/mėn. (${fmt(optionalRecurringMonthly * 12, false)}/metus). Atsisakius bent vienos nenaudojamos paslaugos, sutaupysite be pastangų.`
        : `Your optional subscriptions/recurring items cost ~${fmt(optionalRecurringMonthly)}/mo (${fmt(optionalRecurringMonthly * 12, false)}/yr). Pausing even one unused service yields effortless monthly savings.`,
      potentialMonthlySavings: optionalRecurringMonthly * 0.35,
    });
  }

  // 6. Missing budget suggestion
  const unbudgetedTop = catTotals.find(
    (c) => c.budget === null && c.total >= 50 * scale && c.category !== 'other'
  );
  if (unbudgetedTop) {
    const label = getCategoryLabel(unbudgetedTop.category, lang, customCategories);
    const step = curMeta.decimals === 0 ? Math.max(1000, Math.round(10 * scale)) : 10;
    const suggestedCap = Math.ceil((unbudgetedTop.total * 0.9) / step) * step;
    tips.push({
      id: `set-budget-${unbudgetedTop.category}`,
      severity: 'good',
      category: unbudgetedTop.category,
      title: isLt
        ? `Nustatykite ${fmt(suggestedCap, false)} limitą kategorijai „${label}“`
        : `Set a ${fmt(suggestedCap, false)} cap on ${label}`,
      body: isLt
        ? `„${label}“ yra viena didžiausių jūsų išlaidų (${fmt(unbudgetedTop.total)}) be mėnesio biudžeto. Nustačius ribą lengviau pastebėti perteklinį išlaidavimą.`
        : `${label} is one of your top categories (${fmt(unbudgetedTop.total)}) without a monthly budget. Adding a target limit helps trigger early alerts before overspending.`,
    });
  }

  // 7. Positive reinforcement
  const hasHighOrMed = tips.some((t) => t.severity === 'high' || t.severity === 'medium');
  if (!hasHighOrMed) {
    tips.push({
      id: 'great-job',
      severity: 'good',
      title: isLt ? 'Išlaidos puikiai kontroliuojamos!' : 'Spending looks well controlled!',
      body: isLt
        ? `Šį mėnesį tilpote į limitus (${fmt(totalSpent)}). Pabandykite 10% (${fmt(totalSpent * 0.1)}) atidėti į taupymo tikslą.`
        : `You're staying within your limits at ${fmt(totalSpent)} this month. Consider setting aside 10% (${fmt(totalSpent * 0.1)}) into a dedicated savings goal.`,
    });
  }

  const order = { high: 0, medium: 1, good: 2 };
  return tips.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function getDiscretionaryCategories(
  customCategories: CategoryMeta[] = []
): CategoryId[] {
  return [...CATEGORIES, ...customCategories]
    .filter((c) => c.isDiscretionary)
    .map((c) => c.id);
}
