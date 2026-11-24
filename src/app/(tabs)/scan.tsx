import React, { useCallback, useEffect, useState } from 'react';
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
import { ReceiptOcrWorker, type OcrJobPayload } from '@/components/ReceiptOcrWorker';
import {
  fromEditableItems,
  ReceiptItemsEditor,
  toEditableItems,
  type EditableReceiptItem,
} from '@/components/ReceiptItemsEditor';
import { formatEditableAmount } from '@/constants/currencies';
import { useFinances } from '@/db/FinanceContext';
import { findPotentialDuplicate } from '@/services/duplicateGuard';
import { parseReceiptText, suggestCategory } from '@/services/receiptParser';
import { splitReceiptAmounts } from '@/services/receiptSplit';
import {
  deleteReceiptFile,
  isPdfUri,
  openPdfReceipt,
  pickAndSavePdfReceipt,
  readFileAsBase64,
  readReceiptAsDataUrl,
  saveReceiptFromBase64,
  saveReceiptFromUri,
} from '@/services/receiptStorage';
import { Colors } from '@/theme/colors';
import type { CategoryId, QuickPreset } from '@/types/finance';
import { getTodayIso, isValidIsoDate, parseFlexibleAmount } from '@/utils/format';

interface SplitSnapshot {
  amountText: string;
  taxText: string;
  draftItems: EditableReceiptItem[];
  divisor: number;
}

