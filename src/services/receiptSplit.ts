import { getCurrencyMeta, type CurrencyCode } from '@/constants/currencies';

export interface SplitInput {
  amount: number;
  taxAmount: number;
  itemPrices: number[];
  divisor: number;
  currency: CurrencyCode;
}

export interface SplitResult {
  amount: number;
  taxAmount: number;
  itemPrices: number[];
}

function roundForCurrency(val: number, decimals: 0 | 2): number {
  if (decimals === 0) return Math.round(val);
  return Math.round(val * 100) / 100;
}

/**
 * Proportionally splits a receipt's total, tax, and itemized line prices
 * by `divisor` (e.g. 2 for splitting groceries/dinner 50/50).
 */
export function splitReceiptAmounts(input: SplitInput): SplitResult {
  const safeDivisor = Math.max(2, Math.min(20, Math.round(input.divisor)));
  const { decimals } = getCurrencyMeta(input.currency);

  return {
    amount: roundForCurrency(input.amount / safeDivisor, decimals),
    taxAmount: roundForCurrency(input.taxAmount / safeDivisor, decimals),
    itemPrices: input.itemPrices.map((p) => roundForCurrency(p / safeDivisor, decimals)),
  };
}
