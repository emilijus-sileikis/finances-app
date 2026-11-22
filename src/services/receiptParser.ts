import { CATEGORIES } from '@/constants/categories';
import type {
  CategoryId,
  MerchantRule,
  NewExpenseItemInput,
  ParsedReceipt,
} from '@/types/finance';
import {
  getTodayIso,
  isValidIsoDate,
  normalizeMerchantKey,
  parseFlexibleAmount,
} from '@/utils/format';

const TOTAL_LINE_REGEX =
  /\b(grand\s*total|amount\s*due|balance\s*due|total\s*eur|total|sum|suma|iš\s*viso|is\s*viso|viso|mokėti|moketi|gesamt|zu\s*zahlen|betrag|a\s*payer|ttc|importe|totale|kaina|kortele|card\s*payment)\b/i;

const SUBTOTAL_EXCLUDE_REGEX =
  /\b(sub\s*total|subtotal|be\s*pvm|netto|net\s*amount|change|grąža|graza|cash\s*tendered)\b/i;

const TAX_LINE_REGEX =
  /\b(vat|pvm|tax|taxes|mwst|ust|tva|iva|btw|moms|gpm|mokestis|mokesčiai)\b/i;

// Lines that signal the start of the receipt summary/payment section (stop parsing items after)
const SUMMARY_STOP_REGEX =
  /\b(iš\s*viso|is\s*viso|viso\s*mok|viso\b|mokėti|moketi|grand\s*total|amount\s*due|balance\s*due|total\b|suma\s*mok|suma\b|gesamt|zu\s*zahlen|a\s*payer|kortele|banko\s*kortel|grynieji|grąža|graza|change\b|apmokėta|apmoketa|be\s*pvm|su\s*pvm|pvm\s*\d|vat\s*\d)\b/i;

// Non-item metadata/header/footer lines
const IGNORE_ITEM_LINE_REGEX =
  /\b(uab\b|ab\b|mb\b|gmbh|ltd|llc|pvm\s*mok|įmonės\s*kod|imones\s*kod|kodas|kvitas|čekis|cekis|kasos|kasinink|parduotuv|adresas|gatvė|gatve|vilnius|kaunas|klaipėda|klaipeda|šiauliai|panevėžys|tel\.|telefon|www\.|http|el\.\s*pašt|invoice|sąskaita|saskaita|receipt|visa\b|mastercard|maestro|terminal|auth|aid:|pan:|taškai|taskai|lojalumo|mano\s*rimi\s*tašk|ačiū|aciu|thank\s*you|sutaupėte|sutaupete|you\s*saved|likutis|balance|prekių\s*kiekis|tarifas|pvm\b|vat\b|mwst\b|tva\b|tax\b|subtotal|sub\s*total|be\s*pvm|su\s*pvm|grąža|graza|grynieji|cash\b|kortele|card\b)\b/i;

const DISCOUNT_WORD_REGEX =
  /\b(nuolaida|akcija|discount|rabatt|remise|descuento|coupon|kuponas|kortelės\s*nuol|mano\s*rimi|ačiū\s*nuol|promo)\b/i;

const AMOUNT_TOKEN_REGEX =
  /(?:€|EUR\s*)?(\d{1,3}(?:[.\s]\d{3})*[.,]\d{2}|\d+[.,]\d{2})(?:\s*(?:€|EUR))?/gi;

function extractNumbersFromLine(line: string): number[] {
  const matches: number[] = [];
  let m: RegExpExecArray | null;
  const regex = new RegExp(AMOUNT_TOKEN_REGEX.source, 'gi');
  while ((m = regex.exec(line)) !== null) {
    const raw = m[1].replace(/\s/g, '');
    const parsed = parseFlexibleAmount(raw);
    if (parsed !== null && parsed > 0 && parsed < 500000) {
      matches.push(parsed);
    }
  }
  return matches;
}

function extractDate(text: string): string {
  const isoMatch = text.match(/\b(20\d{2})[-./](0?[1-9]|1[0-2])[-./](0?[1-9]|[12]\d|3[01])\b/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    const candidate = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    if (isValidIsoDate(candidate)) return candidate;
  }

  const euMatch = text.match(/\b(0?[1-9]|[12]\d|3[01])[-./](0?[1-9]|1[0-2])[-./](20\d{2})\b/);
  if (euMatch) {
    const [, d, m, y] = euMatch;
    const candidate = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    if (isValidIsoDate(candidate)) return candidate;
  }

  return getTodayIso();
}

