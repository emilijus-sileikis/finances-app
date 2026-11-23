export type CurrencyCode = 'EUR' | 'KRW' | 'USD' | 'GBP' | 'JPY' | 'PLN';

export interface CurrencyMeta {
  code: CurrencyCode;
  symbol: string;
  name: string;
  decimals: 0 | 2;
  /** Approximate units per 1 EUR, used only to scale local savings coach thresholds */
  eurRateApprox: number;
}

export const CURRENCIES: CurrencyMeta[] = [
  { code: 'EUR', symbol: '€', name: 'Euro', decimals: 2, eurRateApprox: 1 },
  { code: 'KRW', symbol: '₩', name: 'Korean Won', decimals: 0, eurRateApprox: 1500 },
  { code: 'USD', symbol: '$', name: 'US Dollar', decimals: 2, eurRateApprox: 1.08 },
  { code: 'GBP', symbol: '£', name: 'British Pound', decimals: 2, eurRateApprox: 0.85 },
  { code: 'PLN', symbol: 'zł', name: 'Polish Zloty', decimals: 2, eurRateApprox: 4.3 },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen', decimals: 0, eurRateApprox: 165 },
];

export const CURRENCY_MAP: Record<CurrencyCode, CurrencyMeta> = CURRENCIES.reduce(
  (acc, item) => {
    acc[item.code] = item;
    return acc;
  },
  {} as Record<CurrencyCode, CurrencyMeta>
);

export function isCurrencyCode(val: string | null | undefined): val is CurrencyCode {
  return Boolean(val && val in CURRENCY_MAP);
}

export function getCurrencyMeta(code: CurrencyCode = 'EUR'): CurrencyMeta {
  return CURRENCY_MAP[code] ?? CURRENCY_MAP.EUR;
}

export function formatCurrency(
  amount: number,
  currency: CurrencyCode = 'EUR',
  showDecimals?: boolean
): string {
  const meta = getCurrencyMeta(currency);
  const safe = Number.isFinite(amount) ? amount : 0;
  const abs = Math.abs(safe);
  const useDecimals = meta.decimals === 0 ? false : (showDecimals ?? true);
  const digits = useDecimals ? meta.decimals : 0;

  const formatted = abs.toLocaleString('en-IE', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const sign = safe < 0 ? '-' : '';

  if (meta.code === 'PLN') {
    return `${sign}${formatted} ${meta.symbol}`;
  }
  return `${sign}${meta.symbol}${formatted}`;
}

export function formatEditableAmount(amount: number, currency: CurrencyCode = 'EUR'): string {
  const meta = getCurrencyMeta(currency);
  const safe = Number.isFinite(amount) ? amount : 0;
  return meta.decimals === 0 ? String(Math.round(safe)) : safe.toFixed(2);
}
