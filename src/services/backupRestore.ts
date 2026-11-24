import { CATEGORY_MAP, CUSTOM_CATEGORY_ICONS } from '@/constants/categories';
import { isCurrencyCode, type CurrencyCode } from '@/constants/currencies';
import type {
  CategoryBudget,
  CategoryId,
  CustomCategory,
  IoniconName,
  NewExpenseInput,
  NewExpenseItemInput,
  NewQuickPresetInput,
  NewRecurringInput,
  NewSavingsGoalInput,
  RecurringFrequency,
} from '@/types/finance';
import { getTodayIso, isValidIsoDate, normalizeMerchantKey } from '@/utils/format';

export interface ValidatedBackupPayload {
  currency?: CurrencyCode;
  monthlyIncome?: number;
  customCategories: CustomCategory[];
  merchantRules: { merchantKey: string; category: CategoryId }[];
  expenses: NewExpenseInput[];
  budgets: CategoryBudget[];
  recurring: NewRecurringInput[];
  quickPresets: NewQuickPresetInput[];
  savingsGoals: NewSavingsGoalInput[];
}

function asValidCategory(val: unknown, validCustomIds: Set<string>): CategoryId {
  if (typeof val === 'string' && (val in CATEGORY_MAP || validCustomIds.has(val))) {
    return val as CategoryId;
  }
  return 'other';
}

function asValidFrequency(val: unknown): RecurringFrequency {
  if (val === 'weekly' || val === 'yearly' || val === 'monthly') return val;
  return 'monthly';
}

function asFiniteNumber(val: unknown, fallback = 0): number {
  const num = typeof val === 'number' ? val : Number(val);
  return Number.isFinite(num) ? Math.round(num * 100) / 100 : fallback;
}

/**
 * Validates and sanitizes a JSON backup exported by Finances.
 * Throws an Error with a clear message if the file is not a valid backup.
 */
