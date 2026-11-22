import { CATEGORIES, getCategoryMeta } from '@/constants/categories';
import { getCategoryLabel, type Language } from '@/i18n/translations';
import type {
  CategoryBudget,
  CategoryId,
  Expense,
  RecurringExpense,
  SavingsTip,
} from '@/types/finance';
import {
  formatEur,
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

export function computeDiscretionaryTotal(monthExpenses: Expense[]): number {
  return monthExpenses.reduce((sum, e) => {
    const meta = getCategoryMeta(e.category);
    return meta.isDiscretionary ? sum + Number(e.amount) : sum;
  }, 0);
}

export function generateSavingsTips(
  allExpenses: Expense[],
  budgets: CategoryBudget[],
  recurring: RecurringExpense[],
  monthKey: string,
  lang: Language = 'en'
): SavingsTip[] {
  const isLt = lang === 'lt';
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
    const label = getCategoryLabel(item.category, lang);

    if (item.total > item.budget) {
      const over = item.total - item.budget;
      tips.push({
        id: `over-${item.category}`,
        severity: 'high',
        category: item.category,
        title: isLt
          ? `„${label}“ viršijo biudžetą ${formatEur(over)}`
          : `${label} is ${formatEur(over)} over budget`,
        body: isLt
          ? `Išleidote ${formatEur(item.total)} (limitas ${formatEur(item.budget)}). Sustabdžius nebūtinas šios kategorijos išlaidas likusį mėnesį, išvengsite ${formatEur(over * 12)}/metus pertekliaus.`
          : `You spent ${formatEur(item.total)} against your ${formatEur(item.budget)} limit. Pausing non-essential ${label.toLowerCase()} purchases for the rest of the month prevents a ${formatEur(over * 12)}/year leak.`,
        potentialMonthlySavings: over,
      });
    } else if (isCurrentMonth && monthProgress >= 0.25 && monthProgress < 0.92) {
      const projected = item.total / monthProgress;
      if (projected > item.budget * 1.15 && projected - item.budget >= 15) {
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
            ? `Šiuo tempu mėnesio pabaigoje išleisite ~${formatEur(projected)}. Likusias ${daysLeft} d. neišleiskite daugiau nei ${formatEur(remaining / daysLeft)}/d., kad tilptumėte į limitą.`
            : `At this rate you'll hit ~${formatEur(projected)} this month. Keep ${label.toLowerCase()} under ${formatEur(remaining / daysLeft)}/day for the remaining ${daysLeft} days to stay on target.`,
          potentialMonthlySavings: projectedOver,
        });
      }
    }
  }

  // 2. Month-over-Month category spikes
  for (const item of catTotals) {
    if (item.category === 'mortgage' || item.category === 'taxes') continue;
    const prev = prevCatMap.get(item.category) ?? 0;
    if (prev >= 20 && item.total > prev * 1.3 && item.total - prev >= 20) {
      const diff = item.total - prev;
      const pct = Math.round(((item.total - prev) / prev) * 100);
      const label = getCategoryLabel(item.category, lang);
      tips.push({
        id: `spike-${item.category}`,
        severity: 'medium',
        category: item.category,
        title: isLt
          ? `„${label}“ išaugo +${pct}% palyginti su praeitu mėn.`
          : `${label} jumped +${pct}% vs last month`,
        body: isLt
          ? `Išleidote ${formatEur(diff)} daugiau nei praeitą mėnesį (${formatEur(prev)}). Grįžus prie praeito mėnesio lygio sutaupytumėte ${formatEur(diff)}/mėn. (${formatEur(diff * 12)}/metus).`
          : `Up ${formatEur(diff)} from ${formatEur(prev)} last month. Returning to last month's level saves ${formatEur(diff)}/mo (${formatEur(diff * 12)}/yr).`,
        potentialMonthlySavings: diff,
      });
    }
  }

  // 3. Discretionary share analysis
  const discretionaryTotal = computeDiscretionaryTotal(monthExpenses);
  const discretionaryShare = discretionaryTotal / totalSpent;
  if (discretionaryTotal >= 60 && discretionaryShare >= 0.22) {
    const trim20 = discretionaryTotal * 0.2;
    const topDisc = catTotals
      .filter((c) => getCategoryMeta(c.category).isDiscretionary)
      .slice(0, 2)
      .map((c) => getCategoryLabel(c.category, lang))
      .join(' & ');
    tips.push({
      id: 'discretionary-share',
      severity: discretionaryShare >= 0.35 ? 'high' : 'medium',
      title: isLt
        ? `Nebūtinos išlaidos sudaro ${Math.round(discretionaryShare * 100)}% visų išlaidų`
        : `Discretionary spending is ${Math.round(discretionaryShare * 100)}% of your total`,
      body: isLt
        ? `Pramogoms ir norams (${topDisc || 'laisvalaikiui'}) išleidote ${formatEur(discretionaryTotal)}. Sumažinus jas 20%, sutaupysite ${formatEur(trim20)}/mėn. — net ${formatEur(trim20 * 12)} per metus.`
        : `You spent ${formatEur(discretionaryTotal)} on wants (led by ${topDisc || 'leisure'}). Trimming these by 20% saves ${formatEur(trim20)}/mo — that's ${formatEur(trim20 * 12)} extra in a year.`,
      potentialMonthlySavings: trim20,
    });
  }

  // 4. Small impulse purchases
  const smallDiscretionary = monthExpenses.filter(
    (e) => e.amount <= 18 && getCategoryMeta(e.category).isDiscretionary
  );
  const smallSum = smallDiscretionary.reduce((s, e) => s + Number(e.amount), 0);
  if (smallDiscretionary.length >= 4 && smallSum >= 35) {
    const half = smallSum * 0.5;
    tips.push({
      id: 'small-leaks',
      severity: 'medium',
      title: isLt
        ? `${smallDiscretionary.length} smulkūs pirkiniai susidėjo į ${formatEur(smallSum)}`
        : `${smallDiscretionary.length} small impulse purchases added up to ${formatEur(smallSum)}`,
      body: isLt
        ? `Pirkiniai iki €18 atrodo menki, bet atsisakius bent pusės jų sutaupysite ${formatEur(half)}/mėn. (${formatEur(half * 12)}/metus).`
        : `Purchases under €18 feel tiny individually, yet cutting just half of them puts ${formatEur(half)}/mo (${formatEur(half * 12)}/yr) straight into savings.`,
      potentialMonthlySavings: half,
    });
  }

  // 5. Optional recurring bills audit
  const optionalRecurring = recurring.filter(
    (r) => r.active && getCategoryMeta(r.category).isDiscretionary
  );
  const optionalRecurringMonthly = optionalRecurring.reduce((sum, r) => {
    if (r.frequency === 'weekly') return sum + r.amount * 4.33;
    if (r.frequency === 'yearly') return sum + r.amount / 12;
    return sum + r.amount;
  }, 0);
  if (optionalRecurringMonthly >= 15) {
    tips.push({
      id: 'recurring-audit',
      severity: 'medium',
      title: isLt
        ? `Peržiūrėkite ${optionalRecurring.length} pasikartojančias prenumeratas`
        : `Review ${optionalRecurring.length} discretionary recurring bill${optionalRecurring.length > 1 ? 's' : ''}`,
      body: isLt
        ? `Nebūtinos prenumeratos kainuoja ~${formatEur(optionalRecurringMonthly)}/mėn. (${formatEur(optionalRecurringMonthly * 12)}/metus). Atsisakius bent vienos nenaudojamos paslaugos, sutaupysite be pastangų.`
        : `Your optional subscriptions/recurring items cost ~${formatEur(optionalRecurringMonthly)}/mo (${formatEur(optionalRecurringMonthly * 12)}/yr). Pausing even one unused service yields effortless monthly savings.`,
      potentialMonthlySavings: optionalRecurringMonthly * 0.35,
    });
  }

  // 6. Missing budget suggestion
  const unbudgetedTop = catTotals.find(
    (c) => c.budget === null && c.total >= 50 && c.category !== 'other'
  );
  if (unbudgetedTop) {
    const label = getCategoryLabel(unbudgetedTop.category, lang);
    const suggestedCap = Math.ceil((unbudgetedTop.total * 0.9) / 10) * 10;
    tips.push({
      id: `set-budget-${unbudgetedTop.category}`,
      severity: 'good',
      category: unbudgetedTop.category,
      title: isLt
        ? `Nustatykite ${formatEur(suggestedCap, false)} limitą kategorijai „${label}“`
        : `Set a ${formatEur(suggestedCap, false)} cap on ${label}`,
      body: isLt
        ? `„${label}“ yra viena didžiausių jūsų išlaidų (${formatEur(unbudgetedTop.total)}) be mėnesio biudžeto. Nustačius ribą lengviau pastebėti perteklinį išlaidavimą.`
        : `${label} is one of your top categories (${formatEur(unbudgetedTop.total)}) without a monthly budget. Adding a target limit helps trigger early alerts before overspending.`,
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
        ? `Šį mėnesį tilpote į limitus (${formatEur(totalSpent)}). Pabandykite 10% (${formatEur(totalSpent * 0.1)}) atidėti į taupymo tikslą.`
        : `You're staying within your limits at ${formatEur(totalSpent)} this month. Consider setting aside 10% (${formatEur(totalSpent * 0.1)}) into a dedicated savings goal.`,
    });
  }

  const order = { high: 0, medium: 1, good: 2 };
  return tips.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function getDiscretionaryCategories(): CategoryId[] {
  return CATEGORIES.filter((c) => c.isDiscretionary).map((c) => c.id);
}
