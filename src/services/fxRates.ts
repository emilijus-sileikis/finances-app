import {
  CURRENCIES,
  getCurrencyMeta,
  isCurrencyCode,
  type CurrencyCode,
} from '@/constants/currencies';

/** Default approximate units per 1 EUR (100% offline, editable by user) */
export const DEFAULT_FX_RATES: Record<CurrencyCode, number> = CURRENCIES.reduce(
  (acc, item) => {
    acc[item.code] = item.eurRateApprox;
    return acc;
  },
  {} as Record<CurrencyCode, number>
);

export type CustomFxRates = Partial<Record<CurrencyCode, number>>;

export function parseCustomFxRates(raw: string | null): CustomFxRates {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: CustomFxRates = {};
    for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
      if (!isCurrencyCode(key) || key === 'EUR') continue;
      const num = Number(val);
      if (Number.isFinite(num) && num > 0) {
        out[key] = num;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function getEffectiveFxRates(
  customRates: CustomFxRates = {}
): Record<CurrencyCode, number> {
  return {
    ...DEFAULT_FX_RATES,
    ...customRates,
    EUR: 1,
  };
}

/**
 * Converts an amount from one currency to another using offline EUR-anchored rates.
 * Rounds cleanly to the destination currency's decimal precision.
 */
export function convertCurrency(
  amount: number,
  from: CurrencyCode,
  to: CurrencyCode,
  rates: Record<CurrencyCode, number> = DEFAULT_FX_RATES
): number {
  if (!Number.isFinite(amount)) return 0;
  const toMeta = getCurrencyMeta(to);
  const roundTo = (v: number) =>
    toMeta.decimals === 0 ? Math.round(v) : Math.round(v * 100) / 100;

  if (from === to) return roundTo(amount);

  const fromRate = rates[from] > 0 ? rates[from] : DEFAULT_FX_RATES[from];
  const toRate = rates[to] > 0 ? rates[to] : DEFAULT_FX_RATES[to];
  const converted = (amount / fromRate) * toRate;
  return roundTo(converted);
}

export interface RateDisplayPair {
  /** The stronger currency (shown as "1 <unitCode> = <value> <quoteCode>") */
  unitCode: CurrencyCode;
  quoteCode: CurrencyCode;
  value: number;
  formatted: string;
}

/**
 * Always expresses an exchange rate in the human-friendly >= 1 direction,
 * e.g. "1 EUR = 1,500 KRW" or "1 GBP = 1.18 EUR" (never "1 KRW = 0.00067 EUR").
 */
export function getFriendlyRatePair(
  mainCurrency: CurrencyCode,
  foreignCurrency: CurrencyCode,
  rates: Record<CurrencyCode, number> = DEFAULT_FX_RATES
): RateDisplayPair {
  const mainRate = rates[mainCurrency] || 1;
  const foreignRate = rates[foreignCurrency] || 1;

  if (foreignRate >= mainRate) {
    const val = foreignRate / mainRate;
    const digits = val >= 100 ? 0 : 2;
    const displayVal = Number(val.toFixed(digits));
    return {
      unitCode: mainCurrency,
      quoteCode: foreignCurrency,
      value: displayVal,
      formatted: `1 ${mainCurrency} = ${displayVal.toLocaleString('en-IE', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })} ${foreignCurrency}`,
    };
  }

  const val = mainRate / foreignRate;
  const digits = val >= 100 ? 0 : 2;
  const displayVal = Number(val.toFixed(digits));
  return {
    unitCode: foreignCurrency,
    quoteCode: mainCurrency,
    value: displayVal,
    formatted: `1 ${foreignCurrency} = ${displayVal.toLocaleString('en-IE', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })} ${mainCurrency}`,
  };
}

/**
 * Given a user-edited friendly rate ("1 <unitCode> = <newValue> <quoteCode>"),
 * computes the updated EUR-anchored rate entry to persist.
 */
export function computeUpdatedEurRate(
  unitCode: CurrencyCode,
  quoteCode: CurrencyCode,
  newValue: number,
  currentRates: Record<CurrencyCode, number>
): { code: CurrencyCode; eurRate: number } | null {
  if (!Number.isFinite(newValue) || newValue <= 0 || unitCode === quoteCode) {
    return null;
  }

  // Always keep EUR fixed at 1 and adjust the non-EUR currency
  if (unitCode === 'EUR') {
    return { code: quoteCode, eurRate: newValue };
  }
  if (quoteCode === 'EUR') {
    return { code: unitCode, eurRate: 1 / newValue };
  }

  // Neither is EUR: keep unitCode's EUR rate stable and adjust quoteCode
  const unitEur = currentRates[unitCode] || DEFAULT_FX_RATES[unitCode];
  return { code: quoteCode, eurRate: unitEur * newValue };
}

/**
 * Detects an explicit currency from OCR/pasted receipt text when clearly present.
 * Returns null if ambiguous so the user's current selection is preserved.
 */
export function detectReceiptCurrency(rawText: string): CurrencyCode | null {
  if (!rawText || rawText.trim().length < 3) return null;

  if (/[₩]|(?:\bKRW\b)|(?:\d\s*원)|(?:합계|부가세|영수증)/u.test(rawText)) {
    return 'KRW';
  }
  if (/(?:(?:^|[\s\d])zł(?:$|[\s.,])|\bPLN\b|\bPARAGON\b)/i.test(rawText)) {
    return 'PLN';
  }
  if (/[£]|(?:\bGBP\b)/i.test(rawText)) {
    return 'GBP';
  }
  if (/[¥]|(?:\bJPY\b)|(?:合計|税込|領収書)/u.test(rawText)) {
    return 'JPY';
  }
  if (/[€]|(?:\bEUR\b)|(?:\bPVM\b)|(?:Galut[.,]?\s*kaina)/i.test(rawText)) {
    return 'EUR';
  }
  if (/[$]|(?:\bUSD\b)/i.test(rawText)) {
    return 'USD';
  }
  return null;
}
