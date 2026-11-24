import type { Expense } from '@/types/finance';

export interface ProductPriceEntry {
  expenseId: number;
  date: string;
  store: string;
  itemName: string;
  quantity: number;
  linePrice: number;
  unitPrice: number;
}

export interface StorePriceStat {
  store: string;
  avgUnitPrice: number;
  minUnitPrice: number;
  count: number;
}

export interface ProductPriceSummary {
  query: string;
  totalSpent: number;
  purchaseCount: number;
  avgUnitPrice: number;
  minUnitPrice: number;
  maxUnitPrice: number;
  cheapestStore: StorePriceStat | null;
  priceChangePct: number | null; // latest vs oldest unit price %
  storeStats: StorePriceStat[];
  history: ProductPriceEntry[];
}

export interface TopProductDigest {
  key: string;
  displayName: string;
  count: number;
  totalSpent: number;
  avgUnitPrice: number;
  cheapestStore: string;
  cheapestPrice: number;
}

function fold(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    .toLowerCase()
    .trim();
}

/**
 * Normalizes a receipt item name into a stable grouping key so slight OCR or
 * package-size differences like "PIENAS 2,5% 1L" and "Pienas 2.5%" group cleanly.
 */
export function normalizeProductKey(name: string): string {
  return fold(name)
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:ml|l|g|kg|vnt|pcs|pak|%)\b/gi, ' ')
    .replace(/[^a-z0-9가-힣\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Analyzes itemized price history across all receipts matching `query`.
 */
export function analyzeProductPrices(
  expenses: Expense[],
  query: string
): ProductPriceSummary | null {
  const q = fold(query);
  if (q.length < 2) return null;

  const history: ProductPriceEntry[] = [];

  for (const exp of expenses) {
    const store = (exp.merchant || exp.title || 'Unknown').trim();
    for (const item of exp.items) {
      if (item.price <= 0) continue;
      if (!fold(item.name).includes(q)) continue;
      const qty = item.quantity > 0 ? item.quantity : 1;
      const unitPrice = Math.round((item.price / qty) * 100) / 100;
      history.push({
        expenseId: exp.id,
        date: exp.date,
        store,
        itemName: item.name,
        quantity: qty,
        linePrice: item.price,
        unitPrice,
      });
    }
  }

  if (history.length === 0) return null;

  // Sort newest first for display
  history.sort((a, b) => b.date.localeCompare(a.date));

  const totalSpent =
    Math.round(history.reduce((s, h) => s + h.linePrice, 0) * 100) / 100;
  const unitPrices = history.map((h) => h.unitPrice);
  const avgUnitPrice =
    Math.round((unitPrices.reduce((s, v) => s + v, 0) / unitPrices.length) * 100) / 100;
  const minUnitPrice = Math.min(...unitPrices);
  const maxUnitPrice = Math.max(...unitPrices);

  // Per-store aggregation
  const byStore = new Map<string, number[]>();
  for (const h of history) {
    const list = byStore.get(h.store) ?? [];
    list.push(h.unitPrice);
    byStore.set(h.store, list);
  }

  const storeStats: StorePriceStat[] = Array.from(byStore.entries())
    .map(([store, prices]) => ({
      store,
      avgUnitPrice:
        Math.round((prices.reduce((s, v) => s + v, 0) / prices.length) * 100) / 100,
      minUnitPrice: Math.min(...prices),
      count: prices.length,
    }))
    .sort((a, b) => a.avgUnitPrice - b.avgUnitPrice);

  const cheapestStore = storeStats[0] ?? null;

  // Chronological trend (newest vs oldest) if purchased >= 2 times on different dates
  let priceChangePct: number | null = null;
  if (history.length >= 2) {
    const newest = history[0].unitPrice;
    const oldest = history[history.length - 1].unitPrice;
    if (oldest > 0 && history[0].date !== history[history.length - 1].date) {
      priceChangePct = Math.round(((newest - oldest) / oldest) * 100);
    }
  }

  return {
    query: query.trim(),
    totalSpent,
    purchaseCount: history.length,
    avgUnitPrice,
    minUnitPrice,
    maxUnitPrice,
    cheapestStore,
    priceChangePct,
    storeStats,
    history,
  };
}

/**
 * Finds the most frequently bought receipt products so users can inspect
 * price comparisons in 1 tap without typing.
 */
export function getTopTrackedProducts(
  expenses: Expense[],
  limit = 8
): TopProductDigest[] {
  const groups = new Map<
    string,
    {
      displayName: string;
      count: number;
      totalSpent: number;
      unitPrices: number[];
      cheapestStore: string;
      cheapestPrice: number;
    }
  >();

  for (const exp of expenses) {
    const store = (exp.merchant || exp.title || 'Unknown').trim();
    for (const item of exp.items) {
      if (item.price <= 0) continue;
      const key = normalizeProductKey(item.name);
      if (key.length < 2) continue;
      const qty = item.quantity > 0 ? item.quantity : 1;
      const unitPrice = Math.round((item.price / qty) * 100) / 100;

      const prev = groups.get(key);
      if (!prev) {
        groups.set(key, {
          displayName: item.name,
          count: 1,
          totalSpent: item.price,
          unitPrices: [unitPrice],
          cheapestStore: store,
          cheapestPrice: unitPrice,
        });
      } else {
        prev.count += 1;
        prev.totalSpent = Math.round((prev.totalSpent + item.price) * 100) / 100;
        prev.unitPrices.push(unitPrice);
        if (unitPrice < prev.cheapestPrice) {
          prev.cheapestPrice = unitPrice;
          prev.cheapestStore = store;
        }
      }
    }
  }

  return Array.from(groups.entries())
    .map(([key, g]) => ({
      key,
      displayName: g.displayName,
      count: g.count,
      totalSpent: g.totalSpent,
      avgUnitPrice:
        Math.round(
          (g.unitPrices.reduce((s, v) => s + v, 0) / g.unitPrices.length) * 100
        ) / 100,
      cheapestStore: g.cheapestStore,
      cheapestPrice: g.cheapestPrice,
    }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return b.totalSpent - a.totalSpent;
    })
    .slice(0, limit);
}
