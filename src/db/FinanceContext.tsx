import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  clearAllData,
  deleteExpense,
  deleteQuickPreset,
  deleteRecurring,
  fetchAllBudgets,
  fetchAllExpenses,
  fetchAllQuickPresets,
  fetchAllRecurring,
  fetchMerchantRules,
  getAppSetting,
  insertExpense,
  insertQuickPreset,
  insertRecurring,
  logRecurringForCurrentPeriod,
  processDueAutoRecurring,
  setAppSetting,
  toggleRecurringActive,
  toggleRecurringAutoLog,
  updateExpense,
  upsertBudget,
} from '@/db/database';
import {
  formatCurrency,
  getCurrencyMeta,
  isCurrencyCode,
  type CurrencyCode,
  type CurrencyMeta,
} from '@/constants/currencies';
import { TRANSLATIONS, type Language, type TranslationSet } from '@/i18n/translations';
import { deleteReceiptFile } from '@/services/receiptStorage';
import type {
  CategoryBudget,
  CategoryId,
  Expense,
  MerchantRule,
  NewExpenseInput,
  NewQuickPresetInput,
  NewRecurringInput,
  QuickPreset,
  RecurringExpense,
  UpdateExpenseInput,
} from '@/types/finance';
import {
  getCurrentMonthKey,
  getCurrentPeriodKey,
  getTodayIso,
} from '@/utils/format';

interface FinanceContextValue {
  ready: boolean;
  language: Language;
  t: TranslationSet;
  setLanguage: (lang: Language) => Promise<void>;
  currency: CurrencyCode;
  currencyMeta: CurrencyMeta;
  setCurrency: (code: CurrencyCode) => Promise<void>;
  formatMoney: (amount: number, showDecimals?: boolean) => string;
  expenses: Expense[];
  budgets: CategoryBudget[];
  recurring: RecurringExpense[];
  merchantRules: MerchantRule[];
  quickPresets: QuickPreset[];
  selectedMonth: string;
  setSelectedMonth: (monthKey: string) => void;
  autoLoggedBannerCount: number;
  dismissAutoLoggedBanner: () => void;
  dueManualRecurring: RecurringExpense[];
  refresh: () => Promise<void>;
  addExpense: (input: NewExpenseInput) => Promise<number>;
  editExpense: (id: number, updates: UpdateExpenseInput) => Promise<void>;
  removeExpense: (expense: Expense) => Promise<void>;
  saveBudget: (category: CategoryId, monthlyLimit: number) => Promise<void>;
  addRecurring: (input: NewRecurringInput) => Promise<number>;
  logRecurringNow: (item: RecurringExpense, overrideAmount?: number) => Promise<void>;
  setRecurringActive: (id: number, active: boolean) => Promise<void>;
  setRecurringAutoLog: (id: number, autoLog: boolean) => Promise<void>;
  removeRecurring: (id: number) => Promise<void>;
  addQuickPreset: (input: NewQuickPresetInput) => Promise<number>;
  removeQuickPreset: (id: number) => Promise<void>;
  logQuickPreset: (preset: QuickPreset) => Promise<number>;
  resetAllData: () => Promise<void>;
}

const FinanceContext = createContext<FinanceContextValue | null>(null);

