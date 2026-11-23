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

/**
 * Strips diacritics/accents (ą->a, č->c, ė/é->e, š->s, ž->z, etc.) so OCR
 * quirks like "sutaupéte" or "Mokéti" match Lithuanian & EU keywords reliably.
 */
function foldAccents(input: string): string {
  return input.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

const TOTAL_LINE_REGEX =
  /\b(grand\s*total|amount\s*due|balance\s*due|total\s*eur|total|sum|suma|is\s*viso|viso|moketi|gesamt|zu\s*zahlen|betrag|a\s*payer|ttc|importe|totale|pirkinys|banko\s*kortele|card\s*payment)\b/i;

const SUBTOTAL_EXCLUDE_REGEX =
  /\b(sub\s*total|subtotal|be\s*pvm|suma\s*su\s*pvm|pvm\s*suma|netto|net\s*amount|change|graza|cash\s*tendered|sutaup|likutis|uzdirbti)\b/i;

const TAX_LINE_REGEX =
  /\b(vat|pvm|tax|taxes|mwst|ust|tva|iva|btw|moms|gpm|mokestis|mokesciai)\b/i;

// Lines that signal the start of the receipt summary/discounts-recap/payment block.
// Matched against accent-folded text!
const SUMMARY_STOP_REGEX =
  /\b(suteiktos\s*nuolaidos|nuolaidu\s*suvestin|jus\s*sutaupete|sutaupete|you\s*saved|mokejimas\s*kortele|bekontaktis\s*atsiskaitymas|is\s*viso|viso\s*mok|viso\b|moketi\b|grand\s*total|amount\s*due|balance\s*due|total\b|suma\s*mok|suma\b|gesamt|zu\s*zahlen|a\s*payer|banko\s*kortele|kortele\b|grynieji|graza|change\b|apmoketa|be\s*pvm|su\s*pvm|pvm\s*suma|pvm\s*\d|vat\s*\d|uzdirbti\s*mano)\b/i;

// Non-item metadata/header/footer lines (matched against accent-folded text)
const IGNORE_ITEM_LINE_REGEX =
  /\b(uab\b|ab\b|mb\b|gmbh|ltd|llc|pvm\s*mok|imones\s*kod|moketojo\s*kod|kodas|kvitas|kvito\s*nr|elektroninis\s*kvitas|pirkejas|cekis|kasos|kasinink|parduotuv|adresas|gatve|vilnius|kaunas|klaipeda|siauliai|panevezys|tel\.|telefon|www\.|http|el\.\s*past|info\.|invoice|saskaita|receipt|visa\b|mastercard|maestro|terminal|autorizacijos|saugokite|patikrinimui|saugos\s*modulio|pardavimas|pirkinys|laikas|auth|aid:|pan:|rrn\b|taskai|lojalumo|mano\s*rimi|aciu|thank\s*you|sutaup|likutis|uzdirbti|balance|prekiu\s*kiekis|tarifas|pvm\b|vat\b|mwst\b|tva\b|tax\b|subtotal|sub\s*total|be\s*pvm|su\s*pvm|graza|grynieji|cash\b|kortele|card\b|verta\s*rinktis)\b/i;

const ADDRESS_LINE_REGEX = /\bg\.\s*\d+|\bpr\.\s*\d+|\bstr\.\s*\d+/i;

const DISCOUNT_WORD_REGEX =
  /\b(nuol\.?|nuolaida|akcija|kitos\s*akcijos|discount|rabatt|remise|descuento|coupon|kuponas|promo)\b/i;

// Inline post-discount final price line right under an item, e.g.:
// "Nuol. -0,70   Galut. kaina 0,99" or "Galut. kaina 2,55" or "Final price 2.55"
const FINAL_PRICE_LINE_REGEX =
  /\b(?:galut\.?\s*kaina|galutine\s*kaina|final\s*price|nauja\s*kaina)\s*[:=]?\s*(?:€|EUR\s*)?(\d{1,4}[.,]\d{2})(?:\s*(?:€|EUR))?(?:\s+[A-Z*])?$/i;

// Inline item-specific discount-only line directly beneath an item (without "Galut. kaina"), e.g.:
// "Nuol. -0,70"
const ITEM_DISCOUNT_ONLY_REGEX =
  /^(nuol\.?|nuolaida|akcija|discount|rabatt)\s*[:=]?\s*(?:€|EUR\s*)?([−-]\s*\d{1,4}[.,]\d{2})(?:\s*(?:€|EUR))?(?:\s+[A-Z*])?$/i;

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
    /^(receipt|kvitas|elektroninis|invoice|saskaita|date|data|time|tel|phone|www\.|http|uab\s*$|ab\s*$|vat|pvm|code|kodas|address|nr\.|#|\d|[-=_]{3})/i;

  for (const rawLine of lines.slice(0, 7)) {
    const cleaned = rawLine
      .replace(/[^a-zA-Z0-9À-ž&'.,\-\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length < 3 || cleaned.length > 48) continue;
    const folded = foldAccents(cleaned);
    if (skipNoise.test(folded)) continue;
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

function isDividerLine(line: string): boolean {
  const stripped = line.replace(/\s/g, '');
  if (stripped.length < 3) return true;
  return /^[-=_*~.#+]{3,}$/.test(stripped);
}

function isLikelyStandaloneItemName(line: string): boolean {
  if (line.length < 2 || line.length > 60) return false;
  if (isDividerLine(line)) return false;
  const folded = foldAccents(line);
  if (
    IGNORE_ITEM_LINE_REGEX.test(folded) ||
    SUMMARY_STOP_REGEX.test(folded) ||
    ADDRESS_LINE_REGEX.test(folded)
  ) {
    return false;
  }
  const letterCount = (line.match(/[A-Za-zÀ-ž]/g) ?? []).length;
  if (letterCount < 2) return false;
  // Skip masked card / loyalty numbers like XXXXXXXXX8428
  if (/X{5,}/i.test(line)) return false;
  if (/^\d{4}[-./]\d{2}[-./]\d{2}/.test(line) || /^\d{2}[.:]\d{2}[.:]\d{2}/.test(line)) {
    return false;
  }
  if (/^\d{8,}$/.test(line.replace(/\s/g, ''))) return false;
  return true;
}

/**
 * Extracts individual line items from European/Lithuanian OCR or PDF receipt text.
 * Handles:
 *  - Standard single lines: "PIENAS 2,5% 1L 2,99 A" or "Milk €3.00"
 *  - Wrapped multi-line product names (e.g. Rimi/Maxima PDFs):
 *      "Energinis gėrimas MONSTER BAD"
 *      "APPLE, 0,5 l                             1,69 A"
 *  - Post-discount final price lines right under an item (replaces item price cleanly!):
 *      "Nuol. -0,70   Galut. kaina 0,99"
 *  - Multi-line quantity/weight rows:
 *      "KINDER BUENO 43G"
 *      "2 x 1,00          2,00 A"
 *      "0,500 kg x 1,60   0,80 A"
 *  - Standalone discount lines before totals: "NUOLAIDA -0,50 A"
 *  - Stops cleanly at SUTEIKTOS NUOLAIDOS / Jūs sutaupėte / Mokėti / VISO / TOTAL
 */
export function extractLineItems(
  lines: string[],
  receiptTotal: number | null,
  merchant: string
): NewExpenseItemInput[] {
  const items: NewExpenseItemInput[] = [];
  const normalizedMerchant = normalizeMerchantKey(merchant);

  const qtyDetailRegex =
    /^(\d+(?:[.,]\d{1,3})?)\s*(?:vnt\.?|pcs\.?|kg|g|l|ml|pak\.?)?\s*[xX*×]\s*(?:€|EUR\s*)?(\d+[.,]\d{2})(?:\s*(?:€|EUR))?(?:\s+(?:€|EUR\s*)?([−-]?\d+[.,]\d{2}))?(?:\s*(?:€|EUR))?(?:\s+[A-Z*])?$/i;

  const trailingPriceRegex =
    /^(.*?)\s+(?:€|EUR\s*)?([−-]?\s*\d{1,4}[.,]\d{2})(?:\s*(?:€|EUR))?(?:\s+[A-Z0-9*]{1,2})?$/i;

  const leadingQtyRegex = /^(\d+(?:[.,]\d{1,2})?)\s*[xX*×]\s+(.+)$/;

  const inlineQtyMultiplierRegex =
    /^(.+?)\s+(\d+(?:[.,]\d{1,3})?)\s*(?:vnt\.?|kg|pcs\.?)?\s*[xX*×]\s*(\d+[.,]\d{2})$/i;

  let pendingNameParts: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (isDividerLine(line)) {
      pendingNameParts = [];
      continue;
    }

    const folded = foldAccents(line);

    // 0. Check for inline "Nuol. -0,70  Galut. kaina 0,99" right after an item!
    // Must run BEFORE SUMMARY_STOP_REGEX & trailingPriceRegex so it updates the
    // previous item's price instead of adding a duplicate line item.
    const finalPriceMatch = folded.match(FINAL_PRICE_LINE_REGEX);
    if (finalPriceMatch && items.length > 0) {
      const finalVal = parseFlexibleAmount(finalPriceMatch[1]);
      if (finalVal !== null && finalVal >= 0) {
        items[items.length - 1].price = finalVal;
      }
      pendingNameParts = [];
      continue;
    }

    // Stop once we enter the summary / SUTEIKTOS NUOLAIDOS / payment section
    if (items.length > 0 && SUMMARY_STOP_REGEX.test(folded)) {
      break;
    }

    // Skip merchant header / slogan lines at very top
    if (
      i < 5 &&
      normalizedMerchant.length >= 3 &&
      normalizeMerchantKey(line) === normalizedMerchant
    ) {
      pendingNameParts = [];
      continue;
    }

    // 1. Check for inline item-only discount ("Nuol. -0,70") directly under an item
    const itemDiscOnly = folded.match(ITEM_DISCOUNT_ONLY_REGEX);
    if (itemDiscOnly && items.length > 0 && pendingNameParts.length === 0) {
      const discVal = parseFlexibleAmount(itemDiscOnly[2].replace(/\s/g, ''), true);
      if (discVal !== null && discVal < 0) {
        const label = cleanItemName(line.slice(0, itemDiscOnly[1].length)) || 'Nuolaida';
        items.push({ name: label, quantity: 1, price: discVal });
      }
      continue;
    }

    // 2. Check if this line is a quantity detail row belonging to pendingNameParts
    const qtyMatch = line.match(qtyDetailRegex);
    if (qtyMatch && pendingNameParts.length > 0) {
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
        const cleanName = cleanItemName(pendingNameParts.join(' '));
        if (cleanName.length >= 2 && linePrice !== 0) {
          items.push({
            name: cleanName,
            quantity: qtyRaw > 0 ? qtyRaw : 1,
            price: linePrice,
          });
        }
      }
      pendingNameParts = [];
      continue;
    }

    // Filter out headers, addresses, VAT summaries, payment lines, etc.
    const isDiscount = DISCOUNT_WORD_REGEX.test(folded);
    if (
      !isDiscount &&
      (IGNORE_ITEM_LINE_REGEX.test(folded) ||
        SUMMARY_STOP_REGEX.test(folded) ||
        ADDRESS_LINE_REGEX.test(folded))
    ) {
      pendingNameParts = [];
      continue;
    }

    // 3. Try matching a line ending with a price
    const priceMatch = line.match(trailingPriceRegex);
    if (priceMatch) {
      let rawName = priceMatch[1].trim();
      const rawPriceStr = priceMatch[2].replace(/\s/g, '');
      let price = parseFlexibleAmount(rawPriceStr, true);

      if (price === null || price === 0 || Math.abs(price) > 100000) {
        pendingNameParts = [];
        continue;
      }

      if (isDiscount && price > 0 && /-\s*\d/.test(line)) {
        price = -price;
      }

      if (
        receiptTotal !== null &&
        Math.abs(price - receiptTotal) < 0.005 &&
        items.length >= 2 &&
        rawName.length < 4 &&
        pendingNameParts.length === 0
      ) {
        pendingNameParts = [];
        continue;
      }

      let quantity = 1;

      const inlineMul = rawName.match(inlineQtyMultiplierRegex);
      if (inlineMul) {
        const q = parseQuantity(inlineMul[2]);
        if (q !== null && q > 0) {
          rawName = inlineMul[1];
          quantity = q;
        }
      } else {
        const leadQ = rawName.match(leadingQtyRegex);
        if (leadQ) {
          const q = parseQuantity(leadQ[1]);
          if (q !== null && q > 0 && q < 100) {
            quantity = q;
            rawName = leadQ[2];
          }
        }
      }

      // Combine wrapped preceding name lines (e.g. "Energinis gėrimas MONSTER BAD" + "APPLE, 0,5 l")
      const combinedRaw =
        pendingNameParts.length > 0 && !isDiscount
          ? `${pendingNameParts.join(' ')} ${rawName}`.trim()
          : rawName;

      const name = cleanItemName(combinedRaw);
      const letterCount = (name.match(/[A-Za-zÀ-ž]/g) ?? []).length;

      if (letterCount >= 2 && name.length >= 2) {
        items.push({ name, quantity, price });
        pendingNameParts = [];
        continue;
      } else if (pendingNameParts.length > 0 && (isDiscount || Math.abs(price) > 0)) {
        const fallbackName = cleanItemName(pendingNameParts.join(' '));
        if (fallbackName.length >= 2) {
          items.push({ name: fallbackName, quantity, price });
          pendingNameParts = [];
          continue;
        }
      }
    }

    // 4. Otherwise, buffer up to 2 continuation lines as a potential wrapped item name
    if (isLikelyStandaloneItemName(line)) {
      if (pendingNameParts.length >= 2) {
        pendingNameParts = [line];
      } else {
        pendingNameParts.push(line);
      }
    } else {
      pendingNameParts = [];
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

  const lowerMerchant = foldAccents(merchant).toLowerCase();
  const lowerText = foldAccents(text).toLowerCase();

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
    const folded = foldAccents(line);
    if (SUBTOTAL_EXCLUDE_REGEX.test(folded)) continue;
    if (TOTAL_LINE_REGEX.test(folded)) {
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

  // Extract VAT / Tax amount (handles both inline "PVM 21% 1,61" and tabular
  // "Mokestis Suma su PVM Be PVM PVM suma" -> next line "A 21,00 % 12,88 10,64 2,24")
  let bestTax: number | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const folded = foldAccents(line);
    if (TAX_LINE_REGEX.test(folded)) {
      const nums = extractNumbersFromLine(line).filter(
        (n) => bestTotal === null || n <= bestTotal
      );
      if (nums.length > 0) {
        bestTax = nums[nums.length - 1];
        break;
      }
      // Tabular VAT header (e.g. Rimi "Mokestis Suma su PVM Be PVM PVM suma")
      if (i + 1 < lines.length) {
        const nextNums = extractNumbersFromLine(lines[i + 1]).filter(
          (n) => bestTotal === null || n <= bestTotal
        );
        if (nextNums.length > 0) {
          bestTax = nextNums[nextNums.length - 1];
          break;
        }
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
