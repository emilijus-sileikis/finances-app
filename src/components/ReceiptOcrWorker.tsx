import React, { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

export type OcrRotation = 0 | 90 | 180 | 270;

export interface OcrImagePageInput {
  data: string;
  rotationDeg?: OcrRotation;
}

export interface OcrJobPayload {
  id: number;
  kind: 'image' | 'pdf';
  /** For single image: data URL. For pdf: raw base64 string. */
  data?: string;
  /** For multi-page image scans: ordered array of page data URLs + rotations. */
  pages?: OcrImagePageInput[];
  /** Tesseract OCR language pack, e.g. 'lit+eng' or 'kor+eng' */
  ocrLang?: string;
  /** Clockwise rotation applied before OCR (single-image shortcut) */
  rotationDeg?: OcrRotation;
  /** Local adaptive paper illumination normalization for thermal/paper receipts */
  highContrast?: boolean;
}

interface ReceiptOcrWorkerProps {
  job: OcrJobPayload | null;
  onProgress: (status: string, progress: number) => void;
  onResult: (text: string, kind: 'image' | 'pdf', pageTexts?: string[]) => void;
  onError: (message: string) => void;
}

const OCR_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <script src="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js"></script>
</head>
<body>
<script>
  function post(payload) {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }
  }

  function base64ToUint8Array(base64) {
    const clean = base64.replace(/^data:[^;]+;base64,/, '');
    const binary = atob(clean);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Local adaptive background normalization using an O(W*H) integral image.
   * Flattens uneven shadows/creases on paper receipts while keeping even faint
   * thermal dot-matrix digits crisp black on clean white paper.
   */
  function applyLocalAdaptiveContrast(d, w, h) {
    const count = w * h;
    const gray = new Uint8Array(count);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      gray[p] = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    }

    // Integral image (Float64 to avoid 32-bit overflow on large canvases)
    const stride = w + 1;
    const integral = new Float64Array((h + 1) * stride);
    for (let y = 0; y < h; y++) {
      let rowSum = 0;
      const rowOff = y * w;
      const intRow = (y + 1) * stride;
      const prevRow = y * stride;
      for (let x = 0; x < w; x++) {
        rowSum += gray[rowOff + x];
        integral[intRow + x + 1] = integral[prevRow + x + 1] + rowSum;
      }
    }

    const r = Math.max(18, Math.min(48, Math.round(Math.min(w, h) * 0.04)));

    for (let y = 0; y < h; y++) {
      const y1 = Math.max(0, y - r);
      const y2 = Math.min(h - 1, y + r);
      const topOff = y1 * stride;
      const botOff = (y2 + 1) * stride;
      const rowOff = y * w;

      for (let x = 0; x < w; x++) {
        const x1 = Math.max(0, x - r);
        const x2 = Math.min(w - 1, x + r);
        const area = (x2 - x1 + 1) * (y2 - y1 + 1);
        const sum =
          integral[botOff + x2 + 1] -
          integral[topOff + x2 + 1] -
          integral[botOff + x1] +
          integral[topOff + x1];
        const localBg = Math.max(30, sum / area);

        const g = gray[rowOff + x];
        // Ratio < 1 means darker than local paper; ratio >= 0.96 is paper background
        const ratio = g / localBg;
        let out;
        if (ratio >= 0.96) {
          out = 255;
        } else {
          // Gentle strong ink pull without bleaching light thermal text
          out = Math.max(0, Math.min(255, Math.round(255 - (0.96 - ratio) * 760)));
        }
        const idx = (rowOff + x) * 4;
        d[idx] = d[idx + 1] = d[idx + 2] = out;
      }
    }
  }

  function preprocessImage(dataUrl, rotationDeg, highContrast) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const rot = ((rotationDeg || 0) % 360 + 360) % 360;
          const swapped = rot === 90 || rot === 270;
          const rawW = swapped ? img.height : img.width;
          const rawH = swapped ? img.width : img.height;

          const maxDim = highContrast ? 1800 : 1500;
          let scale = 1;
          if (Math.max(rawW, rawH) > maxDim) {
            scale = maxDim / Math.max(rawW, rawH);
          } else if (highContrast && rawW < 900) {
            scale = Math.min(1.6, 1200 / Math.max(1, rawW));
          }

          const outW = Math.max(1, Math.round(rawW * scale));
          const outH = Math.max(1, Math.round(rawH * scale));
          const drawW = Math.max(1, Math.round(img.width * scale));
          const drawH = Math.max(1, Math.round(img.height * scale));

          const canvas = document.createElement('canvas');
          canvas.width = outW;
          canvas.height = outH;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, outW, outH);

          ctx.save();
          ctx.translate(outW / 2, outH / 2);
          ctx.rotate((rot * Math.PI) / 180);
          ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
          ctx.restore();

          const imgData = ctx.getImageData(0, 0, outW, outH);
          const d = imgData.data;

          if (highContrast) {
            applyLocalAdaptiveContrast(d, outW, outH);
          } else {
            const contrast = 1.15;
            for (let i = 0; i < d.length; i += 4) {
              let lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
              lum = Math.max(0, Math.min(255, (lum - 128) * contrast + 128));
              d[i] = d[i + 1] = d[i + 2] = lum;
            }
          }

          ctx.putImageData(imgData, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } catch (e) {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  async function ocrSingleImage(jobId, dataUrl, ocrLang, rotationDeg, highContrast, pageIndex, totalPages) {
    const pagePrefix = totalPages > 1 ? 'Page ' + (pageIndex + 1) + '/' + totalPages + ': ' : '';
    const basePct = pageIndex / totalPages;
    const spanPct = 1 / totalPages;

    post({
      type: 'progress',
      jobId,
      status: pagePrefix + (highContrast ? 'Enhancing paper contrast...' : 'Preparing receipt image...'),
      progress: Math.min(0.95, 0.1 + basePct * 0.85 + spanPct * 0.12),
    });

    const cleanedUrl = await preprocessImage(dataUrl, rotationDeg || 0, Boolean(highContrast));

    const ocrLogger = (m) => {
      if (m && typeof m.progress === 'number') {
        const pct = Math.min(
          0.98,
          0.12 + basePct * 0.86 + (0.15 + m.progress * 0.85) * spanPct * 0.86
        );
        post({
          type: 'progress',
          jobId,
          status:
            pagePrefix +
            (m.status === 'recognizing text'
              ? 'Extracting receipt lines...'
              : 'Loading on-device OCR...'),
          progress: pct,
        });
      }
    };

    const langPack = ocrLang || 'lit+eng';
    let result;
    try {
      result = await Tesseract.recognize(cleanedUrl, langPack, { logger: ocrLogger });
    } catch {
      result = await Tesseract.recognize(cleanedUrl, 'eng', { logger: ocrLogger });
    }
    return (result && result.data && result.data.text) ? result.data.text : '';
  }

  async function runImagePagesOcr(jobId, pages, kind, ocrLang, highContrast) {
    if (typeof Tesseract === 'undefined') {
      post({
        type: 'error',
        jobId,
        message: 'OCR engine unavailable offline. File is attached — enter details manually or paste text.',
      });
      return;
    }

    const totalPages = pages.length;
    const pageTexts = [];
    for (let i = 0; i < totalPages; i++) {
      const pg = pages[i];
      const txt = await ocrSingleImage(
        jobId,
        pg.data,
        ocrLang,
        pg.rotationDeg || 0,
        highContrast,
        i,
        totalPages
      );
      pageTexts.push(txt);
    }

    post({
      type: 'result',
      jobId,
      kind,
      text: pageTexts.join('\\n'),
      pageTexts,
    });
  }

  async function extractPdfLines(page) {
    const content = await page.getTextContent();
    const rows = [];
    for (const item of content.items || []) {
      if (!item || typeof item.str !== 'string') continue;
      const str = item.str.trim();
      if (!str) continue;
      const y = item.transform ? Math.round(item.transform[5] / 3) * 3 : 0;
      const x = item.transform ? item.transform[4] : 0;
      let row = rows.find((r) => Math.abs(r.y - y) <= 4);
      if (!row) {
        row = { y, parts: [] };
        rows.push(row);
      }
      row.parts.push({ x, str });
    }
    rows.sort((a, b) => b.y - a.y);
    return rows
      .map((r) =>
        r.parts
          .sort((a, b) => a.x - b.x)
          .map((p) => p.str)
          .join(' ')
      )
      .join('\\n');
  }

  async function runPdfParse(jobId, base64Pdf, ocrLang, highContrast) {
    try {
      if (typeof pdfjsLib === 'undefined') {
        post({ type: 'error', jobId, message: 'PDF reader unavailable offline. PDF is attached — enter details manually.' });
        return;
      }
      post({ type: 'progress', jobId, status: 'Opening PDF locally...', progress: 0.15 });
      const bytes = base64ToUint8Array(base64Pdf);
      const loadingTask = pdfjsLib.getDocument({
        data: bytes,
        disableWorker: true,
        useSystemFonts: true,
      });
      const pdf = await loadingTask.promise;
      const pageCount = Math.min(pdf.numPages || 1, 3);
      let fullText = '';

      for (let p = 1; p <= pageCount; p++) {
        post({ type: 'progress', jobId, status: 'Reading PDF page ' + p + '...', progress: 0.2 + (p / pageCount) * 0.4 });
        const page = await pdf.getPage(p);
        const pageText = await extractPdfLines(page);
        if (pageText) fullText += pageText + '\\n';
      }

      if (fullText.trim().length >= 20) {
        post({ type: 'result', jobId, kind: 'pdf', text: fullText.trim() });
        return;
      }

      // Scanned image PDF fallback: render page 1 at high DPI to canvas and OCR it!
      post({ type: 'progress', jobId, status: 'Scanned PDF detected — running OCR...', progress: 0.45 });
      const firstPage = await pdf.getPage(1);
      const viewport = firstPage.getViewport({ scale: 2.5 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      await firstPage.render({ canvasContext: ctx, viewport }).promise;
      const imgDataUrl = canvas.toDataURL('image/png');
      await runImagePagesOcr(jobId, [{ data: imgDataUrl, rotationDeg: 0 }], 'pdf', ocrLang, highContrast);
    } catch (err) {
      post({
        type: 'error',
        jobId,
        message: (err && err.message) ? 'PDF read error: ' + err.message : 'Could not read PDF text. File is attached.',
      });
    }
  }

  window.startReceiptJob = async function(jobId, kind, payloadData, ocrLang, highContrast) {
    try {
      if (kind === 'pdf') {
        await runPdfParse(jobId, payloadData, ocrLang, highContrast);
      } else {
        await runImagePagesOcr(jobId, payloadData, 'image', ocrLang, highContrast);
      }
    } catch (err) {
      post({ type: 'error', jobId, message: (err && err.message) ? err.message : 'Scan failed.' });
    }
  };

  window.addEventListener('load', () => {
    post({ type: 'ready' });
  });
</script>
</body>
</html>`;

export function ReceiptOcrWorker({
  job,
  onProgress,
  onResult,
  onError,
}: ReceiptOcrWorkerProps) {
  const webViewRef = useRef<WebView<Record<string, unknown>>>(null);
  const readyRef = useRef(false);
  const pendingRef = useRef<OcrJobPayload | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dispatchJob = useCallback(
    (payload: OcrJobPayload) => {
      if (!Number.isInteger(payload.id) || (payload.kind !== 'image' && payload.kind !== 'pdf')) {
        return;
      }

      const pages: OcrImagePageInput[] =
        payload.kind === 'image'
          ? payload.pages && payload.pages.length > 0
            ? payload.pages
            : payload.data
              ? [{ data: payload.data, rotationDeg: payload.rotationDeg ?? 0 }]
              : []
          : [];

      if (payload.kind === 'image' && pages.length === 0) return;
      if (payload.kind === 'pdf' && !payload.data) return;

      const timeoutMs = Math.min(120_000, Math.max(45_000, pages.length * 35_000));
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        onError('Scan timed out — file is attached, you can fill or paste the total below.');
      }, timeoutMs);

      const safeKind = JSON.stringify(payload.kind);
      const safePayload = JSON.stringify(payload.kind === 'pdf' ? payload.data : pages);
      const safeLang = JSON.stringify(payload.ocrLang ?? 'lit+eng');
      const safeContrast = Boolean(payload.highContrast ?? true);
      webViewRef.current?.injectJavaScript(`
        window.startReceiptJob(${payload.id}, ${safeKind}, ${safePayload}, ${safeLang}, ${safeContrast});
        true;
      `);
    },
    [onError]
  );

  useEffect(() => {
    if (!job) return;

    if (readyRef.current) {
      dispatchJob(job);
    } else {
      pendingRef.current = job;
    }

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [job, dispatchJob]);

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data) as {
        type: 'ready' | 'progress' | 'result' | 'error';
        jobId?: number;
        kind?: 'image' | 'pdf';
        status?: string;
        progress?: number;
        text?: string;
        pageTexts?: string[];
        message?: string;
      };

      if (msg.type === 'ready') {
        readyRef.current = true;
        if (pendingRef.current) {
          const pending = pendingRef.current;
          pendingRef.current = null;
          dispatchJob(pending);
        }
        return;
      }

      if (!job || msg.jobId !== job.id) return;

      if (msg.type === 'progress') {
        onProgress(msg.status ?? 'Scanning...', msg.progress ?? 0.3);
      } else if (msg.type === 'result') {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        onResult(msg.text ?? '', msg.kind ?? job.kind, msg.pageTexts);
      } else if (msg.type === 'error') {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        onError(msg.message ?? 'Could not scan receipt.');
      }
    } catch {
      // Ignore malformed bridge messages
    }
  };

  return (
    <View style={styles.hidden} pointerEvents="none">
      <WebView<Record<string, unknown>>
        ref={webViewRef}
        source={{ html: OCR_HTML }}
        originWhitelist={['about:*', 'data:*']}
        javaScriptEnabled
        domStorageEnabled
        onMessage={handleMessage}
        onError={() => {
          if (job) {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            onError('Scanner failed to load. You can still type or paste the receipt text.');
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    left: -1000,
    top: -1000,
  },
});
