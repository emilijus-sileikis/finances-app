import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { useShareIntentContext } from 'expo-share-intent';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ReceiptOcrWorker,
  type OcrJobPayload,
  type OcrRotation,
} from '@/components/ReceiptOcrWorker';
import {
  fromEditableItems,
  ReceiptItemsEditor,
  toEditableItems,
  type EditableReceiptItem,
} from '@/components/ReceiptItemsEditor';
import {
  CURRENCIES,
  formatCurrency,
  formatEditableAmount,
  getCurrencyMeta,
  type CurrencyCode,
} from '@/constants/currencies';
import { useFinances } from '@/db/FinanceContext';
import { findPotentialDuplicate } from '@/services/duplicateGuard';
import {
  computeUpdatedEurRate,
  convertCurrency,
  detectReceiptCurrency,
  getFriendlyRatePair,
} from '@/services/fxRates';
import { parseReceiptText, suggestCategory } from '@/services/receiptParser';
import { splitReceiptAmounts } from '@/services/receiptSplit';
import {
  deleteReceiptFile,
  encodeReceiptUris,
  isPdfUri,
  openPdfReceipt,
  pickAndSavePdfReceipt,
  readFileAsBase64,
  readReceiptAsDataUrl,
  saveReceiptFromBase64,
  saveReceiptFromUri,
} from '@/services/receiptStorage';
import { stitchReceiptPages } from '@/services/receiptStitcher';
import type { ThemeColors } from '@/theme/colors';
import type { CategoryId, QuickPreset } from '@/types/finance';
import { getTodayIso, isValidIsoDate, parseFlexibleAmount } from '@/utils/format';

interface SplitSnapshot {
  amountText: string;
  taxText: string;
  draftItems: EditableReceiptItem[];
  divisor: number;
}

interface AttachedReceiptPage {
  uri: string;
  rotationDeg: OcrRotation;
}

