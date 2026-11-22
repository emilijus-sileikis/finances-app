import React, { useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  fromEditableItems,
  ReceiptItemsEditor,
  toEditableItems,
  type EditableReceiptItem,
} from '@/components/ReceiptItemsEditor';
import { CATEGORIES } from '@/constants/categories';
import { useFinances } from '@/db/FinanceContext';
import { getCategoryLabel } from '@/i18n/translations';
import { isPdfUri, openPdfReceipt } from '@/services/receiptStorage';
import { Colors } from '@/theme/colors';
import type { CategoryId, Expense, UpdateExpenseInput } from '@/types/finance';
import { isValidIsoDate, parseFlexibleAmount } from '@/utils/format';

interface ExpenseDetailModalProps {
  expense: Expense | null;
  onClose: () => void;
  onSave: (id: number, updates: UpdateExpenseInput) => Promise<void>;
  onDelete: (expense: Expense) => Promise<void>;
}

export function ExpenseDetailModal({
  expense,
  onClose,
  onSave,
  onDelete,
}: ExpenseDetailModalProps) {
  return (
    <Modal visible={Boolean(expense)} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {expense ? (
          <ExpenseDetailForm
            key={expense.id}
            expense={expense}
            onClose={onClose}
            onSave={onSave}
            onDelete={onDelete}
          />
        ) : null}
      </View>
    </Modal>
  );
}

interface ExpenseDetailFormProps {
  expense: Expense;
  onClose: () => void;
  onSave: (id: number, updates: UpdateExpenseInput) => Promise<void>;
  onDelete: (expense: Expense) => Promise<void>;
}

