function normalizeOverlapLine(line: string): string {
  return line
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]/g, '');
}

function linesOverlapMatch(a: string, b: string): boolean {
  const na = normalizeOverlapLine(a);
  const nb = normalizeOverlapLine(b);
  if (na.length < 4 || nb.length < 4) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) {
    const shorter = Math.min(na.length, nb.length);
    const longer = Math.max(na.length, nb.length);
    return shorter / longer >= 0.72;
  }
  // Character bigram similarity for slight OCR noise in overlapping region
  const bigrams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const ba = bigrams(na);
  const bb = bigrams(nb);
  if (ba.size === 0 || bb.size === 0) return false;
  let shared = 0;
  for (const bg of ba) {
    if (bb.has(bg)) shared++;
  }
  const sim = (2 * shared) / (ba.size + bb.size);
  return sim >= 0.76;
}

/**
 * Combines OCR text from multiple sequential photos of a long receipt,
 * automatically trimming overlapping lines between the bottom of page N
 * and the top of page N+1 so items aren't duplicated.
 */
export function stitchReceiptPages(pageTexts: string[]): string {
  const nonEmpty = pageTexts
    .map((txt) =>
      txt
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
    )
    .filter((lines) => lines.length > 0);

  if (nonEmpty.length === 0) return '';
  if (nonEmpty.length === 1) return nonEmpty[0].join('\n');

  const merged: string[] = [...nonEmpty[0]];

  for (let p = 1; p < nonEmpty.length; p++) {
    const nextLines = nonEmpty[p];
    const maxWindow = Math.min(12, merged.length, nextLines.length);
    let dropPrefix = 0;

    // Look for the largest overlap block where bottom of `merged` matches top of `nextLines`
    for (let k = maxWindow; k >= 2; k--) {
      let matches = 0;
      for (let j = 0; j < k; j++) {
        if (linesOverlapMatch(merged[merged.length - k + j], nextLines[j])) {
          matches++;
        }
      }
      if (matches >= Math.ceil(k * 0.7)) {
        dropPrefix = k;
        break;
      }
    }

    // Fallback: single strong matching anchor line within the last 5 lines of page N and first 5 of page N+1
    if (dropPrefix === 0) {
      const tailStart = Math.max(0, merged.length - 5);
      const headLimit = Math.min(5, nextLines.length);
      outer: for (let hi = headLimit - 1; hi >= 0; hi--) {
        if (normalizeOverlapLine(nextLines[hi]).length < 8) continue;
        for (let ti = merged.length - 1; ti >= tailStart; ti--) {
          if (linesOverlapMatch(merged[ti], nextLines[hi])) {
            dropPrefix = hi + 1;
            break outer;
          }
        }
      }
    }

    merged.push(...nextLines.slice(dropPrefix));
  }

  return merged.join('\n');
}
