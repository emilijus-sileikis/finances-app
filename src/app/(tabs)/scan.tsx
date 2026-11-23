import React, { useCallback, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
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
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ReceiptOcrWorker, type OcrJobPayload } from '@/components/ReceiptOcrWorker';
import {
  fromEditableItems,
  ReceiptItemsEditor,
  toEditableItems,
  type EditableReceiptItem,
} from '@/components/ReceiptItemsEditor';
import { CATEGORIES } from '@/constants/categories';
import { formatEditableAmount } from '@/constants/currencies';
import { useFinances } from '@/db/FinanceContext';
import { getCategoryLabel } from '@/i18n/translations';
import { parseReceiptText, suggestCategory } from '@/services/receiptParser';
import {
  deleteReceiptFile,
  isPdfUri,
  openPdfReceipt,
  pickAndSavePdfReceipt,
  readReceiptAsDataUrl,
  saveReceiptFromBase64,
  saveReceiptFromUri,
} from '@/services/receiptStorage';
import { Colors } from '@/theme/colors';
import type { CategoryId } from '@/types/finance';
import { getTodayIso, isValidIsoDate, parseFlexibleAmount } from '@/utils/format';

export default function ScanScreen() {
  const {
    language,
    t,
    currency,
    currencyMeta,
    formatMoney,
    addExpense,
    merchantRules,
    setSelectedMonth,
  } = useFinances();
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

  const applyParsedText = useCallback(
    (text: string) => {
      setRawText(text);
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
        t.autoSorted(getCategoryLabel(parsed.category, language), parsed.matchedHint)
      );
    },
    [merchantRules, language, t, currency]
  );

  const startOcrForSavedImage = useCallback(
    async (savedUri: string) => {
      setReceiptUri(savedUri);
      setPdfFileName(null);
      setOcrNotice(null);
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

      setReceiptUri(picked.uri);
      setPdfFileName(picked.name);
      setOcrNotice(null);
      setOcrScanning(true);
      setOcrStatus(t.preparingPdf);
      setOcrProgress(0.1);
      setOcrJob((prev) => ({
        id: (prev?.id ?? 0) + 1,
        kind: 'pdf',
        data: picked.base64,
        ocrLang,
      }));
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

  const handleMerchantChange = (val: string) => {
    setMerchant(val);
    if (!categoryManuallyPicked && val.trim().length >= 2) {
      const suggestion = suggestCategory(rawText, val, merchantRules);
      if (suggestion.confidence !== 'fallback') {
        setCategory(suggestion.category);
        setCategoryHint(
          t.autoSorted(
            getCategoryLabel(suggestion.category, language),
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
    setNotes('');
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
      title.trim() || cleanMerchant || getCategoryLabel(category, language);

    setSaving(true);
    try {
      await addExpense({
        title: cleanTitle,
        merchant: cleanMerchant,
        amount: parsedAmount,
        taxAmount: parsedTax,
        category,
        date: cleanDate,
        notes: notes.trim(),
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
          getCategoryLabel(category, language)
        )
      );
      resetForm();
    } finally {
      setSaving(false);
    }
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
                    onChangeText={setAmountText}
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
              {CATEGORIES.map((c) => {
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
                      {getCategoryLabel(c.id, language)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Itemized Receipt Breakdown */}
            <ReceiptItemsEditor
              items={draftItems}
              onChange={setDraftItems}
              receiptTotal={parseFlexibleAmount(amountText)}
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
});