function ExpenseDetailForm({
  expense,
  onClose,
  onSave,
  onDelete,
}: ExpenseDetailFormProps) {
  const { language, t } = useFinances();

  const [title, setTitle] = useState(expense.title);
  const [merchant, setMerchant] = useState(expense.merchant);
  const [amountText, setAmountText] = useState(expense.amount.toFixed(2));
  const [taxText, setTaxText] = useState(
    expense.taxAmount > 0 ? expense.taxAmount.toFixed(2) : ''
  );
  const [date, setDate] = useState(expense.date);
  const [category, setCategory] = useState<CategoryId>(expense.category);
  const [notes, setNotes] = useState(expense.notes);
  const [draftItems, setDraftItems] = useState<EditableReceiptItem[]>(() =>
    toEditableItems(expense.items)
  );
  const [showFullReceipt, setShowFullReceipt] = useState(false);

  const hasPdf = isPdfUri(expense.receiptUri);
  const currentTotal = parseFlexibleAmount(amountText);

  const handleSave = async () => {
    const parsedAmount = parseFlexibleAmount(amountText);
    if (parsedAmount === null || parsedAmount <= 0) {
      Alert.alert(t.alertAmountTitle, t.alertAmountBody);
      return;
    }
    const parsedTax = taxText.trim() ? parseFlexibleAmount(taxText) ?? 0 : 0;

    await onSave(expense.id, {
      title: title.trim() || merchant.trim() || 'Expense',
      merchant: merchant.trim(),
      amount: parsedAmount,
      taxAmount: parsedTax,
      category,
      date: isValidIsoDate(date) ? date.trim() : expense.date,
      notes: notes.trim(),
      items: fromEditableItems(draftItems),
    });
    onClose();
  };

  const handleDelete = () => {
    Alert.alert(t.deleteExpenseTitle, t.deleteExpenseBody(expense.title), [
      { text: t.cancel, style: 'cancel' },
      {
        text: t.delete,
        style: 'destructive',
        onPress: async () => {
          await onDelete(expense);
          onClose();
        },
      },
    ]);
  };

  return (
    <View style={styles.sheet}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t.editExpense}</Text>
        <Pressable onPress={onClose} style={styles.closeBtn}>
          <Ionicons name="close" size={22} color={Colors.text} />
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        {expense.receiptUri &&
          (hasPdf ? (
            <Pressable
              onPress={() => openPdfReceipt(expense.receiptUri!)}
              style={styles.pdfBox}
            >
              <View style={styles.pdfIconWrap}>
                <Ionicons name="document-text" size={26} color={Colors.danger} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.pdfTitle}>{t.pdfSavedLocal}</Text>
                <Text style={styles.pdfSub} numberOfLines={1}>
                  {expense.receiptUri.split('/').pop()}
                </Text>
              </View>
              <View style={styles.openPdfPill}>
                <Text style={styles.openPdfText}>{t.openPdf}</Text>
              </View>
            </Pressable>
          ) : (
            <Pressable onPress={() => setShowFullReceipt((v) => !v)} style={styles.receiptBox}>
              <Image
                source={{ uri: expense.receiptUri }}
                style={showFullReceipt ? styles.receiptFull : styles.receiptThumb}
                resizeMode="contain"
              />
              <Text style={styles.receiptHint}>
                {showFullReceipt ? t.tapToShrink : t.tapToExpand}
              </Text>
            </Pressable>
          ))}

        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>{t.amountEur}</Text>
            <TextInput
              value={amountText}
              onChangeText={setAmountText}
              keyboardType="decimal-pad"
              style={styles.input}
              placeholderTextColor={Colors.textMuted}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>{t.taxVatLabel}</Text>
            <TextInput
              value={taxText}
              onChangeText={setTaxText}
              keyboardType="decimal-pad"
              placeholder="0.00"
              style={styles.input}
              placeholderTextColor={Colors.textMuted}
            />
          </View>
        </View>

        <Text style={styles.label}>{t.merchantLabel}</Text>
        <TextInput
          value={merchant}
          onChangeText={setMerchant}
          style={styles.input}
          placeholder={t.merchantPlaceholder}
          placeholderTextColor={Colors.textMuted}
        />

        <Text style={styles.label}>{t.titleLabel}</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          style={styles.input}
          placeholder={t.titlePlaceholder}
          placeholderTextColor={Colors.textMuted}
        />

        <Text style={styles.label}>{t.dateIsoLabel}</Text>
        <TextInput
          value={date}
          onChangeText={setDate}
          style={styles.input}
          placeholder="2026-11-22"
          placeholderTextColor={Colors.textMuted}
        />

        <Text style={styles.label}>{t.categoryLearnedLabel}</Text>
        <View style={styles.catGrid}>
          {CATEGORIES.map((c) => {
            const selected = category === c.id;
            return (
              <Pressable
                key={c.id}
                onPress={() => setCategory(c.id)}
                style={[
                  styles.catChip,
                  selected && { borderColor: c.color, backgroundColor: `${c.color}22` },
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
                    selected && { color: Colors.text, fontWeight: '600' },
                  ]}
                >
                  {getCategoryLabel(c.id, language)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Itemized Receipt Breakdown Editor */}
        <ReceiptItemsEditor
          items={draftItems}
          onChange={setDraftItems}
          receiptTotal={currentTotal}
          onApplyItemsSum={(sum) => setAmountText(sum.toFixed(2))}
        />

        <Text style={styles.label}>{t.notesLabel}</Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          style={[styles.input, { minHeight: 68, textAlignVertical: 'top' }]}
          multiline
          placeholder={t.notesPlaceholder}
          placeholderTextColor={Colors.textMuted}
        />

        {expense.rawOcrText ? (
          <View style={styles.ocrBox}>
            <Text style={styles.ocrTitle}>{t.extractedText}</Text>
            <Text style={styles.ocrText}>{expense.rawOcrText}</Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          <Pressable onPress={handleDelete} style={styles.deleteBtn}>
            <Ionicons name="trash-outline" size={18} color={Colors.danger} />
            <Text style={styles.deleteBtnText}>{t.delete}</Text>
          </Pressable>
          <Pressable onPress={handleSave} style={styles.saveBtn}>
            <Ionicons name="checkmark" size={18} color={Colors.white} />
            <Text style={styles.saveBtnText}>{t.saveChanges}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '92%',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  closeBtn: {
    padding: 4,
  },
  body: {
    padding: 20,
    paddingBottom: 36,
    gap: 12,
  },
  pdfBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.bg,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  pdfIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pdfTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  pdfSub: {
    color: Colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  openPdfPill: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  openPdfText: {
    color: Colors.white,
    fontSize: 12,
    fontWeight: '700',
  },
  receiptBox: {
    backgroundColor: Colors.bg,
    borderRadius: 14,
    padding: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  receiptThumb: {
    width: '100%',
    height: 150,
    borderRadius: 10,
  },
  receiptFull: {
    width: '100%',
    height: 360,
    borderRadius: 10,
  },
  receiptHint: {
    color: Colors.textMuted,
    fontSize: 12,
    marginTop: 6,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  label: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
    marginTop: 4,
  },
  input: {
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: Colors.text,
    fontSize: 15,
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
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.bg,
  },
  catChipText: {
    color: Colors.textSecondary,
    fontSize: 12,
  },
  ocrBox: {
    backgroundColor: Colors.bg,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  ocrTitle: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  ocrText: {
    color: Colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 13,
    paddingHorizontal: 18,
    borderRadius: 14,
    backgroundColor: Colors.dangerSoft,
    borderWidth: 1,
    borderColor: Colors.danger,
  },
  deleteBtnText: {
    color: Colors.danger,
    fontWeight: '700',
    fontSize: 14,
  },
  saveBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: Colors.primary,
  },
  saveBtnText: {
    color: Colors.white,
    fontWeight: '700',
    fontSize: 15,
  },
});