export function parseBackupJson(rawText: string): ValidatedBackupPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('Invalid JSON file.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Backup file must be a JSON object.');
  }

  const obj = parsed as Record<string, unknown>;
  if (
    !Array.isArray(obj.expenses) &&
    !Array.isArray(obj.budgets) &&
    !Array.isArray(obj.recurring)
  ) {
    throw new Error('This file does not look like a Finances backup.');
  }

  const currency = isCurrencyCode(obj.currency as string | undefined)
    ? (obj.currency as CurrencyCode)
    : undefined;

  const monthlyIncome =
    obj.monthlyIncome !== undefined
      ? Math.max(0, asFiniteNumber(obj.monthlyIncome, 0))
      : undefined;

  const customCategories: CustomCategory[] = [];
  const validCustomIds = new Set<string>();
  const iconSet = new Set<string>(CUSTOM_CATEGORY_ICONS);
  if (Array.isArray(obj.customCategories)) {
    for (const raw of obj.customCategories) {
      if (!raw || typeof raw !== 'object') continue;
      const c = raw as Record<string, unknown>;
      const id = typeof c.id === 'string' ? c.id.trim() : '';
      const label = typeof c.label === 'string' ? c.label.trim() : '';
      if (!id || !label || id in CATEGORY_MAP || validCustomIds.has(id)) continue;
      const icon = (
        typeof c.icon === 'string' && iconSet.has(c.icon) ? c.icon : 'pricetag-outline'
      ) as IoniconName;
      const color =
        typeof c.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(c.color)
          ? c.color
          : '#10B981';
      customCategories.push({
        id,
        label,
        icon,
        color,
        isDiscretionary: Boolean(c.isDiscretionary),
      });
      validCustomIds.add(id);
    }
  }

  const expenses: NewExpenseInput[] = [];
  if (Array.isArray(obj.expenses)) {
    for (const raw of obj.expenses) {
      if (!raw || typeof raw !== 'object') continue;
      const e = raw as Record<string, unknown>;
      const amount = asFiniteNumber(e.amount, -1);
      if (amount <= 0) continue;
      const dateStr =
        typeof e.date === 'string' && isValidIsoDate(e.date)
          ? e.date.trim()
          : getTodayIso();
      const title =
        typeof e.title === 'string' && e.title.trim() ? e.title.trim() : 'Expense';
      const merchant = typeof e.merchant === 'string' ? e.merchant.trim() : '';

      const items: NewExpenseItemInput[] = [];
      if (Array.isArray(e.items)) {
        for (const rawItem of e.items) {
          if (!rawItem || typeof rawItem !== 'object') continue;
          const it = rawItem as Record<string, unknown>;
          const name = typeof it.name === 'string' ? it.name.trim() : '';
          const price = asFiniteNumber(it.price, Number.NaN);
          if (!name || !Number.isFinite(price)) continue;
          const qtyRaw = asFiniteNumber(it.quantity, 1);
          items.push({
            name,
            quantity: qtyRaw > 0 ? qtyRaw : 1,
            price,
          });
        }
      }

      expenses.push({
        title,
        merchant,
        amount,
        taxAmount: Math.max(0, asFiniteNumber(e.taxAmount, 0)),
        category: asValidCategory(e.category, validCustomIds),
        date: dateStr,
        notes: typeof e.notes === 'string' ? e.notes : '',
        rawOcrText: typeof e.rawOcrText === 'string' ? e.rawOcrText : null,
        items,
      });
    }
  }

  const budgets: CategoryBudget[] = [];
  if (Array.isArray(obj.budgets)) {
    for (const raw of obj.budgets) {
      if (!raw || typeof raw !== 'object') continue;
      const b = raw as Record<string, unknown>;
      const limit = asFiniteNumber(b.monthlyLimit, 0);
      if (limit > 0) {
        budgets.push({
          category: asValidCategory(b.category, validCustomIds),
          monthlyLimit: limit,
        });
      }
    }
  }

  const recurring: NewRecurringInput[] = [];
  if (Array.isArray(obj.recurring)) {
    for (const raw of obj.recurring) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as Record<string, unknown>;
      const title = typeof r.title === 'string' ? r.title.trim() : '';
      const amount = asFiniteNumber(r.amount, 0);
      if (!title || amount <= 0) continue;
      const day = Math.min(28, Math.max(1, Math.round(asFiniteNumber(r.dayOfMonth, 1))));
      recurring.push({
        title,
        merchant: typeof r.merchant === 'string' ? r.merchant.trim() : title,
        amount,
        category: asValidCategory(r.category, validCustomIds),
        frequency: asValidFrequency(r.frequency),
        dayOfMonth: day,
        autoLog: Boolean(r.autoLog),
        notes: typeof r.notes === 'string' ? r.notes : '',
      });
    }
  }

  const quickPresets: NewQuickPresetInput[] = [];
  if (Array.isArray(obj.quickPresets)) {
    for (const raw of obj.quickPresets) {
      if (!raw || typeof raw !== 'object') continue;
      const p = raw as Record<string, unknown>;
      const title = typeof p.title === 'string' ? p.title.trim() : '';
      const amount = asFiniteNumber(p.amount, 0);
      if (!title || amount <= 0) continue;
      quickPresets.push({
        title,
        merchant: typeof p.merchant === 'string' ? p.merchant.trim() : title,
        amount,
        category: asValidCategory(p.category, validCustomIds),
      });
    }
  }

  const savingsGoals: NewSavingsGoalInput[] = [];
  if (Array.isArray(obj.savingsGoals)) {
    for (const raw of obj.savingsGoals) {
      if (!raw || typeof raw !== 'object') continue;
      const g = raw as Record<string, unknown>;
      const title = typeof g.title === 'string' ? g.title.trim() : '';
      const targetAmount = asFiniteNumber(g.targetAmount, 0);
      if (!title || targetAmount <= 0) continue;
      const savedAmount = Math.max(0, asFiniteNumber(g.savedAmount, 0));
      const color =
        typeof g.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(g.color)
          ? g.color
          : '#10B981';
      const deadline =
        typeof g.deadline === 'string' && isValidIsoDate(g.deadline)
          ? g.deadline
          : null;
      savingsGoals.push({ title, targetAmount, savedAmount, color, deadline });
    }
  }

  const merchantRules: { merchantKey: string; category: CategoryId }[] = [];
  if (Array.isArray(obj.merchantRules)) {
    for (const raw of obj.merchantRules) {
      if (!raw || typeof raw !== 'object') continue;
      const m = raw as Record<string, unknown>;
      const key =
        typeof m.merchantKey === 'string' ? normalizeMerchantKey(m.merchantKey) : '';
      if (key.length < 2) continue;
      merchantRules.push({
        merchantKey: key,
        category: asValidCategory(m.category, validCustomIds),
      });
    }
  }

  return {
    currency,
    monthlyIncome,
    customCategories,
    merchantRules,
    expenses,
    budgets,
    recurring,
    quickPresets,
    savingsGoals,
  };
}