export function FinanceProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [language, setLanguageState] = useState<Language>('en');
  const [currency, setCurrencyState] = useState<CurrencyCode>('EUR');
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [budgets, setBudgets] = useState<CategoryBudget[]>([]);
  const [recurring, setRecurring] = useState<RecurringExpense[]>([]);
  const [merchantRules, setMerchantRules] = useState<MerchantRule[]>([]);
  const [quickPresets, setQuickPresets] = useState<QuickPreset[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonthKey());
  const [autoLoggedBannerCount, setAutoLoggedBannerCount] = useState(0);

  const refresh = useCallback(async () => {
    const [expRows, budgetRows, recRows, ruleRows, presetRows] = await Promise.all([
      fetchAllExpenses(),
      fetchAllBudgets(),
      fetchAllRecurring(),
      fetchMerchantRules(),
      fetchAllQuickPresets(),
    ]);
    setExpenses(expRows);
    setBudgets(budgetRows);
    setRecurring(recRows);
    setMerchantRules(ruleRows);
    setQuickPresets(presetRows);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [savedLang, savedCurrency] = await Promise.all([
          getAppSetting('language'),
          getAppSetting('currency'),
        ]);
        if (active && (savedLang === 'en' || savedLang === 'lt')) {
          setLanguageState(savedLang);
        }
        if (active && isCurrencyCode(savedCurrency)) {
          setCurrencyState(savedCurrency);
        }
        const logged = await processDueAutoRecurring();
        if (active && logged > 0) {
          setAutoLoggedBannerCount(logged);
        }
        await refresh();
      } catch (err) {
        console.error('Failed to initialize finances DB:', err);
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [refresh]);

  const setLanguage = useCallback(async (lang: Language) => {
    setLanguageState(lang);
    await setAppSetting('language', lang);
  }, []);

  const setCurrency = useCallback(async (code: CurrencyCode) => {
    setCurrencyState(code);
    await setAppSetting('currency', code);
  }, []);

  const currencyMeta = useMemo(() => getCurrencyMeta(currency), [currency]);

  const formatMoney = useCallback(
    (amount: number, showDecimals?: boolean) =>
      formatCurrency(amount, currency, showDecimals),
    [currency]
  );

  const dueManualRecurring = useMemo(() => {
    const now = new Date();
    const todayDay = now.getDate();
    return recurring.filter((item) => {
      if (!item.active || item.autoLog) return false;
      const periodKey = getCurrentPeriodKey(item.frequency, now);
      if (item.lastLoggedPeriod === periodKey) return false;
      if (item.frequency === 'monthly' && todayDay < item.dayOfMonth) return false;
      return true;
    });
  }, [recurring]);

  const addExpense = useCallback(
    async (input: NewExpenseInput) => {
      const id = await insertExpense(input);
      await refresh();
      return id;
    },
    [refresh]
  );

  const editExpense = useCallback(
    async (id: number, updates: UpdateExpenseInput) => {
      await updateExpense(id, updates);
      await refresh();
    },
    [refresh]
  );

  const removeExpense = useCallback(
    async (expense: Expense) => {
      await deleteExpense(expense.id);
      if (expense.receiptUri) {
        deleteReceiptFile(expense.receiptUri);
      }
      await refresh();
    },
    [refresh]
  );

  const saveBudget = useCallback(
    async (category: CategoryId, monthlyLimit: number) => {
      await upsertBudget(category, monthlyLimit);
      await refresh();
    },
    [refresh]
  );

  const addRecurring = useCallback(
    async (input: NewRecurringInput) => {
      const id = await insertRecurring(input);
      await processDueAutoRecurring();
      await refresh();
      return id;
    },
    [refresh]
  );

  const logRecurringNow = useCallback(
    async (item: RecurringExpense, overrideAmount?: number) => {
      await logRecurringForCurrentPeriod(item, overrideAmount);
      await refresh();
    },
    [refresh]
  );

  const setRecurringActive = useCallback(
    async (id: number, activeVal: boolean) => {
      await toggleRecurringActive(id, activeVal);
      await refresh();
    },
    [refresh]
  );

  const setRecurringAutoLog = useCallback(
    async (id: number, autoVal: boolean) => {
      await toggleRecurringAutoLog(id, autoVal);
      if (autoVal) {
        await processDueAutoRecurring();
      }
      await refresh();
    },
    [refresh]
  );

  const removeRecurring = useCallback(
    async (id: number) => {
      await deleteRecurring(id);
      await refresh();
    },
    [refresh]
  );

  const addQuickPreset = useCallback(
    async (input: NewQuickPresetInput) => {
      const id = await insertQuickPreset(input);
      await refresh();
      return id;
    },
    [refresh]
  );

  const removeQuickPreset = useCallback(
    async (id: number) => {
      await deleteQuickPreset(id);
      await refresh();
    },
    [refresh]
  );

  const logQuickPreset = useCallback(
    async (preset: QuickPreset) => {
      const today = getTodayIso();
      const id = await insertExpense({
        title: preset.title,
        merchant: preset.merchant || preset.title,
        amount: preset.amount,
        category: preset.category,
        date: today,
      });
      setSelectedMonth(today.slice(0, 7));
      await refresh();
      return id;
    },
    [refresh]
  );

  const resetAllData = useCallback(async () => {
    for (const exp of expenses) {
      if (exp.receiptUri) deleteReceiptFile(exp.receiptUri);
    }
    await clearAllData();
    await refresh();
  }, [expenses, refresh]);

  const dismissAutoLoggedBanner = useCallback(() => {
    setAutoLoggedBannerCount(0);
  }, []);

  const t = TRANSLATIONS[language];

  const value = useMemo<FinanceContextValue>(
    () => ({
      ready,
      language,
      t,
      setLanguage,
      currency,
      currencyMeta,
      setCurrency,
      formatMoney,
      expenses,
      budgets,
      recurring,
      merchantRules,
      quickPresets,
      selectedMonth,
      setSelectedMonth,
      autoLoggedBannerCount,
      dismissAutoLoggedBanner,
      dueManualRecurring,
      refresh,
      addExpense,
      editExpense,
      removeExpense,
      saveBudget,
      addRecurring,
      logRecurringNow,
      setRecurringActive,
      setRecurringAutoLog,
      removeRecurring,
      addQuickPreset,
      removeQuickPreset,
      logQuickPreset,
      resetAllData,
    }),
    [
      ready,
      language,
      t,
      setLanguage,
      currency,
      currencyMeta,
      setCurrency,
      formatMoney,
      expenses,
      budgets,
      recurring,
      merchantRules,
      quickPresets,
      selectedMonth,
      autoLoggedBannerCount,
      dismissAutoLoggedBanner,
      dueManualRecurring,
      refresh,
      addExpense,
      editExpense,
      removeExpense,
      saveBudget,
      addRecurring,
      logRecurringNow,
      setRecurringActive,
      setRecurringAutoLog,
      removeRecurring,
      addQuickPreset,
      removeQuickPreset,
      logQuickPreset,
      resetAllData,
    ]
  );

  return <FinanceContext.Provider value={value}>{children}</FinanceContext.Provider>;
}

export function useFinances(): FinanceContextValue {
  const ctx = useContext(FinanceContext);
  if (!ctx) {
    throw new Error('useFinances must be used inside FinanceProvider');
  }
  return ctx;
}
