import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

export type IoniconName = ComponentProps<typeof Ionicons>['name'];

export type CategoryId =
  | 'groceries'
  | 'fun'
  | 'games'
  | 'taxes'
  | 'mortgage'
  | 'dining'
  | 'transport'
  | 'utilities'
  | 'health'
  | 'shopping'
  | 'subscriptions'
  | 'other';

export interface CategoryMeta {
  id: CategoryId;
  label: string;
  icon: IoniconName;
  color: string;
  isDiscretionary: boolean;
  keywords: string[];
}

export interface ExpenseItem {
  id: number;
  expenseId: number;
  name: string;
  quantity: number;
  price: number; // Line total in EUR (can be negative for discounts)
}

export interface NewExpenseItemInput {
  name: string;
  quantity?: number;
  price: number;
}

export interface Expense {
  id: number;
  title: string;
  merchant: string;
  amount: number; // Always EUR
  taxAmount: number; // Optional extracted VAT/tax portion in EUR
  category: CategoryId;
  date: string; // YYYY-MM-DD
  notes: string;
  receiptUri: string | null;
  rawOcrText: string | null;
  recurringId: number | null;
  createdAt: string;
  items: ExpenseItem[];
}

export interface NewExpenseInput {
  title: string;
  merchant: string;
  amount: number;
  taxAmount?: number;
  category: CategoryId;
  date: string;
  notes?: string;
  receiptUri?: string | null;
  rawOcrText?: string | null;
  recurringId?: number | null;
  items?: NewExpenseItemInput[];
}

export interface UpdateExpenseInput {
  title?: string;
  merchant?: string;
  amount?: number;
  taxAmount?: number;
  category?: CategoryId;
  date?: string;
  notes?: string;
  receiptUri?: string | null;
  items?: NewExpenseItemInput[];
}

export interface CategoryBudget {
  category: CategoryId;
  monthlyLimit: number;
}

export type RecurringFrequency = 'monthly' | 'weekly' | 'yearly';

export interface RecurringExpense {
  id: number;
  title: string;
  merchant: string;
  amount: number;
  category: CategoryId;
  frequency: RecurringFrequency;
  dayOfMonth: number; // 1-28
  autoLog: boolean;
  active: boolean;
  lastLoggedPeriod: string | null; // e.g. '2026-11' or '2026-W47' or '2026'
  notes: string;
}

export interface NewRecurringInput {
  title: string;
  merchant: string;
  amount: number;
  category: CategoryId;
  frequency: RecurringFrequency;
  dayOfMonth: number;
  autoLog: boolean;
  notes?: string;
}

export interface MerchantRule {
  merchantKey: string; // normalized lowercase merchant name
  category: CategoryId;
  updatedAt: string;
}

export interface QuickPreset {
  id: number;
  title: string;
  merchant: string;
  amount: number;
  category: CategoryId;
}

export interface NewQuickPresetInput {
  title: string;
  merchant?: string;
  amount: number;
  category: CategoryId;
}

export interface SavingsGoal {
  id: number;
  title: string;
  targetAmount: number;
  savedAmount: number;
  color: string;
  deadline: string | null;
}

export interface NewSavingsGoalInput {
  title: string;
  targetAmount: number;
  savedAmount?: number;
  color?: string;
  deadline?: string | null;
}

export interface ParsedReceipt {
  merchant: string;
  amount: number | null;
  taxAmount: number | null;
  date: string;
  category: CategoryId;
  confidence: 'learned' | 'keyword' | 'fallback';
  matchedHint?: string;
  items: NewExpenseItemInput[];
}

export type TipSeverity = 'high' | 'medium' | 'good';

export interface SavingsTip {
  id: string;
  severity: TipSeverity;
  title: string;
  body: string;
  potentialMonthlySavings?: number;
  category?: CategoryId;
}