export default function ScanScreen() {
  const {
    colors: Colors,
    t,
    currency,
    currencyMeta,
    formatMoney,
    fxRates,
    updateFxRate,
    allCategories,
    resolveCategoryMeta,
    resolveCategoryLabel,
    expenses,
    quickPresets,
    addExpense,
    addQuickPreset,
    removeQuickPreset,
    logQuickPreset,
    merchantRules,
    setSelectedMonth,
  } = useFinances();

  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();

  // Scan quality & foreign trip currency state
  const [cropBeforeScan, setCropBeforeScan] = useState(true);
  const [highContrastOcr, setHighContrastOcr] = useState(true);
  const [receiptCurrency, setReceiptCurrency] = useState<CurrencyCode | null>(null);
  const [showFxEditModal, setShowFxEditModal] = useState(false);
  const [fxRateInput, setFxRateInput] = useState('');

  // Receipt files (multi-page images OR single PDF) & OCR/PDF worker state
  const [receiptPages, setReceiptPages] = useState<AttachedReceiptPage[]>([]);
  const [activePageIdx, setActivePageIdx] = useState(0);
  const [pdfUri, setPdfUri] = useState<string | null>(null);
  const [pdfFileName, setPdfFileName] = useState<string | null>(null);
  const [ocrJob, setOcrJob] = useState<OcrJobPayload | null>(null);
  const [ocrScanning, setOcrScanning] = useState(false);
  const [ocrStatus, setOcrStatus] = useState('');
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrNotice, setOcrNotice] = useState<string | null>(null);

  // Raw text drawer
  const [showRawText, setShowRawText] = useState(false);
  const [rawText, setRawText] = useState('');

  // Form fields
  const [amountText, setAmountText] = useState('');
  const [taxText, setTaxText] = useState('');
  const [merchant, setMerchant] = useState('');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(getTodayIso());
  const [category, setCategory] = useState<CategoryId>('groceries');
  const [categoryHint, setCategoryHint] = useState<string | null>(null);
  const [categoryManuallyPicked, setCategoryManuallyPicked] = useState(false);
  const [draftItems, setDraftItems] = useState<EditableReceiptItem[]>([]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Receipt Split state
  const [splitSnapshot, setSplitSnapshot] = useState<SplitSnapshot | null>(null);
  const [showCustomSplit, setShowCustomSplit] = useState(false);
  const [customSplitInput, setCustomSplitInput] = useState('');

  // Quick-Add Preset modal & toast
  const [showAddPreset, setShowAddPreset] = useState(false);
  const [presetTitle, setPresetTitle] = useState('');
  const [presetAmount, setPresetAmount] = useState('');
  const [presetCategory, setPresetCategory] = useState<CategoryId>('dining');
  const [quickToast, setQuickToast] = useState<string | null>(null);

  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const activeCurrency: CurrencyCode = receiptCurrency ?? currency;
  const activeCurrencyMeta = getCurrencyMeta(activeCurrency);
  const isForeignCurrency = activeCurrency !== currency;
  const ocrLang =
    activeCurrency === 'KRW'
      ? 'kor+eng'
      : activeCurrency === 'JPY'
        ? 'jpn+eng'
        : 'lit+eng';

  const applyParsedText = useCallback(
    (text: string) => {
      setRawText(text);
      setSplitSnapshot(null);

      const detected = receiptCurrency === null ? detectReceiptCurrency(text) : null;
      const parseCurr: CurrencyCode =
        receiptCurrency ?? (detected && detected !== currency ? detected : currency);
      if (detected && detected !== currency) {
        setReceiptCurrency(detected);
      }

      const parsed = parseReceiptText(text, merchantRules, parseCurr);

      if (parsed.amount !== null) {
        setAmountText(formatEditableAmount(parsed.amount, parseCurr));
      }
      if (parsed.taxAmount !== null) {
        setTaxText(formatEditableAmount(parsed.taxAmount, parseCurr));
      }
      if (parsed.merchant) {
        setMerchant(parsed.merchant);
        setTitle((prev) => (prev.trim() ? prev : parsed.merchant));
      }
      if (parsed.date) {
        setDate(parsed.date);
      }
      setDraftItems(toEditableItems(parsed.items, parseCurr));
      setCategory(parsed.category);
      setCategoryManuallyPicked(false);
      setCategoryHint(
        t.autoSorted(resolveCategoryLabel(parsed.category), parsed.matchedHint)
      );
    },
    [merchantRules, resolveCategoryLabel, t, currency, receiptCurrency]
  );

  const startOcrForPages = useCallback(
    async (
      pages: AttachedReceiptPage[],
      opts?: {
        customNotice?: string;
        highContrast?: boolean;
        selectIndex?: number;
      }
    ) => {
      const useContrast = opts?.highContrast ?? highContrastOcr;
      setReceiptPages(pages);
      setActivePageIdx(
        opts?.selectIndex !== undefined
          ? Math.max(0, Math.min(opts.selectIndex, pages.length - 1))
          : Math.max(0, pages.length - 1)
      );
      setPdfUri(null);
      setPdfFileName(null);
      setSplitSnapshot(null);
      setOcrNotice(opts?.customNotice ?? null);

      if (pages.length === 0) {
        setOcrScanning(false);
        return;
      }

      setOcrScanning(true);
      setOcrStatus(t.preparingImage);
      setOcrProgress(0.08);
      try {
        const pagePayloads = await Promise.all(
          pages.map(async (p) => ({
            data: await readReceiptAsDataUrl(p.uri),
            rotationDeg: p.rotationDeg,
          }))
        );
        setOcrJob((prev) => ({
          id: (prev?.id ?? 0) + 1,
          kind: 'image',
          pages: pagePayloads,
          ocrLang,
          highContrast: useContrast,
        }));
      } catch {
        setOcrScanning(false);
        setOcrNotice(t.ocrEmptyNotice);
      }
    },
    [t, ocrLang, highContrastOcr]
  );

  const startPdfJob = useCallback(
    (savedUri: string, base64: string, fileName: string, customNotice?: string) => {
      setReceiptPages([]);
      setActivePageIdx(0);
      setPdfUri(savedUri);
      setPdfFileName(fileName);
      setSplitSnapshot(null);
      setOcrNotice(customNotice ?? null);
      setOcrScanning(true);
      setOcrStatus(t.preparingPdf);
      setOcrProgress(0.1);
      setOcrJob((prev) => ({
        id: (prev?.id ?? 0) + 1,
        kind: 'pdf',
        data: base64,
        ocrLang,
        highContrast: highContrastOcr,
      }));
    },
    [t, ocrLang, highContrastOcr]
  );

  // Receive files or text shared directly from Gmail, Gallery, Files, WhatsApp, etc.
  useEffect(() => {
    if (!hasShareIntent) return;

    let cancelled = false;
    (async () => {
      try {
        const files = shareIntent.files ?? [];
        const firstFile = files[0];
        if (firstFile?.path) {
          const firstMime = (firstFile.mimeType ?? '').toLowerCase();
          const firstName = firstFile.fileName || 'shared_receipt';
          const firstIsPdf =
            firstMime.includes('pdf') || firstName.toLowerCase().endsWith('.pdf');

          if (firstIsPdf) {
            const savedUri = await saveReceiptFromUri(firstFile.path, 'pdf');
            const base64 = await readFileAsBase64(savedUri);
            if (!cancelled) {
              startPdfJob(savedUri, base64, firstName, t.sharedFileNotice);
            }
          } else {
            const savedPages: AttachedReceiptPage[] = [];
            for (const f of files.slice(0, 6)) {
              if (!f?.path) continue;
              const mime = (f.mimeType ?? '').toLowerCase();
              if (mime.includes('pdf')) continue;
              const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
              const savedUri = await saveReceiptFromUri(f.path, ext);
              savedPages.push({ uri: savedUri, rotationDeg: 0 });
            }
            if (!cancelled && savedPages.length > 0) {
              await startOcrForPages(savedPages, {
                customNotice: t.sharedFileNotice,
                selectIndex: 0,
              });
            }
          }
        } else if (shareIntent.text?.trim()) {
          if (!cancelled) {
            setShowRawText(true);
            applyParsedText(shareIntent.text);
            setOcrNotice(t.sharedTextNotice);
          }
        }
      } catch {
        if (!cancelled) {
          setOcrNotice(t.alertPdfFailBody);
        }
      } finally {
        resetShareIntent();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    hasShareIntent,
    shareIntent,
    resetShareIntent,
    startPdfJob,
    startOcrForPages,
    applyParsedText,
    t,
  ]);

  const handleTakePhoto = async (appendPage = false) => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t.alertCamTitle, t.alertCamBody);
      return;
    }

    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: cropBeforeScan,
      quality: 0.85,
    });

    if (res.canceled || !res.assets[0]) return;
    const saved = await saveReceiptFromUri(res.assets[0].uri);
    const nextPages = appendPage
      ? [...receiptPages, { uri: saved, rotationDeg: 0 as OcrRotation }]
      : [{ uri: saved, rotationDeg: 0 as OcrRotation }];
    await startOcrForPages(nextPages);
  };

  const handlePickGallery = async (appendPage = false) => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t.alertPhotosTitle, t.alertPhotosBody);
      return;
    }

    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: cropBeforeScan,
      allowsMultipleSelection: !cropBeforeScan,
      selectionLimit: 6,
      quality: 0.85,
    });

    if (res.canceled || !res.assets || res.assets.length === 0) return;
    const newlySaved: AttachedReceiptPage[] = [];
    for (const asset of res.assets.slice(0, 6)) {
      const saved = await saveReceiptFromUri(asset.uri);
      newlySaved.push({ uri: saved, rotationDeg: 0 });
    }
    const nextPages = appendPage ? [...receiptPages, ...newlySaved] : newlySaved;
    await startOcrForPages(nextPages, {
      selectIndex: appendPage ? nextPages.length - 1 : 0,
    });
  };

  const handleRotateActiveAndRescan = async () => {
    if (receiptPages.length === 0) return;
    const safeIdx = Math.min(activePageIdx, receiptPages.length - 1);
    const nextPages = receiptPages.map((pg, idx) =>
      idx === safeIdx
        ? { ...pg, rotationDeg: (((pg.rotationDeg + 90) % 360) as OcrRotation) }
        : pg
    );
    await startOcrForPages(nextPages, {
      highContrast: highContrastOcr,
      selectIndex: safeIdx,
    });
  };

  const handleRescanCurrent = async (overrideContrast?: boolean) => {
    if (receiptPages.length === 0) return;
    const contrastToUse = overrideContrast ?? highContrastOcr;
    await startOcrForPages(receiptPages, {
      highContrast: contrastToUse,
      selectIndex: activePageIdx,
    });
  };

  const handleRemovePage = async (idxToRemove: number) => {
    const target = receiptPages[idxToRemove];
    if (target) deleteReceiptFile(target.uri);
    const nextPages = receiptPages.filter((_, idx) => idx !== idxToRemove);
    if (nextPages.length === 0) {
      setReceiptPages([]);
      setActivePageIdx(0);
      return;
    }
    await startOcrForPages(nextPages, {
      highContrast: highContrastOcr,
      selectIndex: Math.min(idxToRemove, nextPages.length - 1),
    });
  };

  const handlePickPdf = async () => {
    try {
      const picked = await pickAndSavePdfReceipt();
      if (!picked) return;
      startPdfJob(picked.uri, picked.base64, picked.name);
    } catch {
      setOcrScanning(false);
      Alert.alert(t.alertPdfFailTitle, t.alertPdfFailBody);
    }
  };

  const handlePasteClipboard = async () => {
    try {
      const hasImg = await Clipboard.hasImageAsync();
      if (hasImg) {
        const clipImg = await Clipboard.getImageAsync({ format: 'png' });
        if (clipImg?.data) {
          const saved = await saveReceiptFromBase64(clipImg.data, 'png');
          await startOcrForPages([{ uri: saved, rotationDeg: 0 }]);
          return;
        }
      }

      const hasStr = await Clipboard.hasStringAsync();
      if (hasStr) {
        const text = await Clipboard.getStringAsync();
        if (text.trim()) {
          setShowRawText(true);
          applyParsedText(text);
          setOcrNotice(t.pastedTextNotice);
          return;
        }
      }

      Alert.alert(t.alertClipEmptyTitle, t.alertClipEmptyBody);
    } catch {
      Alert.alert(t.alertPasteFailTitle, t.alertPasteFailBody);
    }
  };

  // --- Quick-Add Presets ---

  const handleTapPreset = async (preset: QuickPreset) => {
    await logQuickPreset(preset);
    setQuickToast(t.quickAddLoggedToast(preset.title, formatMoney(preset.amount)));
    setTimeout(() => setQuickToast(null), 2600);
  };

  const handleDeletePreset = (preset: QuickPreset) => {
    Alert.alert(t.quickAddDeleteTitle, t.quickAddDeleteBody(preset.title), [
      { text: t.cancel, style: 'cancel' },
      { text: t.delete, style: 'destructive', onPress: () => removeQuickPreset(preset.id) },
    ]);
  };

  const handleCreatePreset = async () => {
    const amt = parseFlexibleAmount(presetAmount);
    if (!presetTitle.trim() || amt === null || amt <= 0) {
      Alert.alert(t.alertAmountTitle, t.alertAmountBody);
      return;
    }
    await addQuickPreset({
      title: presetTitle.trim(),
      amount: amt,
      category: presetCategory,
    });
    setPresetTitle('');
    setPresetAmount('');
    setShowAddPreset(false);
  };

  // --- Receipt Split ---

  const handleApplySplit = (divisor: number) => {
    const baseAmountText = splitSnapshot ? splitSnapshot.amountText : amountText;
    const baseTaxText = splitSnapshot ? splitSnapshot.taxText : taxText;
    const baseItems = splitSnapshot ? splitSnapshot.draftItems : draftItems;

    const amt = parseFlexibleAmount(baseAmountText);
    if (amt === null || amt <= 0) return;

    const tax = baseTaxText.trim() ? parseFlexibleAmount(baseTaxText) ?? 0 : 0;
    const itemPrices = baseItems.map((it) => parseFlexibleAmount(it.priceText, true) ?? 0);

    const result = splitReceiptAmounts({
      amount: amt,
      taxAmount: tax,
      itemPrices,
      divisor,
      currency: activeCurrency,
    });

    setSplitSnapshot({
      amountText: baseAmountText,
      taxText: baseTaxText,
      draftItems: baseItems,
      divisor,
    });
    setAmountText(formatEditableAmount(result.amount, activeCurrency));
    if (tax > 0) {
      setTaxText(formatEditableAmount(result.taxAmount, activeCurrency));
    }
    if (baseItems.length > 0) {
      setDraftItems(
        baseItems.map((it, idx) => ({
          ...it,
          priceText: formatEditableAmount(result.itemPrices[idx] ?? 0, activeCurrency),
        }))
      );
    }
  };

  const handleUndoSplit = () => {
    if (!splitSnapshot) return;
    setAmountText(splitSnapshot.amountText);
    setTaxText(splitSnapshot.taxText);
    setDraftItems(splitSnapshot.draftItems);
    setSplitSnapshot(null);
  };

  const handleCustomSplitSubmit = () => {
    const num = Math.round(Number(customSplitInput.trim()));
    if (!Number.isFinite(num) || num < 2 || num > 20) return;
    handleApplySplit(num);
    setCustomSplitInput('');
    setShowCustomSplit(false);
  };

  const handleMerchantChange = (val: string) => {
    setMerchant(val);
    if (!categoryManuallyPicked && val.trim().length >= 2) {
      const suggestion = suggestCategory(rawText, val, merchantRules);
      if (suggestion.confidence !== 'fallback') {
        setCategory(suggestion.category);
        setCategoryHint(
          t.autoSorted(
            resolveCategoryLabel(suggestion.category),
            suggestion.matchedHint
          )
        );
      }
    }
  };

  const resetForm = (deleteAttachedFile = false) => {
    if (deleteAttachedFile) {
      if (pdfUri) deleteReceiptFile(pdfUri);
      for (const p of receiptPages) {
        deleteReceiptFile(p.uri);
      }
    }
    setReceiptPages([]);
    setActivePageIdx(0);
    setPdfUri(null);
    setPdfFileName(null);
    setReceiptCurrency(null);
    setOcrJob(null);
    setOcrScanning(false);
    setOcrStatus('');
    setOcrProgress(0);
    setOcrNotice(null);
    setRawText('');
    setShowRawText(false);
    setAmountText('');
    setTaxText('');
    setMerchant('');
    setTitle('');
    setDate(getTodayIso());
    setCategory('groceries');
    setCategoryHint(null);
    setCategoryManuallyPicked(false);
    setDraftItems([]);
    setSplitSnapshot(null);
    setNotes('');
  };

  const openQuickFxEdit = () => {
    if (!isForeignCurrency) return;
    const pair = getFriendlyRatePair(currency, activeCurrency, fxRates);
    setFxRateInput(String(pair.value));
    setShowFxEditModal(true);
  };

  const handleSaveQuickFxRate = async () => {
    if (!isForeignCurrency) return;
    const parsed = parseFlexibleAmount(fxRateInput);
    if (parsed === null || parsed <= 0) {
      Alert.alert(t.alertAmountTitle, t.alertAmountBody);
      return;
    }
    const pair = getFriendlyRatePair(currency, activeCurrency, fxRates);
    const updated = computeUpdatedEurRate(pair.unitCode, pair.quoteCode, parsed, fxRates);
    if (updated) {
      await updateFxRate(updated.code, updated.eurRate);
    }
    setShowFxEditModal(false);
  };

  const commitExpense = async (
    cleanTitle: string,
    cleanMerchant: string,
    finalAmount: number,
    finalTax: number,
    cleanDate: string,
    originalForeignAmount: number | null
  ) => {
    setSaving(true);
    try {
      const splitNote = splitSnapshot ? `Split ÷${splitSnapshot.divisor}` : '';
      const fxNote =
        originalForeignAmount !== null && isForeignCurrency
          ? t.fxOriginalNote(formatCurrency(originalForeignAmount, activeCurrency))
          : '';
      const combinedNotes = [notes.trim(), fxNote, splitNote].filter(Boolean).join(' • ');

      const rawItems = fromEditableItems(draftItems);
      const convertedItems = isForeignCurrency
        ? rawItems.map((it) => ({
            ...it,
            price: convertCurrency(it.price, activeCurrency, currency, fxRates),
          }))
        : rawItems;

      const storedReceiptUri = pdfUri
        ? pdfUri
        : encodeReceiptUris(receiptPages.map((p) => p.uri));

      await addExpense({
        title: cleanTitle,
        merchant: cleanMerchant,
        amount: finalAmount,
        taxAmount: finalTax,
        category,
        date: cleanDate,
        notes: combinedNotes,
        receiptUri: storedReceiptUri,
        rawOcrText: rawText.trim() || null,
        items: convertedItems,
      });
      setSelectedMonth(cleanDate.slice(0, 7));
      Alert.alert(
        t.alertSavedTitle,
        t.alertSavedBody(
          cleanTitle,
          formatMoney(finalAmount),
          resolveCategoryLabel(category)
        )
      );
      resetForm(false);
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    const parsedAmount = parseFlexibleAmount(amountText);
    if (parsedAmount === null || parsedAmount <= 0) {
      Alert.alert(t.alertAmountTitle, t.alertAmountBody);
      return;
    }

    const parsedTax = taxText.trim() ? parseFlexibleAmount(taxText) ?? 0 : 0;
    const finalAmount = isForeignCurrency
      ? convertCurrency(parsedAmount, activeCurrency, currency, fxRates)
      : parsedAmount;
    const finalTax = isForeignCurrency
      ? convertCurrency(parsedTax, activeCurrency, currency, fxRates)
      : parsedTax;

    const cleanDate = isValidIsoDate(date) ? date.trim() : getTodayIso();
    const cleanMerchant = merchant.trim();
    const cleanTitle =
      title.trim() || cleanMerchant || resolveCategoryLabel(category);

    // Duplicate receipt guard (compares in main currency)
    const duplicate = findPotentialDuplicate(
      expenses,
      {
        amount: finalAmount,
        date: cleanDate,
        merchant: cleanMerchant,
        title: cleanTitle,
      },
      currency
    );

    if (duplicate) {
      Alert.alert(
        t.duplicateTitle,
        t.duplicateBody(duplicate.title, formatMoney(duplicate.amount), duplicate.date),
        [
          { text: t.cancel, style: 'cancel' },
          {
            text: t.saveAnyway,
            onPress: () => {
              void commitExpense(
                cleanTitle,
                cleanMerchant,
                finalAmount,
                finalTax,
                cleanDate,
                isForeignCurrency ? parsedAmount : null
              );
            },
          },
        ]
      );
      return;
    }

    await commitExpense(
      cleanTitle,
      cleanMerchant,
      finalAmount,
      finalTax,
      cleanDate,
      isForeignCurrency ? parsedAmount : null
    );
  };

  const handleOcrProgress = useCallback((status: string, progress: number) => {
    setOcrStatus(status);
    setOcrProgress(progress);
  }, []);

  const handleOcrResult = useCallback(
    (text: string, kind: 'image' | 'pdf', pageTexts?: string[]) => {
      setOcrScanning(false);
      setOcrProgress(1);
      const stitched =
        pageTexts && pageTexts.length > 1 ? stitchReceiptPages(pageTexts) : text;
      if (stitched.trim().length < 4) {
        setOcrNotice(t.ocrEmptyNotice);
        return;
      }
      applyParsedText(stitched);
      setOcrNotice(kind === 'pdf' ? t.pdfDoneNotice : t.ocrDoneNotice);
    },
    [applyParsedText, t]
  );

  const handleOcrError = useCallback((msg: string) => {
    setOcrScanning(false);
    setOcrNotice(msg);
  }, []);

  const hasPdf = isPdfUri(pdfUri);
  const hasAttachment = Boolean(pdfUri) || receiptPages.length > 0;
  const activePage =
    receiptPages.length > 0
      ? receiptPages[Math.min(activePageIdx, receiptPages.length - 1)]
      : null;
  const currentParsedAmount = parseFlexibleAmount(amountText);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.pageTitle}>{t.scanTitle}</Text>
              <Text style={styles.pageSub}>{t.scanSub}</Text>
            </View>
            {(hasAttachment || amountText || merchant) && (
              <Pressable onPress={() => resetForm(true)} style={styles.clearBtn}>
                <Text style={styles.clearBtnText}>{t.clear}</Text>
              </Pressable>
            )}
          </View>

          {/* 4 Capture Actions: Camera, Gallery, PDF, Paste */}
          <View style={styles.captureRow}>
            <Pressable onPress={() => void handleTakePhoto(false)} style={styles.captureCard}>
              <View style={[styles.captureIcon, { backgroundColor: Colors.primarySoft }]}>
                <Ionicons name="camera-outline" size={22} color={Colors.primary} />
              </View>
              <Text style={styles.captureTitle}>{t.camera}</Text>
              <Text style={styles.captureSub} numberOfLines={1}>
                {t.snapReceipt}
              </Text>
            </Pressable>

            <Pressable onPress={() => void handlePickGallery(false)} style={styles.captureCard}>
              <View style={[styles.captureIcon, { backgroundColor: Colors.accentSoft }]}>
                <Ionicons name="image-outline" size={22} color={Colors.accent} />
              </View>
              <Text style={styles.captureTitle}>{t.gallery}</Text>
              <Text style={styles.captureSub} numberOfLines={1}>
                {t.pickPhoto}
              </Text>
            </Pressable>

            <Pressable onPress={handlePickPdf} style={styles.captureCard}>
              <View style={[styles.captureIcon, { backgroundColor: Colors.dangerSoft }]}>
                <Ionicons name="document-text-outline" size={22} color={Colors.danger} />
              </View>
              <Text style={styles.captureTitle}>{t.pdf}</Text>
              <Text style={styles.captureSub} numberOfLines={1}>
                {t.uploadPdf}
              </Text>
            </Pressable>

            <Pressable onPress={handlePasteClipboard} style={styles.captureCard}>
              <View style={[styles.captureIcon, { backgroundColor: Colors.purpleSoft }]}>
                <Ionicons name="clipboard-outline" size={22} color={Colors.purple} />
              </View>
              <Text style={styles.captureTitle}>{t.paste}</Text>
              <Text style={styles.captureSub} numberOfLines={1}>
                {t.imageOrText}
              </Text>
            </Pressable>
          </View>

          {/* OCR Options Strip: Crop before scan + High-Contrast Paper OCR */}
          <View style={styles.ocrOptionsRow}>
            <Pressable
              onPress={() => setCropBeforeScan((v) => !v)}
              style={[styles.ocrOptPill, cropBeforeScan && styles.ocrOptPillActive]}
            >
              <Ionicons
                name="crop-outline"
                size={14}
                color={cropBeforeScan ? Colors.primary : Colors.textMuted}
              />
              <Text
                style={[
                  styles.ocrOptText,
                  cropBeforeScan && { color: Colors.primary },
                ]}
              >
                {t.cropPhotoToggle}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setHighContrastOcr((v) => !v)}
              style={[styles.ocrOptPill, highContrastOcr && styles.ocrOptPillActive]}
            >
              <Ionicons
                name="contrast-outline"
                size={14}
                color={highContrastOcr ? Colors.primary : Colors.textMuted}
              />
              <Text
                style={[
                  styles.ocrOptText,
                  highContrastOcr && { color: Colors.primary },
                ]}
              >
                {t.highContrastToggle}
              </Text>
            </Pressable>
          </View>

          {/* 1-Tap Quick-Add Presets */}
          <View style={styles.quickCard}>
            <View style={styles.quickHeader}>
              <View style={styles.quickTitleRow}>
                <Ionicons name="flash-outline" size={14} color={Colors.primary} />
                <Text style={styles.quickTitle}>{t.quickAddLabel}</Text>
              </View>
              <Pressable onPress={() => setShowAddPreset(true)} style={styles.quickNewBtn}>
                <Ionicons name="add" size={14} color={Colors.primary} />
                <Text style={styles.quickNewText}>{t.quickAddNewBtn}</Text>
              </Pressable>
            </View>

            {quickToast && (
              <View style={styles.quickToast}>
                <Ionicons name="checkmark-circle" size={15} color={Colors.primary} />
                <Text style={styles.quickToastText}>{quickToast}</Text>
              </View>
            )}

            {quickPresets.length === 0 ? (
              <Text style={styles.quickEmpty}>{t.quickAddEmpty}</Text>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.quickChipsRow}
              >
                {quickPresets.map((preset) => {
                  const meta = resolveCategoryMeta(preset.category);
                  return (
                    <Pressable
                      key={preset.id}
                      onPress={() => handleTapPreset(preset)}
                      onLongPress={() => handleDeletePreset(preset)}
                      style={styles.quickChip}
                    >
                      <Ionicons name={meta.icon} size={14} color={meta.color} />
                      <Text style={styles.quickChipTitle}>{preset.title}</Text>
                      <Text style={styles.quickChipAmt}>{formatMoney(preset.amount)}</Text>
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation();
                          handleDeletePreset(preset);
                        }}
                        hitSlop={6}
                      >
                        <Ionicons name="close" size={13} color={Colors.textMuted} />
                      </Pressable>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
          </View>

          {/* Receipt Preview (Multi-Page Images or PDF) */}
          {hasAttachment &&
            (hasPdf && pdfUri ? (
              <View style={styles.pdfPreviewCard}>
                <View style={styles.pdfIconBadge}>
                  <Ionicons name="document-text" size={24} color={Colors.danger} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pdfPreviewTitle} numberOfLines={1}>
                    {pdfFileName || pdfUri.split('/').pop()}
                  </Text>
                  <Text style={styles.attachedText}>{t.pdfSavedLocal}</Text>
                </View>
                <Pressable
                  onPress={() => openPdfReceipt(pdfUri)}
                  style={styles.openPdfBtn}
                >
                  <Text style={styles.openPdfBtnText}>{t.openPdf}</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    deleteReceiptFile(pdfUri);
                    setPdfUri(null);
                    setPdfFileName(null);
                  }}
                  style={styles.removeImgBtn}
                >
                  <Ionicons name="trash-outline" size={16} color={Colors.danger} />
                </Pressable>
              </View>
            ) : activePage ? (
              <View style={styles.previewCard}>
                <View style={styles.previewImgWrap}>
                  <Image
                    source={{ uri: activePage.uri }}
                    style={[
                      styles.previewImg,
                      activePage.rotationDeg !== 0 && {
                        transform: [{ rotate: `${activePage.rotationDeg}deg` }],
                      },
                    ]}
                    resizeMode="contain"
                  />
                </View>
                <View style={styles.previewOverlayRow}>
                  <View style={styles.attachedPill}>
                    <Ionicons name="checkmark-circle" size={14} color={Colors.primary} />
                    <Text style={styles.attachedText}>
                      {receiptPages.length > 1
                        ? t.receiptPagesCount(receiptPages.length)
                        : t.receiptSavedLocal}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => {
                      for (const p of receiptPages) deleteReceiptFile(p.uri);
                      setReceiptPages([]);
                      setActivePageIdx(0);
                    }}
                    style={styles.removeImgBtn}
                  >
                    <Ionicons name="trash-outline" size={15} color={Colors.danger} />
                  </Pressable>
                </View>

                {/* Page Switcher Strip + Add Another Page for long receipts */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.pagesStrip}
                >
                  {receiptPages.map((pg, idx) => {
                    const isSelected = idx === Math.min(activePageIdx, receiptPages.length - 1);
                    return (
                      <Pressable
                        key={pg.uri}
                        onPress={() => setActivePageIdx(idx)}
                        style={[
                          styles.pageThumbPill,
                          isSelected && styles.pageThumbPillActive,
                        ]}
                      >
                        <Image source={{ uri: pg.uri }} style={styles.pageMiniThumb} />
                        <Text
                          style={[
                            styles.pageThumbText,
                            isSelected && { color: Colors.primary, fontWeight: '800' },
                          ]}
                        >
                          {t.pageLabel(idx + 1)}
                        </Text>
                        <Pressable
                          onPress={(e) => {
                            e.stopPropagation();
                            void handleRemovePage(idx);
                          }}
                          hitSlop={6}
                        >
                          <Ionicons name="close" size={13} color={Colors.textMuted} />
                        </Pressable>
                      </Pressable>
                    );
                  })}

                  <Pressable
                    onPress={() => void handleTakePhoto(true)}
                    disabled={ocrScanning}
                    style={styles.addPageBtn}
                  >
                    <Ionicons name="camera-outline" size={14} color={Colors.primary} />
                    <Text style={styles.addPageText}>{t.addPageCamera}</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => void handlePickGallery(true)}
                    disabled={ocrScanning}
                    style={styles.addPageBtn}
                  >
                    <Ionicons name="images-outline" size={14} color={Colors.accent} />
                    <Text style={[styles.addPageText, { color: Colors.accent }]}>
                      {t.addPageGallery}
                    </Text>
                  </Pressable>
                </ScrollView>

                <View style={styles.previewToolsRow}>
                  <Pressable
                    onPress={() => void handleRotateActiveAndRescan()}
                    disabled={ocrScanning}
                    style={styles.previewToolBtn}
                  >
                    <Ionicons name="refresh-outline" size={14} color={Colors.accent} />
                    <Text style={styles.previewToolText}>
                      {t.rotateRescanBtn}
                      {activePage.rotationDeg > 0 ? ` (${activePage.rotationDeg}°)` : ''}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      const next = !highContrastOcr;
                      setHighContrastOcr(next);
                      void handleRescanCurrent(next);
                    }}
                    disabled={ocrScanning}
                    style={[
                      styles.previewToolBtn,
                      highContrastOcr && styles.previewToolBtnActive,
                    ]}
                  >
                    <Ionicons
                      name="contrast-outline"
                      size={14}
                      color={highContrastOcr ? Colors.primary : Colors.textSecondary}
                    />
                    <Text
                      style={[
                        styles.previewToolText,
                        highContrastOcr && { color: Colors.primary },
                      ]}
                    >
                      {highContrastOcr ? t.contrastOnTag : t.contrastOffTag}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null)}

          {ocrScanning && (
            <View style={styles.progressCard}>
              <View style={styles.progressTop}>
                <Ionicons name="scan-outline" size={16} color={Colors.primary} />
                <Text style={styles.progressText}>{ocrStatus || t.scanningReceipt}</Text>
                <Text style={styles.progressPct}>{Math.round(ocrProgress * 100)}%</Text>
              </View>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${Math.max(8, Math.round(ocrProgress * 100))}%` },
                  ]}
                />
              </View>
            </View>
          )}

          {ocrNotice && !ocrScanning && (
            <View style={styles.noticePill}>
              <Ionicons name="information-circle-outline" size={16} color={Colors.accent} />
              <Text style={styles.noticeText}>{ocrNotice}</Text>
            </View>
          )}

          {/* Raw Text Paste / Inspect Toggle */}
          <Pressable
            onPress={() => setShowRawText((v) => !v)}
            style={styles.rawToggle}
          >
            <Ionicons name="document-text-outline" size={16} color={Colors.textSecondary} />
            <Text style={styles.rawToggleText}>
              {showRawText ? t.hideRawText : t.showRawText}
            </Text>
            <Ionicons
              name={showRawText ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={Colors.textSecondary}
            />
          </Pressable>

          {showRawText && (
            <View style={styles.rawBox}>
              <TextInput
                value={rawText}
                onChangeText={setRawText}
                multiline
                placeholder={t.rawPlaceholder}
                placeholderTextColor={Colors.textMuted}
                style={styles.rawInput}
              />
              <Pressable
                onPress={() => {
                  if (rawText.trim()) applyParsedText(rawText);
                }}
                style={styles.parseBtn}
              >
                <Ionicons name="flash-outline" size={16} color={Colors.primary} />
                <Text style={styles.parseBtnText}>{t.autoParseBtn}</Text>
              </Pressable>
            </View>
          )}

          {/* Expense Form */}
          <View style={styles.formCard}>
            {/* Trip / Foreign Currency Picker */}
            <View style={styles.fxPickerRow}>
              <Text style={styles.fxPickerLabel}>{t.receiptCurrencyLabel}</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.fxChipsRow}
              >
                {CURRENCIES.map((cur) => {
                  const selected = activeCurrency === cur.code;
                  return (
                    <Pressable
                      key={cur.code}
                      onPress={() => {
                        setReceiptCurrency(cur.code === currency ? null : cur.code);
                        if (splitSnapshot) setSplitSnapshot(null);
                      }}
                      style={[
                        styles.fxChip,
                        selected && styles.fxChipActive,
                        selected && cur.code !== currency && styles.fxChipForeign,
                      ]}
                    >
                      <Text
                        style={[
                          styles.fxChipText,
                          selected && {
                            color: cur.code !== currency ? Colors.accent : Colors.primary,
                            fontWeight: '800',
                          },
                        ]}
                      >
                        {cur.symbol} {cur.code}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            <View style={styles.amountRow}>
              <View style={{ flex: 1.3 }}>
                <Text style={styles.label}>
                  {t.totalAmountLabel(activeCurrencyMeta.symbol)}
                </Text>
                <View style={styles.euroInputWrap}>
                  <Text style={styles.euroSign}>{activeCurrencyMeta.symbol}</Text>
                  <TextInput
                    value={amountText}
                    onChangeText={(val) => {
                      setAmountText(val);
                      if (splitSnapshot) setSplitSnapshot(null);
                    }}
                    keyboardType="decimal-pad"
                    placeholder={activeCurrencyMeta.decimals === 0 ? '0' : '0.00'}
                    placeholderTextColor={Colors.textMuted}
                    style={styles.amountInput}
                  />
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>
                  {t.taxVatLabel(activeCurrencyMeta.symbol)}
                </Text>
                <View style={styles.euroInputWrap}>
                  <Text style={[styles.euroSign, { fontSize: 16 }]}>
                    {activeCurrencyMeta.symbol}
                  </Text>
                  <TextInput
                    value={taxText}
                    onChangeText={setTaxText}
                    keyboardType="decimal-pad"
                    placeholder={activeCurrencyMeta.decimals === 0 ? '0' : '0.00'}
                    placeholderTextColor={Colors.textMuted}
                    style={[styles.amountInput, { fontSize: 18 }]}
                  />
                </View>
              </View>
            </View>

            {/* Live Offline Foreign-Currency Conversion Banner */}
            {isForeignCurrency && (
              <View style={styles.fxBanner}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.fxBannerMain}>
                    {currentParsedAmount && currentParsedAmount > 0
                      ? `${formatCurrency(currentParsedAmount, activeCurrency)}  →  ${formatMoney(
                          convertCurrency(
                            currentParsedAmount,
                            activeCurrency,
                            currency,
                            fxRates
                          )
                        )}`
                      : t.fxBannerHint(activeCurrency, currency)}
                  </Text>
                  <Text style={styles.fxBannerSub}>
                    {getFriendlyRatePair(currency, activeCurrency, fxRates).formatted}
                  </Text>
                </View>
                <Pressable onPress={openQuickFxEdit} style={styles.fxEditBtn}>
                  <Text style={styles.fxEditBtnText}>{t.fxEditRateBtn}</Text>
                </Pressable>
              </View>
            )}

            {/* Receipt Split Bar (visible whenever an amount is entered) */}
            {currentParsedAmount !== null && currentParsedAmount > 0 && (
              <View style={styles.splitRow}>
                {splitSnapshot ? (
                  <>
                    <View style={styles.splitAppliedPill}>
                      <Ionicons name="people-outline" size={13} color={Colors.accent} />
                      <Text style={styles.splitAppliedText}>
                        {t.splitApplied(splitSnapshot.divisor)}
                      </Text>
                    </View>
                    <Pressable onPress={handleUndoSplit} style={styles.splitUndoBtn}>
                      <Ionicons name="arrow-undo-outline" size={13} color={Colors.text} />
                      <Text style={styles.splitUndoText}>{t.splitUndo}</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Text style={styles.splitLabel}>{t.splitLabel}</Text>
                    {[2, 3, 4].map((n) => (
                      <Pressable
                        key={n}
                        onPress={() => handleApplySplit(n)}
                        style={styles.splitBtn}
                      >
                        <Text style={styles.splitBtnText}>÷{n}</Text>
                      </Pressable>
                    ))}
                    <Pressable
                      onPress={() => setShowCustomSplit(true)}
                      style={styles.splitBtn}
                    >
                      <Text style={styles.splitBtnText}>{t.splitCustom}</Text>
                    </Pressable>
                  </>
                )}
              </View>
            )}

            <Text style={styles.label}>{t.merchantLabel}</Text>
            <TextInput
              value={merchant}
              onChangeText={handleMerchantChange}
              placeholder={t.merchantPlaceholder}
              placeholderTextColor={Colors.textMuted}
              style={styles.input}
            />

            <View style={styles.row}>
              <View style={{ flex: 1.3 }}>
                <Text style={styles.label}>{t.titleOptionalLabel}</Text>
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  placeholder={t.titlePlaceholder}
                  placeholderTextColor={Colors.textMuted}
                  style={styles.input}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>{t.dateLabel}</Text>
                <TextInput
                  value={date}
                  onChangeText={setDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={Colors.textMuted}
                  style={styles.input}
                />
              </View>
            </View>

            <View style={styles.catHeaderRow}>
              <Text style={styles.label}>{t.categoryLabel}</Text>
              {categoryHint && <Text style={styles.autoTag}>{categoryHint}</Text>}
            </View>

            <View style={styles.catGrid}>
              {allCategories.map((c) => {
                const selected = category === c.id;
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => {
                      setCategory(c.id);
                      setCategoryManuallyPicked(true);
                      setCategoryHint(null);
                    }}
                    style={[
                      styles.catChip,
                      selected && {
                        borderColor: c.color,
                        backgroundColor: `${c.color}24`,
                      },
                    ]}
                  >
                    <Ionicons
                      name={c.icon}
                      size={15}
                      color={selected ? c.color : Colors.textSecondary}
                    />
                    <Text
                      style={[
                        styles.catChipText,
                        selected && { color: Colors.text, fontWeight: '700' },
                      ]}
                    >
                      {resolveCategoryLabel(c.id)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Itemized Receipt Breakdown */}
            <ReceiptItemsEditor
              items={draftItems}
              onChange={setDraftItems}
              receiptTotal={currentParsedAmount}
              currencyOverride={activeCurrency}
              onApplyItemsSum={(sum) =>
                setAmountText(formatEditableAmount(sum, activeCurrency))
              }
            />

            <Text style={styles.label}>{t.notesOptionalLabel}</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder={t.notesPlaceholder}
              placeholderTextColor={Colors.textMuted}
              style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]}
              multiline
            />

            <Pressable
              onPress={handleSave}
              disabled={saving}
              style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            >
              <Ionicons name="checkmark-circle-outline" size={20} color={Colors.white} />
              <Text style={styles.saveBtnText}>
                {saving ? t.saving : t.saveExpense}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Add Quick-Add Preset Modal */}
      <Modal
        visible={showAddPreset}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAddPreset(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t.quickAddModalTitle}</Text>
              <Pressable onPress={() => setShowAddPreset(false)}>
                <Ionicons name="close" size={22} color={Colors.text} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.modalBody}>
              <Text style={styles.label}>{t.titleLabel} *</Text>
              <TextInput
                value={presetTitle}
                onChangeText={setPresetTitle}
                placeholder={t.quickAddTitlePlaceholder}
                placeholderTextColor={Colors.textMuted}
                style={styles.input}
              />

              <Text style={styles.label}>{t.amountLabel(currencyMeta.symbol)} *</Text>
              <TextInput
                value={presetAmount}
                onChangeText={setPresetAmount}
                keyboardType="decimal-pad"
                placeholder={currencyMeta.decimals === 0 ? '4500' : '3.50'}
                placeholderTextColor={Colors.textMuted}
                style={styles.input}
              />

              <Text style={styles.label}>{t.categoryLabel}</Text>
              <View style={styles.catGrid}>
                {allCategories.map((c) => {
                  const selected = presetCategory === c.id;
                  return (
                    <Pressable
                      key={c.id}
                      onPress={() => setPresetCategory(c.id)}
                      style={[
                        styles.catChip,
                        selected && {
                          borderColor: c.color,
                          backgroundColor: `${c.color}24`,
                        },
                      ]}
                    >
                      <Ionicons
                        name={c.icon}
                        size={14}
                        color={selected ? c.color : Colors.textSecondary}
                      />
                      <Text
                        style={[
                          styles.catChipText,
                          selected && { color: Colors.text, fontWeight: '700' },
                        ]}
                      >
                        {resolveCategoryLabel(c.id)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Pressable onPress={handleCreatePreset} style={styles.saveBtn}>
                <Text style={styles.saveBtnText}>{t.quickAddSaveBtn}</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Custom Split Divisor Modal */}
      <Modal
        visible={showCustomSplit}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCustomSplit(false)}
      >
        <View style={styles.centerBackdrop}>
          <View style={styles.centerCard}>
            <Text style={styles.modalTitle}>{t.splitCustomTitle}</Text>
            <TextInput
              value={customSplitInput}
              onChangeText={setCustomSplitInput}
              keyboardType="number-pad"
              placeholder={t.splitCustomPlaceholder}
              placeholderTextColor={Colors.textMuted}
              autoFocus
              style={styles.input}
            />
            <View style={styles.modalBtnRow}>
              <Pressable
                onPress={() => setShowCustomSplit(false)}
                style={styles.modalCancelBtn}
              >
                <Text style={styles.modalCancelText}>{t.cancel}</Text>
              </Pressable>
              <Pressable
                onPress={handleCustomSplitSubmit}
                style={styles.modalConfirmBtn}
              >
                <Text style={styles.modalConfirmText}>{t.splitApplyBtn}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Quick Offline Exchange Rate Edit Modal */}
      <Modal
        visible={showFxEditModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowFxEditModal(false)}
      >
        <View style={styles.centerBackdrop}>
          <View style={styles.centerCard}>
            <Text style={styles.modalTitle}>{t.fxQuickEditTitle}</Text>
            {isForeignCurrency && (
              <Text style={styles.fxModalSub}>
                {`1 ${getFriendlyRatePair(currency, activeCurrency, fxRates).unitCode} = ? ${
                  getFriendlyRatePair(currency, activeCurrency, fxRates).quoteCode
                }`}
              </Text>
            )}
            <TextInput
              value={fxRateInput}
              onChangeText={setFxRateInput}
              keyboardType="decimal-pad"
              autoFocus
              style={styles.input}
            />
            <View style={styles.modalBtnRow}>
              <Pressable
                onPress={() => setShowFxEditModal(false)}
                style={styles.modalCancelBtn}
              >
                <Text style={styles.modalCancelText}>{t.cancel}</Text>
              </Pressable>
              <Pressable
                onPress={() => void handleSaveQuickFxRate()}
                style={styles.modalConfirmBtn}
              >
                <Text style={styles.modalConfirmText}>{t.splitApplyBtn}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Hidden on-device Tesseract.js + PDF.js worker */}
      <ReceiptOcrWorker
        job={ocrJob}
        onProgress={handleOcrProgress}
        onResult={handleOcrResult}
        onError={handleOcrError}
      />
    </SafeAreaView>
  );
}

const createStyles = (Colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  scroll: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    gap: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    gap: 8,
  },
  pageTitle: {
    color: Colors.text,
    fontSize: 22,
    fontWeight: '800',
  },
  pageSub: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  clearBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  clearBtnText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  captureRow: {
    flexDirection: 'row',
    gap: 8,
  },
  captureCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 4,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  captureIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  captureTitle: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  captureSub: {
    color: Colors.textMuted,
    fontSize: 10,
    marginTop: 2,
  },
  quickCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
  },
  quickHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  quickTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  quickTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  quickNewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: Colors.primary,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
  },
  quickNewText: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '700',
  },
  quickToast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.primarySoft,
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  quickToastText: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  quickEmpty: {
    color: Colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
  },
  quickChipsRow: {
    gap: 8,
    paddingVertical: 2,
  },
  quickChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: 99,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  quickChipTitle: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  quickChipAmt: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '800',
  },
  pdfPreviewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  pdfIconBadge: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: Colors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pdfPreviewTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  openPdfBtn: {
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  openPdfBtnText: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '700',
  },
  previewCard: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  previewImg: {
    width: '100%',
    height: 160,
  },
  previewOverlayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  attachedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  attachedText: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  removeImgBtn: {
    padding: 4,
  },
  progressCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.primary,
    gap: 8,
  },
  progressTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  progressText: {
    flex: 1,
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  progressPct: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  progressTrack: {
    height: 6,
    backgroundColor: Colors.bg,
    borderRadius: 99,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.primary,
  },
  noticePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.accentSoft,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  noticeText: {
    flex: 1,
    color: Colors.text,
    fontSize: 12,
  },
  rawToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  rawToggleText: {
    flex: 1,
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  rawBox: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10,
  },
  rawInput: {
    backgroundColor: Colors.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.text,
    padding: 10,
    minHeight: 90,
    textAlignVertical: 'top',
    fontSize: 13,
  },
  parseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 10,
  },
  parseBtnText: {
    color: Colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  formCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10,
  },
  amountRow: {
    flexDirection: 'row',
    gap: 10,
  },
  splitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  splitLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginRight: 2,
  },
  splitBtn: {
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  splitBtnText: {
    color: Colors.accent,
    fontSize: 12,
    fontWeight: '700',
  },
  splitAppliedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  splitAppliedText: {
    color: Colors.accent,
    fontSize: 12,
    fontWeight: '700',
  },
  splitUndoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  splitUndoText: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  label: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
    marginTop: 2,
  },
  euroInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
  },
  euroSign: {
    color: Colors.primary,
    fontSize: 20,
    fontWeight: '800',
    marginRight: 6,
  },
  amountInput: {
    flex: 1,
    color: Colors.text,
    fontSize: 22,
    fontWeight: '700',
    paddingVertical: 10,
  },
  input: {
    backgroundColor: Colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: Colors.text,
    fontSize: 14,
  },
  catHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  autoTag: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '600',
  },
  catGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  catChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.bg,
  },
  catChipText: {
    color: Colors.textSecondary,
    fontSize: 12,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    paddingVertical: 15,
    borderRadius: 14,
    marginTop: 8,
  },
  saveBtnText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: '800',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalTitle: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  modalBody: {
    padding: 18,
    paddingBottom: 32,
    gap: 10,
  },
  centerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: 24,
  },
  centerCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 14,
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  modalCancelText: {
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  modalConfirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
  },
  modalConfirmText: {
    color: Colors.white,
    fontWeight: '700',
  },
  ocrOptionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  ocrOptPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  ocrOptPillActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primarySoft,
  },
  ocrOptText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  previewImgWrap: {
    backgroundColor: Colors.bg,
    overflow: 'hidden',
  },
  previewToolsRow: {
    flexDirection: 'row',
    gap: 8,
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  previewToolBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  previewToolBtnActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primarySoft,
  },
  previewToolText: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  fxPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  fxPickerLabel: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
  fxChipsRow: {
    gap: 6,
    alignItems: 'center',
  },
  fxChip: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  fxChipActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primarySoft,
  },
  fxChipForeign: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accentSoft,
  },
  fxChipText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  fxBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.accentSoft,
    borderWidth: 1,
    borderColor: Colors.accent,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  fxBannerMain: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  fxBannerSub: {
    color: Colors.accent,
    fontSize: 11,
    fontWeight: '600',
  },
  fxEditBtn: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.accent,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  fxEditBtnText: {
    color: Colors.accent,
    fontSize: 11,
    fontWeight: '700',
  },
  fxModalSub: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  pagesStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  pageThumbPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pageThumbPillActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primarySoft,
  },
  pageMiniThumb: {
    width: 22,
    height: 22,
    borderRadius: 5,
  },
  pageThumbText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
  addPageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.borderLight,
  },
  addPageText: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '700',
  },
});
