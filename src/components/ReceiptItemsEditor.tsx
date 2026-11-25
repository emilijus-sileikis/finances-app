import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  formatCurrency,
  formatEditableAmount,
  getCurrencyMeta,
  type CurrencyCode,
} from '@/constants/currencies';
import { useFinances } from '@/db/FinanceContext';
import type { ThemeColors } from '@/theme/colors';
import type { NewExpenseItemInput } from '@/types/finance';
import { parseFlexibleAmount } from '@/utils/format';

export interface EditableReceiptItem {
  key: string;
  name: string;
  quantityText: string;
  priceText: string;
}

export function toEditableItems(
  items: { name: string; quantity?: number; price: number }[],
  currency: CurrencyCode = 'EUR'
): EditableReceiptItem[] {
  return items.map((item, idx) => ({
    key: `item_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
    name: item.name,
    quantityText: String(item.quantity ?? 1),
    priceText: formatEditableAmount(item.price, currency),
  }));
}

export function fromEditableItems(drafts: EditableReceiptItem[]): NewExpenseItemInput[] {
  const result: NewExpenseItemInput[] = [];
  for (const draft of drafts) {
    const name = draft.name.trim();
    const price = parseFlexibleAmount(draft.priceText, true);
    if (!name || price === null) continue;
    const qtyNum = Number(draft.quantityText.trim().replace(',', '.'));
    const quantity = Number.isFinite(qtyNum) && qtyNum > 0 ? Math.round(qtyNum * 1000) / 1000 : 1;
    result.push({ name, quantity, price });
  }
  return result;
}

interface ReceiptItemsEditorProps {
  items: EditableReceiptItem[];
  onChange: (next: EditableReceiptItem[]) => void;
  receiptTotal: number | null;
  onApplyItemsSum?: (sum: number) => void;
  currencyOverride?: CurrencyCode;
}

export function ReceiptItemsEditor({
  items,
  onChange,
  receiptTotal,
  onApplyItemsSum,
  currencyOverride,
}: ReceiptItemsEditorProps) {
  const { t, currency, colors: Colors } = useFinances();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const activeCode = currencyOverride ?? currency;
  const currencyMeta = getCurrencyMeta(activeCode);
  const formatMoney = (amount: number, showDecimals?: boolean) =>
    formatCurrency(amount, activeCode, showDecimals);

  const itemsSum = items.reduce((sum, item) => {
    const p = parseFlexibleAmount(item.priceText, true);
    return p !== null ? sum + p : sum;
  }, 0);
  const roundedSum = Math.round(itemsSum * 100) / 100;
  const mismatchTolerance = currencyMeta.decimals === 0 ? 1 : 0.02;

  const hasMismatch =
    items.length > 0 &&
    receiptTotal !== null &&
    receiptTotal > 0 &&
    Math.abs(roundedSum - receiptTotal) > mismatchTolerance;

  const diff = receiptTotal !== null ? Math.abs(roundedSum - receiptTotal) : 0;

  const handleAdd = () => {
    onChange([
      ...items,
      {
        key: `item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: '',
        quantityText: '1',
        priceText: '',
      },
    ]);
  };

  const handleUpdate = (
    key: string,
    field: 'name' | 'quantityText' | 'priceText',
    value: string
  ) => {
    onChange(items.map((it) => (it.key === key ? { ...it, [field]: value } : it)));
  };

  const handleRemove = (key: string) => {
    onChange(items.filter((it) => it.key !== key));
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.titleWrap}>
          <Ionicons name="list-outline" size={16} color={Colors.primary} />
          <Text style={styles.title}>{t.receiptItemsTitle(items.length)}</Text>
        </View>
        <Pressable onPress={handleAdd} style={styles.addBtn}>
          <Ionicons name="add" size={14} color={Colors.primary} />
          <Text style={styles.addBtnText}>{t.addItemBtn}</Text>
        </Pressable>
      </View>

      {items.length === 0 ? (
        <Text style={styles.emptyHint}>{t.noItemsHint}</Text>
      ) : (
        <View style={styles.list}>
          {items.map((item) => {
            const parsedPrice = parseFlexibleAmount(item.priceText, true);
            const isDiscount = parsedPrice !== null && parsedPrice < 0;

            return (
              <View key={item.key} style={styles.itemRow}>
                <TextInput
                  value={item.name}
                  onChangeText={(val) => handleUpdate(item.key, 'name', val)}
                  placeholder={t.itemNamePlaceholder}
                  placeholderTextColor={Colors.textMuted}
                  multiline
                  style={styles.nameInput}
                />
                <TextInput
                  value={item.quantityText}
                  onChangeText={(val) => handleUpdate(item.key, 'quantityText', val)}
                  keyboardType="decimal-pad"
                  placeholder={t.qtyPlaceholder}
                  placeholderTextColor={Colors.textMuted}
                  style={styles.qtyInput}
                />
                <View style={styles.priceWrap}>
                  <Text style={[styles.euro, isDiscount && { color: Colors.primary }]}>
                    {currencyMeta.symbol}
                  </Text>
                  <TextInput
                    value={item.priceText}
                    onChangeText={(val) => handleUpdate(item.key, 'priceText', val)}
                    keyboardType="numbers-and-punctuation"
                    placeholder={currencyMeta.decimals === 0 ? '0' : t.pricePlaceholder}
                    placeholderTextColor={Colors.textMuted}
                    style={[styles.priceInput, isDiscount && { color: Colors.primary }]}
                  />
                </View>
                <Pressable
                  onPress={() => handleRemove(item.key)}
                  style={styles.removeBtn}
                  hitSlop={6}
                >
                  <Ionicons name="close-circle-outline" size={18} color={Colors.danger} />
                </Pressable>
              </View>
            );
          })}

          <View style={styles.sumRow}>
            <Text style={styles.sumLabel}>{t.itemsSumLabel}</Text>
            <Text style={styles.sumVal}>{formatMoney(roundedSum)}</Text>
          </View>
        </View>
      )}

      {hasMismatch && receiptTotal !== null && (
        <View style={styles.mismatchBox}>
          <View style={styles.mismatchTop}>
            <Ionicons name="warning-outline" size={15} color={Colors.warning} />
            <Text style={styles.mismatchText}>
              {t.itemsMismatch(
                formatMoney(roundedSum),
                formatMoney(receiptTotal),
                formatMoney(diff)
              )}
            </Text>
          </View>
          {onApplyItemsSum && roundedSum > 0 && (
            <Pressable
              onPress={() => onApplyItemsSum(roundedSum)}
              style={styles.applyBtn}
            >
              <Text style={styles.applyBtnText}>
                {t.useItemsSumBtn} ({formatMoney(roundedSum)})
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const createStyles = (Colors: ThemeColors) => StyleSheet.create({
  container: {
    backgroundColor: Colors.bg,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10,
    marginTop: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: Colors.primary,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
  },
  addBtnText: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '700',
  },
  emptyHint: {
    color: Colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  list: {
    gap: 8,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  nameInput: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 7,
    color: Colors.text,
    fontSize: 13,
  },
  qtyInput: {
    width: 44,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 9,
    paddingHorizontal: 6,
    paddingVertical: 7,
    color: Colors.textSecondary,
    fontSize: 12,
    textAlign: 'center',
  },
  priceWrap: {
    width: 78,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 9,
    paddingHorizontal: 7,
  },
  euro: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    marginRight: 2,
  },
  priceInput: {
    flex: 1,
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
    paddingVertical: 7,
  },
  removeBtn: {
    padding: 2,
  },
  sumRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 8,
    marginTop: 2,
  },
  sumLabel: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  sumVal: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  mismatchBox: {
    backgroundColor: Colors.warningSoft,
    borderWidth: 1,
    borderColor: Colors.warning,
    borderRadius: 10,
    padding: 10,
    gap: 8,
  },
  mismatchTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  mismatchText: {
    flex: 1,
    color: Colors.text,
    fontSize: 11,
    lineHeight: 16,
  },
  applyBtn: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.warning,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 7,
  },
  applyBtnText: {
    color: Colors.black,
    fontSize: 11,
    fontWeight: '700',
  },
});
