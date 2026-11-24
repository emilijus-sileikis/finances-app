import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { getCurrencyMeta, type CurrencyCode } from '@/constants/currencies';
import type { CategoryBudget, Expense, RecurringExpense } from '@/types/finance';

function getReceiptsDir(): Directory {
  const dir = new Directory(Paths.document, 'receipts');
  if (!dir.exists) {
    dir.create({ idempotent: true, intermediates: true });
  }
  return dir;
}

export function isPdfUri(uri: string | null | undefined): boolean {
  if (!uri) return false;
  return uri.toLowerCase().split('?')[0].endsWith('.pdf');
}

export async function saveReceiptFromUri(sourceUri: string, forcedExt?: string): Promise<string> {
  const receiptsDir = getReceiptsDir();
  const normalizedUri =
    sourceUri.startsWith('file://') || sourceUri.startsWith('content://')
      ? sourceUri
      : `file://${sourceUri}`;
  const extMatch = normalizedUri.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
  const ext = (forcedExt ?? (extMatch ? extMatch[1] : 'jpg')).toLowerCase();
  const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'pdf'].includes(ext) ? ext : 'jpg';
  const filename = `receipt_${Date.now()}_${Math.floor(Math.random() * 1000)}.${safeExt}`;

  const sourceFile = new File(normalizedUri);
  const destFile = new File(receiptsDir, filename);
  try {
    await sourceFile.copy(destFile, { overwrite: true });
  } catch {
    // Fallback for Android content:// URIs that cannot be copied directly
    const base64 = await sourceFile.base64();
    await destFile.write(base64, { encoding: 'base64' });
  }
  return destFile.uri;
}

export async function readFileAsBase64(uri: string): Promise<string> {
  const file = new File(uri);
  return file.base64();
}

export async function saveReceiptFromBase64(base64Data: string, ext = 'png'): Promise<string> {
  const receiptsDir = getReceiptsDir();
  const stripped = base64Data.replace(/^data:[^;]+;base64,/, '');
  const filename = `receipt_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
  const destFile = new File(receiptsDir, filename);
  await destFile.write(stripped, { encoding: 'base64' });
  return destFile.uri;
}

export async function pickAndSavePdfReceipt(): Promise<{
  uri: string;
  base64: string;
  name: string;
} | null> {
  const picked = await File.pickFileAsync({
    mimeTypes: ['application/pdf'],
    multipleFiles: false,
  });

  if (picked.canceled || !picked.result) return null;

  const pickedFile = picked.result;
  const base64 = await pickedFile.base64();
  const savedUri = await saveReceiptFromBase64(base64, 'pdf');

  return {
    uri: savedUri,
    base64,
    name: pickedFile.name || 'receipt.pdf',
  };
}

export async function openPdfReceipt(uri: string): Promise<void> {
  const file = new File(uri);
  try {
    const canPreview = await file.canPreview();
    if (canPreview) {
      await file.preview({ mimeType: 'application/pdf' });
      return;
    }
  } catch {
    // Fallback to share sheet below
  }

  const available = await Sharing.isAvailableAsync();
  if (available) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Open PDF Receipt',
    });
  }
}

export async function readReceiptAsDataUrl(uri: string): Promise<string> {
  const file = new File(uri);
  const base64 = await file.base64();
  const lower = uri.toLowerCase();
  const mime = lower.endsWith('.pdf')
    ? 'application/pdf'
    : lower.endsWith('.png')
      ? 'image/png'
      : lower.endsWith('.webp')
        ? 'image/webp'
        : 'image/jpeg';
  return `data:${mime};base64,${base64}`;
}

export function deleteReceiptFile(uri: string | null): void {
  if (!uri) return;
  try {
    // Only delete files stored inside this app's own document directory
    if (!uri.startsWith(Paths.document.uri)) return;
    const file = new File(uri);
    if (file.exists) {
      file.delete();
    }
  } catch {
    // Ignore cleanup errors for missing files
  }
}

export async function exportExpensesCsv(
  expenses: Expense[],
  currency: CurrencyCode = 'EUR'
): Promise<boolean> {
  const meta = getCurrencyMeta(currency);
  const header = `Date,Title,Merchant,Category,Amount_${meta.code},Tax_${meta.code},Notes`;
  const escapeCsv = (val: string) => {
    const safe = /^[=+\-@\t\r]/.test(val) ? `'${val}` : val;
    return `"${safe.replace(/"/g, '""')}"`;
  };

  const lines = expenses.map((e) =>
    [
      e.date,
      escapeCsv(e.title),
      escapeCsv(e.merchant),
      e.category,
      e.amount.toFixed(meta.decimals),
      e.taxAmount.toFixed(meta.decimals),
      escapeCsv(e.notes),
    ].join(',')
  );

  const csv = [header, ...lines].join('\n');
  const exportFile = new File(Paths.cache, `finances_export_${Date.now()}.csv`);
  await exportFile.write(csv, { encoding: 'utf8' });

  const available = await Sharing.isAvailableAsync();
  if (!available) return false;

  await Sharing.shareAsync(exportFile.uri, {
    mimeType: 'text/csv',
    dialogTitle: 'Export Expenses CSV',
  });
  return true;
}

export async function exportFullBackupJson(payload: {
  currency: CurrencyCode;
  expenses: Expense[];
  budgets: CategoryBudget[];
  recurring: RecurringExpense[];
}): Promise<boolean> {
  const json = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      ...payload,
    },
    null,
    2
  );

  const exportFile = new File(Paths.cache, `finances_backup_${Date.now()}.json`);
  await exportFile.write(json, { encoding: 'utf8' });

  const available = await Sharing.isAvailableAsync();
  if (!available) return false;

  await Sharing.shareAsync(exportFile.uri, {
    mimeType: 'application/json',
    dialogTitle: 'Export Local Backup JSON',
  });
  return true;
}
