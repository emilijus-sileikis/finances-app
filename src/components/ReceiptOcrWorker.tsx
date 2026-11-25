import React, { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

export type OcrRotation = 0 | 90 | 180 | 270;

export interface OcrJobPayload {
  id: number;
  kind: 'image' | 'pdf';
  /** For image: data URL (data:image/...;base64,...). For pdf: raw base64 string. */
  data: string;
  /** Tesseract OCR language pack, e.g. 'lit+eng' or 'kor+eng' */
  ocrLang?: string;
  /** Clockwise rotation applied before OCR */
  rotationDeg?: OcrRotation;
  /** Adaptive high-contrast enhancement for paper/thermal receipts */
  highContrast?: boolean;
}

interface ReceiptOcrWorkerProps {
  job: OcrJobPayload | null;
  onProgress: (status: string, progress: number) => void;
  onResult: (text: string, kind: 'image' | 'pdf') => void;
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

  function preprocessImage(dataUrl, rotationDeg, highContrast) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const rot = ((rotationDeg || 0) % 360 + 360) % 360;
          const swapped = rot === 90 || rot === 270;
          const rawW = swapped ? img.height : img.width;
          const rawH = swapped ? img.width : img.height;

          const maxDim = highContrast ? 1800 : 1400;
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
          const pixelCount = outW * outH;

          if (highContrast) {
            // 1. Grayscale + histogram for adaptive white/black level stretching
            const hist = new Uint32Array(256);
            const grays = new Uint8Array(pixelCount);
            for (let i = 0, p = 0; i < d.length; i += 4, p++) {
              const lum = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
              grays[p] = lum;
              hist[lum]++;
            }

            let acc = 0;
            let pLow = 0;
            let pHigh = 255;
            const lowTarget = pixelCount * 0.02;
            const highTarget = pixelCount * 0.90;
            for (let v = 0; v < 256; v++) {
              acc += hist[v];
              if (acc >= lowTarget) { pLow = v; break; }
            }
            acc = 0;
            for (let v = 0; v < 256; v++) {
              acc += hist[v];
              if (acc >= highTarget) { pHigh = v; break; }
            }
            const span = Math.max(24, pHigh - pLow);

            // 2. Stretch & push ink darker while whitening dim/crumpled paper
            for (let i = 0, p = 0; i < d.length; i += 4, p++) {
              let norm = ((grays[p] - pLow) * 255) / span;
              if (norm < 0) norm = 0;
              if (norm > 255) norm = 255;
              let out;
              if (norm < 155) {
                out = norm * 0.72;
              } else {
                out = 215 + ((norm - 155) * 40) / 100;
              }
              out = Math.max(0, Math.min(255, Math.round(out)));
              d[i] = d[i + 1] = d[i + 2] = out;
            }
          } else {
            const contrast = 1.2;
            for (let i = 0; i < d.length; i += 4) {
              let lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
              lum = Math.max(0, Math.min(255, (lum - 128) * contrast + 128));
              d[i] = d[i + 1] = d[i + 2] = lum;
            }
          }

          ctx.putImageData(imgData, 0, 0);
          resolve(canvas.toDataURL('image/jpeg', 0.9));
        } catch (e) {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  async function runImageOcr(jobId, dataUrl, kind, ocrLang, rotationDeg, highContrast) {
    if (typeof Tesseract === 'undefined') {
      post({ type: 'error', jobId, message: 'OCR engine unavailable offline. File is attached — enter details manually or paste text.' });
      return;
    }
    post({
      type: 'progress',
      jobId,
      status: highContrast ? 'Boosting receipt contrast...' : 'Enhancing receipt image...',
      progress: 0.15,
    });
    const cleanedUrl = await preprocessImage(dataUrl, rotationDeg || 0, Boolean(highContrast));

    post({ type: 'progress', jobId, status: 'Reading text on-device...', progress: 0.3 });
    const ocrLogger = (m) => {
      if (m && typeof m.progress === 'number') {
        const pct = Math.min(0.98, 0.3 + m.progress * 0.68);
        post({
          type: 'progress',
          jobId,
          status: m.status === 'recognizing text' ? 'Extracting receipt lines...' : 'Loading on-device OCR...',
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
    post({
      type: 'result',
      jobId,
      kind,
      text: (result && result.data && result.data.text) ? result.data.text : '',
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
      const imgDataUrl = canvas.toDataURL('image/jpeg', 0.9);
      await runImageOcr(jobId, imgDataUrl, 'pdf', ocrLang, 0, highContrast);
    } catch (err) {
      post({
        type: 'error',
        jobId,
        message: (err && err.message) ? 'PDF read error: ' + err.message : 'Could not read PDF text. File is attached.',
      });
    }
  }

  window.startReceiptJob = async function(jobId, kind, data, ocrLang, rotationDeg, highContrast) {
    try {
      if (kind === 'pdf') {
        await runPdfParse(jobId, data, ocrLang, highContrast);
      } else {
        await runImageOcr(jobId, data, 'image', ocrLang, rotationDeg, highContrast);
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
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        onError('Scan timed out — file is attached, you can fill or paste the total below.');
      }, 40000);

      const safeKind = JSON.stringify(payload.kind);
      const safeData = JSON.stringify(payload.data);
      const safeLang = JSON.stringify(payload.ocrLang ?? 'lit+eng');
      const safeRot = Number(payload.rotationDeg ?? 0);
      const safeContrast = Boolean(payload.highContrast ?? true);
      webViewRef.current?.injectJavaScript(`
        window.startReceiptJob(${payload.id}, ${safeKind}, ${safeData}, ${safeLang}, ${safeRot}, ${safeContrast});
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
        onResult(msg.text ?? '', msg.kind ?? job.kind);
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