function extractMerchant(lines: string[]): string {
  const skipNoise =
    /^(receipt|kvitas|invoice|sąskaita|saskaita|date|data|time|tel|phone|www\.|http|uab\s*$|ab\s*$|vat|pvm|code|kodas|address|nr\.|#|\d)/i;

  for (const rawLine of lines.slice(0, 7)) {
    const cleaned = rawLine
      .replace(/[^a-zA-Z0-9À-ž&'.,\-\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length < 3 || cleaned.length > 48) continue;
    if (skipNoise.test(cleaned)) continue;
    if (/^\d[\d\s.,/-]+$/.test(cleaned)) continue;
    const pretty = cleaned
      .replace(/^(UAB|AB|MB|GmbH|Ltd|LLC|Inc)\s+/i, '')
      .replace(/\s+(UAB|AB|MB|GmbH|Ltd|LLC|Inc)\.?$/i, '')
      .trim();
    if (pretty.length >= 2) return pretty;
  }

  return '';
}

function parseQuantity(raw: string): number | null {
  const normalized = raw.replace(/\s/g, '').replace(',', '.');
  const val = Number(normalized);
  if (!Number.isFinite(val) || val <= 0) return null;
  return Math.round(val * 1000) / 1000;
}

function cleanItemName(raw: string): string {
  return raw
    .replace(/^[\d#*•\-–—\s]{1,4}(?=[A-Za-zÀ-ž])/, '')
    .replace(/\s*(?:€|EUR)\s*$/i, '')
    .replace(/[\s.\-_:;]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLikelyStandaloneItemName(line: string): boolean {
  if (line.length < 2 || line.length > 56) return false;
  if (IGNORE_ITEM_LINE_REGEX.test(line) || SUMMARY_STOP_REGEX.test(line)) return false;
  // Must have at least 2 letters and not be a date/time/barcode line
  const letterCount = (line.match(/[A-Za-zÀ-ž]/g) ?? []).length;
  if (letterCount < 2) return false;
  if (/^\d{4}[-./]\d{2}[-./]\d{2}/.test(line) || /^\d{2}[.:]\d{2}[.:]\d{2}/.test(line)) {
    return false;
  }
  if (/^\d{8,}$/.test(line.replace(/\s/g, ''))) return false;
  return true;
}

/**
 * Extracts individual line items from European/Lithuanian OCR or PDF receipt text.
 * Handles:
 *  - Standard single lines: "PIENAS 2,5% 1L    2,99 A" or "Milk €3.00"
 *  - Multi-line quantity rows:
 *      "KINDER BUENO 43G"
 *      "2 x 1,00          2,00 A"
 *      or "0,540 kg x 2,99   1,61 A"
 *  - Inline quantity rows: "2 x KINDER BUENO 2,00 A" or "KINDER BUENO 2x1,00 2,00"
 *  - Discounts: "NUOLAIDA -0,50 A", "AKCIJA -1,20", "DISCOUNT -2.00"
 */
export function extractLineItems(
  lines: string[],
  receiptTotal: number | null,
  merchant: string
): NewExpenseItemInput[] {
  const items: NewExpenseItemInput[] = [];
  const normalizedMerchant = normalizeMerchantKey(merchant);

  // Quantity-only detail line, e.g.:
  // "2 x 1,99   3,98 A" | "0,540 kg x 2,99 1,61 A" | "2 vnt. x 1,50  3,00" | "2 * 1,99"
  const qtyDetailRegex =
    /^(\d+(?:[.,]\d{1,3})?)\s*(?:vnt\.?|pcs\.?|kg|g|l|ml|pak\.?)?\s*[xX*×]\s*(?:€|EUR\s*)?(\d+[.,]\d{2})(?:\s*(?:€|EUR))?(?:\s+(?:€|EUR\s*)?([−-]?\d+[.,]\d{2}))?(?:\s*(?:€|EUR))?(?:\s+[A-Z*])?$/i;

  // Standard item line ending with price (+ optional tax class letter A/B/C/N/* or EUR/€)
  const trailingPriceRegex =
    /^(.*?)\s+(?:€|EUR\s*)?([−-]?\s*\d{1,4}[.,]\d{2})(?:\s*(?:€|EUR))?(?:\s+[A-Z0-9*]{1,2})?$/i;

  // Inline quantity at start: "2 x Kinder Bueno" or "3x Milk"
  const leadingQtyRegex = /^(\d+(?:[.,]\d{1,2})?)\s*[xX*×]\s+(.+)$/;

  // Inline quantity before price: "Kinder Bueno 2 x 1,00"
  const inlineQtyMultiplierRegex =
    /^(.+?)\s+(\d+(?:[.,]\d{1,3})?)\s*(?:vnt\.?|kg|pcs\.?)?\s*[xX*×]\s*(\d+[.,]\d{2})$/i;

  let pendingName: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Stop once we enter the totals / payment summary block (if we already collected items)
    if (items.length > 0 && SUMMARY_STOP_REGEX.test(line) && !DISCOUNT_WORD_REGEX.test(line)) {
      break;
    }

    // Skip merchant header line at very top
    if (
      i < 4 &&
      normalizedMerchant.length >= 3 &&
      normalizeMerchantKey(line) === normalizedMerchant
    ) {
      pendingName = null;
      continue;
    }

    // 1. Check if this line is a quantity detail row belonging to pendingName
    const qtyMatch = line.match(qtyDetailRegex);
    if (qtyMatch && pendingName) {
      const qtyRaw = parseQuantity(qtyMatch[1]);
      const unitPrice = parseFlexibleAmount(qtyMatch[2]);
      const explicitLineTotal = qtyMatch[3]
        ? parseFlexibleAmount(qtyMatch[3].replace(/\s/g, ''), true)
        : null;

      if (qtyRaw !== null && unitPrice !== null) {
        const linePrice =
          explicitLineTotal !== null
            ? explicitLineTotal
            : Math.round(qtyRaw * unitPrice * 100) / 100;
        const cleanName = cleanItemName(pendingName);
        if (cleanName.length >= 2 && linePrice !== 0) {
          items.push({
            name: cleanName,
            quantity: qtyRaw > 0 ? qtyRaw : 1,
            price: linePrice,
          });
        }
      }
      pendingName = null;
      continue;
    }

    // Filter out headers, VAT summaries, payment lines, etc. (unless it's a discount line)
    const isDiscount = DISCOUNT_WORD_REGEX.test(line);
    if (!isDiscount && (IGNORE_ITEM_LINE_REGEX.test(line) || SUMMARY_STOP_REGEX.test(line))) {
      pendingName = null;
      continue;
    }

    // 2. Try matching a line ending with a price
    const priceMatch = line.match(trailingPriceRegex);
    if (priceMatch) {
      let rawName = priceMatch[1].trim();
      const rawPriceStr = priceMatch[2].replace(/\s/g, '');
      let price = parseFlexibleAmount(rawPriceStr, true);

      if (price === null || price === 0 || Math.abs(price) > 100000) {
        pendingName = null;
        continue;
      }

      // If discount word is present and OCR missed the minus sign, keep negative if clearly discount
      if (isDiscount && price > 0 && /-\s*\d/.test(line)) {
        price = -price;
      }

      // Guard against accidentally capturing the receipt grand total if name is empty or generic
      if (
        receiptTotal !== null &&
        Math.abs(price - receiptTotal) < 0.005 &&
        items.length >= 2 &&
        rawName.length < 4
      ) {
        pendingName = null;
        continue;
      }

      let quantity = 1;

      // Check inline multiplier inside rawName (e.g. "Kinder Bueno 2 x 1,00")
      const inlineMul = rawName.match(inlineQtyMultiplierRegex);
      if (inlineMul) {
        const q = parseQuantity(inlineMul[2]);
        if (q !== null && q > 0) {
          rawName = inlineMul[1];
          quantity = q;
        }
      } else {
        // Check leading qty (e.g. "2 x Milk")
        const leadQ = rawName.match(leadingQtyRegex);
        if (leadQ) {
          const q = parseQuantity(leadQ[1]);
          if (q !== null && q > 0 && q < 100) {
            quantity = q;
            rawName = leadQ[2];
          }
        }
      }

      const name = cleanItemName(rawName);
      const letterCount = (name.match(/[A-Za-zÀ-ž]/g) ?? []).length;

      if (letterCount >= 2 && name.length >= 2) {
        items.push({ name, quantity, price });
        pendingName = null;
        continue;
      } else if (pendingName && (isDiscount || Math.abs(price) > 0)) {
        // Sometimes the price sits alone on the next line after the item name
        const fallbackName = cleanItemName(pendingName);
        if (fallbackName.length >= 2) {
          items.push({ name: fallbackName, quantity, price });
          pendingName = null;
          continue;
        }
      }
    }

    // 3. Otherwise, remember line as potential item name for a following quantity/price line
    if (isLikelyStandaloneItemName(line)) {
      pendingName = line;
    } else {
      pendingName = null;
    }
  }

  return items;
}

export function suggestCategory(
  text: string,
  merchant: string,
  learnedRules: MerchantRule[]
): { category: CategoryId; confidence: 'learned' | 'keyword' | 'fallback'; matchedHint?: string } {
  const normalizedMerchant = normalizeMerchantKey(merchant);
  const normalizedAll = normalizeMerchantKey(`${merchant} ${text}`);

  if (normalizedMerchant.length >= 2) {
    for (const rule of learnedRules) {
      if (
        normalizedMerchant === rule.merchantKey ||
        normalizedMerchant.includes(rule.merchantKey) ||
        rule.merchantKey.includes(normalizedMerchant)
      ) {
        return {
          category: rule.category,
          confidence: 'learned',
          matchedHint: `Remembered "${rule.merchantKey}"`,
        };
      }
    }
  }

  for (const rule of learnedRules) {
    if (rule.merchantKey.length >= 4 && normalizedAll.includes(rule.merchantKey)) {
      return {
        category: rule.category,
        confidence: 'learned',
        matchedHint: `Remembered "${rule.merchantKey}"`,
      };
    }
  }

  const lowerMerchant = merchant.toLowerCase();
  const lowerText = text.toLowerCase();

  let bestCategory: CategoryId = 'other';
  let bestScore = 0;
  let bestKeyword = '';

  for (const cat of CATEGORIES) {
    if (cat.id === 'other') continue;
    let score = 0;
    let hit = '';
    for (const kw of cat.keywords) {
      if (lowerMerchant.includes(kw)) {
        score += 3;
        hit = hit || kw;
      } else if (lowerText.includes(kw)) {
        score += 1;
        hit = hit || kw;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestCategory = cat.id;
      bestKeyword = hit;
    }
  }

  if (bestScore > 0) {
    return {
      category: bestCategory,
      confidence: 'keyword',
      matchedHint: `Matched "${bestKeyword}"`,
    };
  }

  return { category: 'other', confidence: 'fallback' };
}

export function parseReceiptText(
  rawText: string,
  learnedRules: MerchantRule[]
): ParsedReceipt {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const merchant = extractMerchant(lines);
  const date = extractDate(rawText);

  let bestTotal: number | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (SUBTOTAL_EXCLUDE_REGEX.test(line)) continue;
    if (TOTAL_LINE_REGEX.test(line)) {
      const nums = extractNumbersFromLine(line);
      if (nums.length > 0) {
        bestTotal = nums[nums.length - 1];
        break;
      }
      if (i + 1 < lines.length) {
        const nextNums = extractNumbersFromLine(lines[i + 1]);
        if (nextNums.length > 0) {
          bestTotal = nextNums[nextNums.length - 1];
          break;
        }
      }
    }
  }

  if (bestTotal === null) {
    const allNums = lines.flatMap((line) => extractNumbersFromLine(line));
    if (allNums.length > 0) {
      bestTotal = Math.max(...allNums);
    }
  }

  let bestTax: number | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (TAX_LINE_REGEX.test(line)) {
      const nums = extractNumbersFromLine(line);
      const valid = nums.filter((n) => bestTotal === null || n <= bestTotal);
      if (valid.length > 0) {
        bestTax = valid[valid.length - 1];
        break;
      }
    }
  }

  const items = extractLineItems(lines, bestTotal, merchant);
  const catResult = suggestCategory(rawText, merchant, learnedRules);

  return {
    merchant,
    amount: bestTotal,
    taxAmount: bestTax,
    date,
    category: catResult.category,
    confidence: catResult.confidence,
    matchedHint: catResult.matchedHint,
    items,
  };
}