export default function ScanScreen() {
  const {
    t,
    currency,
    currencyMeta,
    formatMoney,
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
  const ocrLang = currency === 'KRW' ? 'kor+eng' : currency === 'JPY' ? 'jpn+eng' : 'lit+eng';

  // Receipt file & OCR/PDF worker state
  const [receiptUri, setReceiptUri] = useState<string | null>(null);
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

  const applyParsedText = useCallback(
    (text: string) => {
      setRawText(text);
      setSplitSnapshot(null);
      const parsed = parseReceiptText(text, merchantRules, currency);

      if (parsed.amount !== null) {
        setAmountText(formatEditableAmount(parsed.amount, currency));
      }
      if (parsed.taxAmount !== null) {
        setTaxText(formatEditableAmount(parsed.taxAmount, currency));
      }
      if (parsed.merchant) {
        setMerchant(parsed.merchant);
        setTitle((prev) => (prev.trim() ? prev : parsed.merchant));
      }
      if (parsed.date) {
        setDate(parsed.date);
      }
      setDraftItems(toEditableItems(parsed.items, currency));
      setCategory(parsed.category);
      setCategoryManuallyPicked(false);
      setCategoryHint(
        t.autoSorted(resolveCategoryLabel(parsed.category), parsed.matchedHint)
      );
    },
    [merchantRules, resolveCategoryLabel, t, currency]
  );

  const startOcrForSavedImage = useCallback(
    async (savedUri: string, customNotice?: string) => {
      setReceiptUri(savedUri);
      setPdfFileName(null);
      setSplitSnapshot(null);
      setOcrNotice(customNotice ?? null);
      setOcrScanning(true);
      setOcrStatus(t.preparingImage);
      setOcrProgress(0.08);
      try {
        const dataUrl = await readReceiptAsDataUrl(savedUri);
        setOcrJob((prev) => ({
          id: (prev?.id ?? 0) + 1,
          kind: 'image',
          data: dataUrl,
          ocrLang,
        }));
      } catch {
        setOcrScanning(false);
        setOcrNotice(t.ocrEmptyNotice);
      }
    },
    [t, ocrLang]
  );

  const startPdfJob = useCallback(
    (savedUri: string, base64: string, fileName: string, customNotice?: string) => {
      setReceiptUri(savedUri);
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
      }));
    },
    [t, ocrLang]
  );

  // Receive files or text shared directly from Gmail, Gallery, Files, WhatsApp, etc.
  useEffect(() => {
    if (!hasShareIntent) return;

    let cancelled = false;
    (async () => {
      try {
        const sharedFile = shareIntent.files?.[0];
        if (sharedFile?.path) {
          const mime = (sharedFile.mimeType ?? '').toLowerCase();
          const fileName = sharedFile.fileName || 'shared_receipt';
          const isPdf = mime.includes('pdf') || fileName.toLowerCase().endsWith('.pdf');

          if (isPdf) {
            const savedUri = await saveReceiptFromUri(sharedFile.path, 'pdf');
            const base64 = await readFileAsBase64(savedUri);
            if (!cancelled) {
              startPdfJob(savedUri, base64, fileName, t.sharedFileNotice);
            }
          } else {
            const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
            const savedUri = await saveReceiptFromUri(sharedFile.path, ext);
            if (!cancelled) {
              await startOcrForSavedImage(savedUri, t.sharedFileNotice);
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
    startOcrForSavedImage,
    applyParsedText,
    t,
  ]);

  const handleTakePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t.alertCamTitle, t.alertCamBody);
      return;
    }

    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.65,
    });

    if (res.canceled || !res.assets[0]) return;
    const saved = await saveReceiptFromUri(res.assets[0].uri);
    await startOcrForSavedImage(saved);
  };

  const handlePickGallery = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t.alertPhotosTitle, t.alertPhotosBody);
      return;
    }

    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });

    if (res.canceled || !res.assets[0]) return;
    const saved = await saveReceiptFromUri(res.assets[0].uri);
    await startOcrForSavedImage(saved);
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
          await startOcrForSavedImage(saved);
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
      currency,
    });

    setSplitSnapshot({
      amountText: baseAmountText,
      taxText: baseTaxText,
      draftItems: baseItems,
      divisor,
    });
    setAmountText(formatEditableAmount(result.amount, currency));
    if (tax > 0) {
      setTaxText(formatEditableAmount(result.taxAmount, currency));
    }
    if (baseItems.length > 0) {
      setDraftItems(
        baseItems.map((it, idx) => ({
          ...it,
          priceText: formatEditableAmount(result.itemPrices[idx] ?? 0, currency),
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
    if (deleteAttachedFile && receiptUri) {
      deleteReceiptFile(receiptUri);
    }
    setReceiptUri(null);
    setPdfFileName(null);
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

  const commitExpense = async (
    cleanTitle: string,
    cleanMerchant: string,
    parsedAmount: number,
    parsedTax: number,
    cleanDate: string
  ) => {
    setSaving(true);
    try {
      const splitNote = splitSnapshot ? `Split ÷${splitSnapshot.divisor}` : '';
      const combinedNotes = [notes.trim(), splitNote].filter(Boolean).join(' • ');

      await addExpense({
        title: cleanTitle,
        merchant: cleanMerchant,
        amount: parsedAmount,
        taxAmount: parsedTax,
        category,
        date: cleanDate,
        notes: combinedNotes,
        receiptUri,
        rawOcrText: rawText.trim() || null,
        items: fromEditableItems(draftItems),
      });
      setSelectedMonth(cleanDate.slice(0, 7));
      Alert.alert(
        t.alertSavedTitle,
        t.alertSavedBody(
          cleanTitle,
          formatMoney(parsedAmount),
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
    const cleanDate = isValidIsoDate(date) ? date.trim() : getTodayIso();
    const cleanMerchant = merchant.trim();
    const cleanTitle =
      title.trim() || cleanMerchant || resolveCategoryLabel(category);

    // Duplicate receipt guard
    const duplicate = findPotentialDuplicate(
      expenses,
      {
        amount: parsedAmount,
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
                parsedAmount,
                parsedTax,
                cleanDate
              );
            },
          },
        ]
      );
      return;
    }

    await commitExpense(cleanTitle, cleanMerchant, parsedAmount, parsedTax, cleanDate);
  };

  const handleOcrProgress = useCallback((status: string, progress: number) => {
    setOcrStatus(status);
    setOcrProgress(progress);
  }, []);

  const handleOcrResult = useCallback(
    (text: string, kind: 'image' | 'pdf') => {
      setOcrScanning(false);
      setOcrProgress(1);
      if (text.trim().length < 4) {
        setOcrNotice(t.ocrEmptyNotice);
        return;
      }
      applyParsedText(text);
      setOcrNotice(kind === 'pdf' ? t.pdfDoneNotice : t.ocrDoneNotice);
    },
    [applyParsedText, t]
  );

  const handleOcrError = useCallback((msg: string) => {
    setOcrScanning(false);
    setOcrNotice(msg);
  }, []);

  const hasPdf = isPdfUri(receiptUri);
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
            {(receiptUri || amountText || merchant) && (
              <Pressable onPress={() => resetForm(true)} style={styles.clearBtn}>
                <Text style={styles.clearBtnText}>{t.clear}</Text>
              </Pressable>
            )}
          </View>

          {/* 4 Capture Actions: Camera, Gallery, PDF, Paste */}
          <View style={styles.captureRow}>
            <Pressable onPress={handleTakePhoto} style={styles.captureCard}>
              <View style={[styles.captureIcon, { backgroundColor: Colors.primarySoft }]}>
                <Ionicons name="camera-outline" size={22} color={Colors.primary} />
              </View>
              <Text style={styles.captureTitle}>{t.camera}</Text>
              <Text style={styles.captureSub} numberOfLines={1}>
                {t.snapReceipt}
              </Text>
            </Pressable>

            <Pressable onPress={handlePickGallery} style={styles.captureCard}>
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

          {/* Receipt Preview (Image or PDF) */}
          {receiptUri &&
            (hasPdf ? (
              <View style={styles.pdfPreviewCard}>
                <View style={styles.pdfIconBadge}>
                  <Ionicons name="document-text" size={24} color={Colors.danger} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pdfPreviewTitle} numberOfLines={1}>
                    {pdfFileName || receiptUri.split('/').pop()}
                  </Text>
                  <Text style={styles.attachedText}>{t.pdfSavedLocal}</Text>
                </View>
                <Pressable
                  onPress={() => openPdfReceipt(receiptUri)}
                  style={styles.openPdfBtn}
                >
                  <Text style={styles.openPdfBtnText}>{t.openPdf}</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    deleteReceiptFile(receiptUri);
                    setReceiptUri(null);
                    setPdfFileName(null);
                  }}
                  style={styles.removeImgBtn}
                >
                  <Ionicons name="trash-outline" size={16} color={Colors.danger} />
                </Pressable>
              </View>
            ) : (
              <View style={styles.previewCard}>
                <Image
                  source={{ uri: receiptUri }}
                  style={styles.previewImg}
                  resizeMode="cover"
                />
                <View style={styles.previewOverlayRow}>
                  <View style={styles.attachedPill}>
                    <Ionicons name="checkmark-circle" size={14} color={Colors.primary} />
                    <Text style={styles.attachedText}>{t.receiptSavedLocal}</Text>
                  </View>
                  <Pressable
                    onPress={() => {
                      deleteReceiptFile(receiptUri);
                      setReceiptUri(null);
                    }}
                    style={styles.removeImgBtn}
                  >
                    <Ionicons name="trash-outline" size={15} color={Colors.danger} />
                  </Pressable>
                </View>
              </View>
            ))}

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
            <View style={styles.amountRow}>
              <View style={{ flex: 1.3 }}>
                <Text style={styles.label}>{t.totalAmountLabel(currencyMeta.symbol)}</Text>
                <View style={styles.euroInputWrap}>
                  <Text style={styles.euroSign}>{currencyMeta.symbol}</Text>
                  <TextInput
                    value={amountText}
                    onChangeText={(val) => {
                      setAmountText(val);
                      if (splitSnapshot) setSplitSnapshot(null);
                    }}
                    keyboardType="decimal-pad"
                    placeholder={currencyMeta.decimals === 0 ? '0' : '0.00'}
                    placeholderTextColor={Colors.textMuted}
                    style={styles.amountInput}
                  />
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>{t.taxVatLabel(currencyMeta.symbol)}</Text>
                <View style={styles.euroInputWrap}>
                  <Text style={[styles.euroSign, { fontSize: 16 }]}>
                    {currencyMeta.symbol}
                  </Text>
                  <TextInput
                    value={taxText}
                    onChangeText={setTaxText}
                    keyboardType="decimal-pad"
                    placeholder={currencyMeta.decimals === 0 ? '0' : '0.00'}
                    placeholderTextColor={Colors.textMuted}
                    style={[styles.amountInput, { fontSize: 18 }]}
                  />
                </View>
              </View>
            </View>

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
              onApplyItemsSum={(sum) => setAmountText(formatEditableAmount(sum, currency))}
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

const styles = StyleSheet.create({
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
});
