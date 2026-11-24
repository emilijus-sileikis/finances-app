import { getCurrencyMeta, type CurrencyCode } from '@/constants/currencies';
import type { Expense } from '@/types/finance';
import { normalizeMerchantKey } from '@/utils/format';

export interface DuplicateCandidate {
  amount: number;
  date: string;
  merchant: string;
  title: string;
}

/**
 * Checks whether a very similar expense already exists on the same date with
 * the same amount (and compatible merchant/title), preventing accidental
 * double-uploads of the same receipt PDF or screenshot.
 */
export function findPotentialDuplicate(
  expenses: Expense[],
  candidate: DuplicateCandidate,
  currency: CurrencyCode = 'EUR'
): Expense | null {
  const tolerance = getCurrencyMeta(currency).decimals === 0 ? 1 : 0.01;
  const candKey = normalizeMerchantKey(candidate.merchant || candidate.title);

  for (const exp of expenses) {
    if (exp.date !== candidate.date) continue;
    if (Math.abs(exp.amount - candidate.amount) > tolerance) continue;

    const expKey = normalizeMerchantKey(exp.merchant || exp.title);
    // If either has no merchant key, or keys overlap, treat as potential duplicate
    if (
      !candKey ||
      !expKey ||
      candKey === expKey ||
      candKey.includes(expKey) ||
      expKey.includes(candKey)
    ) {
      return exp;
    }
  }

  return null;
}
