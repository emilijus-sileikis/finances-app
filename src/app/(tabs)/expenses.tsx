import React, { useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ExpenseDetailModal } from '@/components/ExpenseDetailModal';
import { useFinances } from '@/db/FinanceContext';
import { analyzeProductPrices } from '@/services/priceHistory';
import { exportExpensesCsv, isPdfUri } from '@/services/receiptStorage';
import { getMonthExpenses } from '@/services/savingsEngine';
import { Colors } from '@/theme/colors';
import type { CategoryId, Expense } from '@/types/finance';
import {
  formatDisplayDate,
  formatMonthLabel,
  shiftMonthKey,
} from '@/utils/format';

export default function ExpensesScreen() {
  const {
    language,
    t,
    currency,
    formatMoney,
    allCategories,
    resolveCategoryMeta,
    resolveCategoryLabel,
    expenses,
    selectedMonth,
    setSelectedMonth,
    editExpense,
    removeExpense,
  } = useFinances();

  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<CategoryId | 'all'>('all');
  const [showAllMonths, setShowAllMonths] = useState(false);
  const [expandedExpenseIds, setExpandedExpenseIds] = useState<Record<number, boolean>>({});
  const [activeExpense, setActiveExpense] = useState<Expense | null>(null);

  const normalizedQuery = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    const base = showAllMonths ? expenses : getMonthExpenses(expenses, selectedMonth);

    return base.filter((e) => {
      if (selectedCategory !== 'all' && e.category !== selectedCategory) return false;
      if (!normalizedQuery) return true;
      const matchesMeta =
        e.title.toLowerCase().includes(normalizedQuery) ||
        e.merchant.toLowerCase().includes(normalizedQuery) ||
        e.notes.toLowerCase().includes(normalizedQuery) ||
        (e.rawOcrText?.toLowerCase().includes(normalizedQuery) ?? false);
      if (matchesMeta) return true;
      return e.items.some((item) => item.name.toLowerCase().includes(normalizedQuery));
    });
  }, [expenses, selectedMonth, showAllMonths, selectedCategory, normalizedQuery]);

  const filteredTotal = useMemo(
    () => filtered.reduce((sum, e) => sum + e.amount, 0),
    [filtered]
  );

  // When searching, calculate total spent specifically on matching line items
  const matchedLineItemsStats = useMemo(() => {
    if (!normalizedQuery) return { count: 0, total: 0 };
    let count = 0;
    let total = 0;
    for (const exp of filtered) {
      for (const item of exp.items) {
        if (item.name.toLowerCase().includes(normalizedQuery)) {
          count += 1;
          total += item.price;
        }
      }
    }
    return { count, total: Math.round(total * 100) / 100 };
  }, [filtered, normalizedQuery]);

  const matchedPriceSummary = useMemo(
    () => (normalizedQuery.length >= 2 ? analyzeProductPrices(filtered, normalizedQuery) : null),
    [filtered, normalizedQuery]
  );

  const toggleExpand = (id: number) => {
    setExpandedExpenseIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleExportCsv = async () => {
    if (filtered.length === 0) {
      Alert.alert(t.nothingToExport, t.addExpensesFirst);
      return;
    }
    try {
      await exportExpensesCsv(filtered, currency);
    } catch {
      Alert.alert('CSV', 'Could not create CSV export file.');
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.pageTitle}>{t.expensesTitle}</Text>
          <Text style={styles.pageSub}>{t.expensesSub}</Text>
        </View>
        <Pressable onPress={handleExportCsv} style={styles.exportBtn}>
          <Ionicons name="download-outline" size={16} color={Colors.primary} />
          <Text style={styles.exportBtnText}>CSV</Text>
        </Pressable>
      </View>

      {/* Month Filter Row */}
      <View style={styles.filterBar}>
        <Pressable
          onPress={() => setShowAllMonths((v) => !v)}
          style={[styles.allMonthsBtn, showAllMonths && styles.allMonthsBtnActive]}
        >
          <Text
            style={[styles.allMonthsText, showAllMonths && { color: Colors.white }]}
          >
            {showAllMonths ? t.allTime : t.month}
          </Text>
        </Pressable>

        {!showAllMonths && (
          <View style={styles.monthSwitch}>
            <Pressable
              onPress={() => setSelectedMonth(shiftMonthKey(selectedMonth, -1))}
              style={styles.arrowBtn}
            >
              <Ionicons name="chevron-back" size={18} color={Colors.text} />
            </Pressable>
            <Text style={styles.monthLabel}>
              {formatMonthLabel(selectedMonth, language)}
            </Text>
            <Pressable
              onPress={() => setSelectedMonth(shiftMonthKey(selectedMonth, 1))}
              style={styles.arrowBtn}
            >
              <Ionicons name="chevron-forward" size={18} color={Colors.text} />
            </Pressable>
          </View>
        )}
      </View>

      {/* Search (searches merchants, notes, OCR text, AND individual line items!) */}
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={18} color={Colors.textMuted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={t.searchPlaceholder}
          placeholderTextColor={Colors.textMuted}
          style={styles.searchInput}
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
          </Pressable>
        )}
      </View>

      {/* Matching Line Items + Cheapest Store Banner */}
      {matchedLineItemsStats.count > 0 && (
        <View style={styles.matchBanner}>
          <Ionicons name="pricetag-outline" size={16} color={Colors.primary} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.matchBannerText}>
              {t.matchingItemsBanner(
                matchedLineItemsStats.count,
                search.trim(),
                formatMoney(matchedLineItemsStats.total)
              )}
            </Text>
            {matchedPriceSummary?.cheapestStore && (
              <Text style={styles.matchSubText}>
                {t.cheapestAt(
                  matchedPriceSummary.cheapestStore.store,
                  formatMoney(matchedPriceSummary.cheapestStore.minUnitPrice)
                )}{' '}
                • {t.priceAvgLabel}: {formatMoney(matchedPriceSummary.avgUnitPrice)}
              </Text>
            )}
          </View>
        </View>
      )}

      {/* Category Filter Chips */}
      <View style={{ height: 42 }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          <Pressable
            onPress={() => setSelectedCategory('all')}
            style={[styles.chip, selectedCategory === 'all' && styles.chipActive]}
          >
            <Text
              style={[
                styles.chipText,
                selectedCategory === 'all' && styles.chipTextActive,
              ]}
            >
              {t.all}
            </Text>
          </Pressable>
          {allCategories.map((c) => {
            const active = selectedCategory === c.id;
            return (
              <Pressable
                key={c.id}
                onPress={() => setSelectedCategory(c.id)}
                style={[
                  styles.chip,
                  active && { borderColor: c.color, backgroundColor: `${c.color}25` },
                ]}
              >
                <Ionicons
                  name={c.icon}
                  size={13}
                  color={active ? c.color : Colors.textSecondary}
                />
                <Text style={[styles.chipText, active && { color: Colors.text }]}>
                  {resolveCategoryLabel(c.id)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Summary Strip */}
      <View style={styles.summaryRow}>
        <Text style={styles.summaryCount}>{t.txCount(filtered.length)}</Text>
        <Text style={styles.summaryTotal}>{formatMoney(filteredTotal)}</Text>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Ionicons name="receipt-outline" size={38} color={Colors.textMuted} />
            <Text style={styles.emptyText}>{t.noExpensesMatch}</Text>
          </View>
        }
        renderItem={({ item }) => {
          const meta = resolveCategoryMeta(item.category);
          const itemIsPdf = isPdfUri(item.receiptUri);
          const hasLineItems = item.items.length > 0;
          const hasMatchingLineItem =
            normalizedQuery.length > 0 &&
            item.items.some((li) => li.name.toLowerCase().includes(normalizedQuery));
          const isExpanded = Boolean(expandedExpenseIds[item.id]) || hasMatchingLineItem;

          return (
            <View style={styles.cardWrap}>
              <Pressable onPress={() => setActiveExpense(item)} style={styles.rowCard}>
                <View style={[styles.iconBox, { backgroundColor: `${meta.color}20` }]}>
                  <Ionicons name={meta.icon} size={20} color={meta.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <View style={styles.metaRow}>
                    <Text style={styles.rowSub}>
                      {resolveCategoryLabel(item.category)} •{' '}
                      {formatDisplayDate(item.date, language)}
                    </Text>
                    {item.receiptUri && (
                      <View
                        style={[
                          styles.tag,
                          itemIsPdf && { backgroundColor: Colors.dangerSoft },
                        ]}
                      >
                        <Ionicons
                          name={itemIsPdf ? 'document-text-outline' : 'image-outline'}
                          size={11}
                          color={itemIsPdf ? Colors.danger : Colors.accent}
                        />
                        <Text
                          style={[
                            styles.tagText,
                            itemIsPdf && { color: Colors.danger },
                          ]}
                        >
                          {itemIsPdf ? t.pdfTag : t.receiptTag}
                        </Text>
                      </View>
                    )}
                    {hasLineItems && (
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation();
                          toggleExpand(item.id);
                        }}
                        style={styles.itemsPill}
                        hitSlop={6}
                      >
                        <Ionicons name="list-outline" size={11} color={Colors.primary} />
                        <Text style={styles.itemsPillText}>
                          {t.itemBadge(item.items.length)}
                        </Text>
                        <Ionicons
                          name={isExpanded ? 'chevron-up' : 'chevron-down'}
                          size={11}
                          color={Colors.primary}
                        />
                      </Pressable>
                    )}
                    {item.taxAmount > 0 && (
                      <Text style={styles.taxTag}>PVM/VAT {formatMoney(item.taxAmount)}</Text>
                    )}
                  </View>
                </View>
                <Text style={styles.rowAmount}>-{formatMoney(item.amount)}</Text>
              </Pressable>

              {/* Inline expandable itemized receipt breakdown */}
              {hasLineItems && isExpanded && (
                <View style={styles.itemsDrawer}>
                  {item.items.map((lineItem, idx) => {
                    const isMatch =
                      normalizedQuery.length > 0 &&
                      lineItem.name.toLowerCase().includes(normalizedQuery);
                    const isDiscount = lineItem.price < 0;

                    return (
                      <View
                        key={lineItem.id}
                        style={[
                          styles.lineItemRow,
                          idx < item.items.length - 1 && styles.lineItemBorder,
                          isMatch && styles.lineItemMatch,
                        ]}
                      >
                        <View style={styles.lineItemLeft}>
                          <Text
                            style={[
                              styles.lineItemName,
                              isMatch && { color: Colors.primary, fontWeight: '700' },
                              isDiscount && { color: Colors.primary },
                            ]}
                            numberOfLines={1}
                          >
                            {lineItem.name}
                          </Text>
                          {lineItem.quantity !== 1 && (
                            <Text style={styles.lineItemQty}>×{lineItem.quantity}</Text>
                          )}
                        </View>
                        <Text
                          style={[
                            styles.lineItemPrice,
                            isDiscount && { color: Colors.primary },
                          ]}
                        >
                          {formatMoney(lineItem.price)}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          );
        }}
      />

      <ExpenseDetailModal
        expense={activeExpense}
        onClose={() => setActiveExpense(null)}
        onSave={editExpense}
        onDelete={removeExpense}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
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
  },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: Colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
  },
  exportBtnText: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  allMonthsBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  allMonthsBtnActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  allMonthsText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  monthSwitch: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  arrowBtn: {
    padding: 4,
  },
  monthLabel: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchInput: {
    flex: 1,
    color: Colors.text,
    paddingVertical: 10,
    fontSize: 14,
  },
  matchBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  matchBannerText: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  matchSubText: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '600',
  },
  chipsRow: {
    paddingHorizontal: 16,
    gap: 8,
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  chipActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primarySoft,
  },
  chipText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  chipTextActive: {
    color: Colors.primary,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  summaryCount: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  summaryTotal: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 10,
  },
  cardWrap: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 13,
  },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 3,
  },
  rowSub: {
    color: Colors.textMuted,
    fontSize: 12,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.accentSoft,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  tagText: {
    color: Colors.accent,
    fontSize: 10,
    fontWeight: '600',
  },
  itemsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: Colors.primary,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  itemsPillText: {
    color: Colors.primary,
    fontSize: 10,
    fontWeight: '700',
  },
  taxTag: {
    color: Colors.textSecondary,
    fontSize: 10,
    backgroundColor: Colors.bg,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  rowAmount: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  itemsDrawer: {
    backgroundColor: Colors.bg,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  lineItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 7,
    paddingHorizontal: 4,
    borderRadius: 6,
  },
  lineItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  lineItemMatch: {
    backgroundColor: Colors.primarySoft,
  },
  lineItemLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  lineItemName: {
    color: Colors.text,
    fontSize: 12,
    flexShrink: 1,
  },
  lineItemQty: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  lineItemPrice: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 56,
    gap: 10,
  },
  emptyText: {
    color: Colors.textMuted,
    fontSize: 14,
  },
});
