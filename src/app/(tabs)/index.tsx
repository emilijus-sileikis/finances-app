import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DonutChart } from '@/components/DonutChart';
import { ExpenseDetailModal } from '@/components/ExpenseDetailModal';
import { getCategoryMeta } from '@/constants/categories';
import { useFinances } from '@/db/FinanceContext';
import { getCategoryLabel } from '@/i18n/translations';
import { isPdfUri } from '@/services/receiptStorage';
import { computeCategoryTotals, getMonthExpenses } from '@/services/savingsEngine';
import { Colors } from '@/theme/colors';
import type { CategoryId, Expense } from '@/types/finance';
import {
  formatDisplayDate,
  formatEur,
  formatMonthLabel,
  getCurrentMonthKey,
  getDaysInMonth,
  shiftMonthKey,
} from '@/utils/format';

export default function OverviewScreen() {
  const {
    ready,
    language,
    t,
    setLanguage,
    expenses,
    budgets,
    selectedMonth,
    setSelectedMonth,
    autoLoggedBannerCount,
    dismissAutoLoggedBanner,
    dueManualRecurring,
    logRecurringNow,
    editExpense,
    removeExpense,
  } = useFinances();

  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [expandedCategory, setExpandedCategory] = useState<CategoryId | null>(null);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_evt, gesture) => {
          return (
            Math.abs(gesture.dx) > 20 &&
            Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.6
          );
        },
        onPanResponderRelease: (_evt, gesture) => {
          if (Math.abs(gesture.dx) < 55) return;
          if (gesture.dx < -55) {
            // Swipe left -> next month
            setExpandedCategory(null);
            setSelectedMonth(shiftMonthKey(selectedMonth, 1));
          } else if (gesture.dx > 55) {
            // Swipe right -> previous month
            setExpandedCategory(null);
            setSelectedMonth(shiftMonthKey(selectedMonth, -1));
          }
        },
      }),
    [selectedMonth, setSelectedMonth]
  );

  const monthExpenses = useMemo(
    () => getMonthExpenses(expenses, selectedMonth),
    [expenses, selectedMonth]
  );

  const totalSpent = useMemo(
    () => monthExpenses.reduce((sum, e) => sum + e.amount, 0),
    [monthExpenses]
  );

  const totalTaxes = useMemo(
    () =>
      monthExpenses.reduce(
        (sum, e) => sum + (e.category === 'taxes' ? e.amount : e.taxAmount),
        0
      ),
    [monthExpenses]
  );

  const totalBudget = useMemo(
    () => budgets.reduce((sum, b) => sum + b.monthlyLimit, 0),
    [budgets]
  );

  // Sorted highest-to-lowest EUR amount
  const categoryTotals = useMemo(
    () => computeCategoryTotals(monthExpenses, budgets),
    [monthExpenses, budgets]
  );

  const expensesByCategory = useMemo(() => {
    const map = new Map<CategoryId, Expense[]>();
    for (const exp of monthExpenses) {
      const list = map.get(exp.category) ?? [];
      list.push(exp);
      map.set(exp.category, list);
    }
    return map;
  }, [monthExpenses]);

  const donutSlices = useMemo(
    () =>
      categoryTotals.map((ct) => {
        const meta = getCategoryMeta(ct.category);
        return {
          key: ct.category,
          label: getCategoryLabel(ct.category, language),
          value: ct.total,
          color: meta.color,
        };
      }),
    [categoryTotals, language]
  );

  const prevMonthSpent = useMemo(() => {
    const prevKey = shiftMonthKey(selectedMonth, -1);
    return getMonthExpenses(expenses, prevKey).reduce((s, e) => s + e.amount, 0);
  }, [expenses, selectedMonth]);

  const budgetRemaining = totalBudget > 0 ? totalBudget - totalSpent : null;
  const isCurrentMonth = selectedMonth === getCurrentMonthKey();
  const daysLeft = isCurrentMonth
    ? Math.max(1, getDaysInMonth(selectedMonth) - new Date().getDate() + 1)
    : 0;
  const safeDailySpend =
    budgetRemaining !== null && budgetRemaining > 0 && daysLeft > 0
      ? budgetRemaining / daysLeft
      : null;

  const handleSwitchMonth = (delta: number) => {
    setExpandedCategory(null);
    setSelectedMonth(shiftMonthKey(selectedMonth, delta));
  };

  if (!ready) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']} {...panResponder.panHandlers}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Top Bar: Title + Language Pill */}
        <View style={styles.topRow}>
          <View>
            <Text style={styles.appTitle}>{t.appTitle}</Text>
            <Text style={styles.appSub}>{t.appSub}</Text>
          </View>
          <View style={styles.langPill}>
            <Pressable
              onPress={() => setLanguage('en')}
              style={[styles.langBtn, language === 'en' && styles.langBtnActive]}
            >
              <Text style={[styles.langText, language === 'en' && styles.langTextActive]}>
                EN
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setLanguage('lt')}
              style={[styles.langBtn, language === 'lt' && styles.langBtnActive]}
            >
              <Text style={[styles.langText, language === 'lt' && styles.langTextActive]}>
                LT
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Month Switcher Bar (also supports swiping left/right!) */}
        <View style={styles.monthBar}>
          <Pressable onPress={() => handleSwitchMonth(-1)} style={styles.monthArrow}>
            <Ionicons name="chevron-back" size={20} color={Colors.text} />
          </Pressable>
          <View style={styles.monthCenter}>
            <Text style={styles.monthText}>{formatMonthLabel(selectedMonth, language)}</Text>
            <Text style={styles.swipeHintText}>{t.swipeHint}</Text>
          </View>
          <Pressable onPress={() => handleSwitchMonth(1)} style={styles.monthArrow}>
            <Ionicons name="chevron-forward" size={20} color={Colors.text} />
          </Pressable>
        </View>

        {/* Auto-logged recurring toast */}
        {autoLoggedBannerCount > 0 && (
          <View style={styles.infoBanner}>
            <Ionicons name="repeat" size={18} color={Colors.primary} />
            <Text style={styles.infoBannerText}>
              {autoLoggedBannerCount === 1
                ? t.autoLoggedOne
                : t.autoLoggedMany(autoLoggedBannerCount)}
            </Text>
            <Pressable onPress={dismissAutoLoggedBanner}>
              <Ionicons name="close" size={18} color={Colors.textSecondary} />
            </Pressable>
          </View>
        )}

        {/* Due manual recurring reminders */}
        {dueManualRecurring.length > 0 && (
          <View style={styles.dueCard}>
            <View style={styles.dueHeader}>
              <Ionicons name="time-outline" size={18} color={Colors.warning} />
              <Text style={styles.dueTitle}>
                {dueManualRecurring.length === 1
                  ? t.dueTitleOne
                  : t.dueTitleMany(dueManualRecurring.length)}
              </Text>
            </View>
            {dueManualRecurring.map((item) => (
              <View key={item.id} style={styles.dueRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.dueItemTitle}>{item.title}</Text>
                  <Text style={styles.dueItemSub}>
                    {getCategoryLabel(item.category, language)} • {formatEur(item.amount)}
                  </Text>
                </View>
                <Pressable
                  onPress={() => logRecurringNow(item)}
                  style={styles.dueLogBtn}
                >
                  <Text style={styles.dueLogBtnText}>
                    {t.logBtn(formatEur(item.amount))}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {/* Empty first-run onboarding card */}
        {expenses.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="receipt-outline" size={32} color={Colors.primary} />
            </View>
            <Text style={styles.emptyTitle}>{t.emptyTitle}</Text>
            <Text style={styles.emptyDesc}>{t.emptyDesc}</Text>
            <View style={styles.emptyActions}>
              <Pressable
                onPress={() => router.push('/scan')}
                style={styles.primaryBtn}
              >
                <Ionicons name="scan-outline" size={18} color={Colors.white} />
                <Text style={styles.primaryBtnText}>{t.scanOrAddBtn}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <>
            {/* Hero Donut Card */}
            <View style={styles.card}>
              <DonutChart
                slices={donutSlices}
                total={totalSpent}
                subtitle={formatMonthLabel(selectedMonth, language).split(' ')[0]}
              />

              {/* Quick KPI Strip */}
              <View style={styles.kpiRow}>
                <View style={styles.kpiBox}>
                  <Text style={styles.kpiLabel}>{t.vsLastMonth}</Text>
                  <Text
                    style={[
                      styles.kpiValue,
                      prevMonthSpent > 0 && totalSpent > prevMonthSpent
                        ? { color: Colors.warning }
                        : { color: Colors.primary },
                    ]}
                  >
                    {prevMonthSpent > 0
                      ? `${totalSpent >= prevMonthSpent ? '+' : '-'}${formatEur(
                          Math.abs(totalSpent - prevMonthSpent),
                          false
                        )}`
                      : '—'}
                  </Text>
                </View>

                <View style={styles.kpiDivider} />

                <View style={styles.kpiBox}>
                  <Text style={styles.kpiLabel}>
                    {budgetRemaining !== null ? t.budgetLeft : t.receiptsCount}
                  </Text>
                  <Text
                    style={[
                      styles.kpiValue,
                      budgetRemaining !== null && budgetRemaining < 0
                        ? { color: Colors.danger }
                        : { color: Colors.text },
                    ]}
                  >
                    {budgetRemaining !== null
                      ? formatEur(budgetRemaining, false)
                      : String(monthExpenses.length)}
                  </Text>
                </View>

                <View style={styles.kpiDivider} />

                <View style={styles.kpiBox}>
                  <Text style={styles.kpiLabel}>{t.taxesAndVat}</Text>
                  <Text style={styles.kpiValue}>{formatEur(totalTaxes, false)}</Text>
                </View>
              </View>

              {safeDailySpend !== null && (
                <View style={styles.dailyPill}>
                  <Ionicons name="shield-checkmark-outline" size={15} color={Colors.primary} />
                  <Text style={styles.dailyPillText}>
                    {t.safeDailyBudget(formatEur(safeDailySpend), daysLeft)}
                  </Text>
                </View>
              )}
            </View>

            {/* Expandable Category Breakdown (Sorted Highest -> Lowest) */}
            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionTitle}>{t.whereMoneyWent}</Text>
                {categoryTotals.length > 0 && (
                  <Text style={styles.sectionHint}>{t.tapToExpandHint}</Text>
                )}
              </View>
              <Pressable onPress={() => router.push('/budgets')}>
                <Text style={styles.sectionLink}>{t.editBudgets}</Text>
              </Pressable>
            </View>

            <View style={styles.card}>
              {categoryTotals.length === 0 ? (
                <Text style={styles.mutedCenter}>{t.noExpensesMonth}</Text>
              ) : (
                categoryTotals.map((item, idx) => {
                  const meta = getCategoryMeta(item.category);
                  const catLabel = getCategoryLabel(item.category, language);
                  const pct = Math.round(item.share * 100);
                  const budgetRatio =
                    item.budget && item.budget > 0 ? item.total / item.budget : null;
                  const barColor =
                    budgetRatio !== null
                      ? budgetRatio >= 1
                        ? Colors.danger
                        : budgetRatio >= 0.8
                          ? Colors.warning
                          : meta.color
                      : meta.color;
                  const fillWidth = `${Math.min(
                    100,
                    Math.max(4, (budgetRatio !== null ? budgetRatio : item.share) * 100)
                  )}%` as `${number}%`;

                  const isExpanded = expandedCategory === item.category;
                  const catItems = expensesByCategory.get(item.category) ?? [];

                  return (
                    <View
                      key={item.category}
                      style={[
                        styles.catBlock,
                        idx < categoryTotals.length - 1 && styles.catDivider,
                      ]}
                    >
                      <Pressable
                        onPress={() =>
                          setExpandedCategory((prev) =>
                            prev === item.category ? null : item.category
                          )
                        }
                        style={styles.catRow}
                      >
                        <View style={[styles.catIcon, { backgroundColor: `${meta.color}22` }]}>
                          <Ionicons name={meta.icon} size={18} color={meta.color} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <View style={styles.catTopLine}>
                            <View style={styles.catNameWrap}>
                              <Text style={styles.catName} numberOfLines={1}>
                                {catLabel}
                              </Text>
                              <View style={styles.countBadge}>
                                <Text style={styles.countBadgeText}>{item.count}</Text>
                              </View>
                            </View>
                            <View style={styles.catRightWrap}>
                              <Text style={styles.catAmount}>
                                {formatEur(item.total)}
                                {item.budget ? (
                                  <Text style={styles.catBudgetSub}>
                                    {' '}
                                    / {formatEur(item.budget, false)}
                                  </Text>
                                ) : (
                                  <Text style={styles.catBudgetSub}> ({pct}%)</Text>
                                )}
                              </Text>
                              <Ionicons
                                name={isExpanded ? 'chevron-up' : 'chevron-down'}
                                size={16}
                                color={Colors.textMuted}
                              />
                            </View>
                          </View>
                          <View style={styles.barTrack}>
                            <View
                              style={[
                                styles.barFill,
                                { width: fillWidth, backgroundColor: barColor },
                              ]}
                            />
                          </View>
                        </View>
                      </Pressable>

                      {/* Expanded inline list of expenses in this category */}
                      {isExpanded && (
                        <View style={styles.expandedList}>
                          {catItems.map((exp, expIdx) => {
                            const expIsPdf = isPdfUri(exp.receiptUri);
                            return (
                              <Pressable
                                key={exp.id}
                                onPress={() => setSelectedExpense(exp)}
                                style={[
                                  styles.expandedRow,
                                  expIdx < catItems.length - 1 && styles.expandedBorder,
                                ]}
                              >
                                <View style={{ flex: 1 }}>
                                  <Text style={styles.expandedTitle} numberOfLines={1}>
                                    {exp.title}
                                  </Text>
                                  <View style={styles.expandedMetaRow}>
                                    <Text style={styles.expandedDate}>
                                      {formatDisplayDate(exp.date, language)}
                                      {exp.merchant && exp.merchant !== exp.title
                                        ? ` • ${exp.merchant}`
                                        : ''}
                                    </Text>
                                    {exp.receiptUri && (
                                      <View style={styles.miniBadge}>
                                        <Ionicons
                                          name={expIsPdf ? 'document-text-outline' : 'image-outline'}
                                          size={10}
                                          color={expIsPdf ? Colors.danger : Colors.accent}
                                        />
                                        <Text
                                          style={[
                                            styles.miniBadgeText,
                                            expIsPdf && { color: Colors.danger },
                                          ]}
                                        >
                                          {expIsPdf ? t.pdfTag : t.receiptTag}
                                        </Text>
                                      </View>
                                    )}
                                    {exp.items.length > 0 && (
                                      <View style={styles.miniBadge}>
                                        <Ionicons
                                          name="list-outline"
                                          size={10}
                                          color={Colors.primary}
                                        />
                                        <Text
                                          style={[
                                            styles.miniBadgeText,
                                            { color: Colors.primary },
                                          ]}
                                        >
                                          {t.itemBadge(exp.items.length)}
                                        </Text>
                                      </View>
                                    )}
                                  </View>
                                </View>
                                <Text style={styles.expandedAmount}>
                                  {formatEur(exp.amount)}
                                </Text>
                                <Ionicons
                                  name="chevron-forward"
                                  size={14}
                                  color={Colors.textMuted}
                                />
                              </Pressable>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  );
                })
              )}
            </View>

            {/* Recent Expenses */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t.recentActivity}</Text>
              <Pressable onPress={() => router.push('/expenses')}>
                <Text style={styles.sectionLink}>{t.seeAll}</Text>
              </Pressable>
            </View>

            <View style={styles.card}>
              {monthExpenses.length === 0 ? (
                <Text style={styles.mutedCenter}>{t.tapScanHint}</Text>
              ) : (
                monthExpenses.slice(0, 6).map((exp, idx) => {
                  const meta = getCategoryMeta(exp.category);
                  const expIsPdf = isPdfUri(exp.receiptUri);
                  return (
                    <Pressable
                      key={exp.id}
                      onPress={() => setSelectedExpense(exp)}
                      style={[
                        styles.txRow,
                        idx < Math.min(monthExpenses.length, 6) - 1 && styles.txBorder,
                      ]}
                    >
                      <View style={[styles.catIcon, { backgroundColor: `${meta.color}20` }]}>
                        <Ionicons name={meta.icon} size={18} color={meta.color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.txTitle} numberOfLines={1}>
                          {exp.title}
                        </Text>
                        <Text style={styles.txSub}>
                          {getCategoryLabel(exp.category, language)} •{' '}
                          {formatDisplayDate(exp.date, language)}
                          {exp.receiptUri
                            ? ` • ${expIsPdf ? t.pdfTag : t.receiptTag}`
                            : ''}
                        </Text>
                      </View>
                      <Text style={styles.txAmount}>-{formatEur(exp.amount)}</Text>
                    </Pressable>
                  );
                })
              )}
            </View>
          </>
        )}
      </ScrollView>

      <ExpenseDetailModal
        expense={selectedExpense}
        onClose={() => setSelectedExpense(null)}
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
  center: {
    flex: 1,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    paddingHorizontal: 16,
    paddingBottom: 28,
    gap: 14,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
  },
  appTitle: {
    color: Colors.text,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  appSub: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '600',
  },
  langPill: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 3,
    gap: 2,
  },
  langBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 7,
  },
  langBtnActive: {
    backgroundColor: Colors.primary,
  },
  langText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
  langTextActive: {
    color: Colors.white,
  },
  monthBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  monthArrow: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthCenter: {
    alignItems: 'center',
    flex: 1,
  },
  monthText: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  swipeHintText: {
    color: Colors.textMuted,
    fontSize: 10,
    marginTop: 2,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: 14,
    padding: 12,
  },
  infoBannerText: {
    flex: 1,
    color: Colors.text,
    fontSize: 13,
  },
  dueCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.warning,
    gap: 10,
  },
  dueHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dueTitle: {
    color: Colors.warning,
    fontSize: 14,
    fontWeight: '700',
  },
  dueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dueItemTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  dueItemSub: {
    color: Colors.textSecondary,
    fontSize: 12,
  },
  dueLogBtn: {
    backgroundColor: Colors.warning,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  dueLogBtnText: {
    color: Colors.black,
    fontSize: 12,
    fontWeight: '700',
  },
  emptyCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    marginTop: 12,
  },
  emptyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  emptyDesc: {
    color: Colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  emptyActions: {
    width: '100%',
    gap: 10,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: 14,
  },
  primaryBtnText: {
    color: Colors.white,
    fontSize: 15,
    fontWeight: '700',
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12,
  },
  kpiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bg,
    borderRadius: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  kpiBox: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  kpiDivider: {
    width: 1,
    height: 28,
    backgroundColor: Colors.border,
  },
  kpiLabel: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
    marginBottom: 3,
    textAlign: 'center',
  },
  kpiValue: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  dailyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.primarySoft,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  dailyPillText: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  sectionTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  sectionHint: {
    color: Colors.textMuted,
    fontSize: 11,
    marginTop: 1,
  },
  sectionLink: {
    color: Colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  catBlock: {
    paddingVertical: 4,
  },
  catDivider: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingBottom: 12,
  },
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  catIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catTopLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
    gap: 8,
  },
  catNameWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  catName: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
  },
  countBadge: {
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 99,
  },
  countBadgeText: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
  },
  catRightWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  catAmount: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  catBudgetSub: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  barTrack: {
    height: 7,
    backgroundColor: Colors.bg,
    borderRadius: 99,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 99,
  },
  expandedList: {
    marginTop: 10,
    marginLeft: 12,
    backgroundColor: Colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  expandedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 9,
  },
  expandedBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  expandedTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  expandedMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  expandedDate: {
    color: Colors.textMuted,
    fontSize: 11,
  },
  miniBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.surface,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 5,
  },
  miniBadgeText: {
    color: Colors.accent,
    fontSize: 10,
    fontWeight: '600',
  },
  expandedAmount: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  txBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  txTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  txSub: {
    color: Colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  txAmount: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  mutedCenter: {
    color: Colors.textMuted,
    textAlign: 'center',
    paddingVertical: 10,
    fontSize: 13,
  },
});
