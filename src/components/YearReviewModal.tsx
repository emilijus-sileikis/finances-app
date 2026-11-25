import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFinances } from '@/db/FinanceContext';
import { computeYearReview, getAvailableYears } from '@/services/yearReview';
import { Colors } from '@/theme/colors';
import { formatDisplayDate, formatMonthLabel } from '@/utils/format';

interface YearReviewModalProps {
  visible: boolean;
  initialYear: number;
  onClose: () => void;
}

const MONTH_SHORT_EN = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH_SHORT_LT = ['S', 'V', 'K', 'B', 'G', 'B', 'L', 'R', 'R', 'S', 'L', 'G'];

export function YearReviewModal({
  visible,
  initialYear,
  onClose,
}: YearReviewModalProps) {
  const {
    language,
    t,
    expenses,
    monthlyIncome,
    formatMoney,
    resolveCategoryMeta,
    resolveCategoryLabel,
  } = useFinances();

  const availableYears = useMemo(() => getAvailableYears(expenses), [expenses]);
  const [pickedYear, setPickedYear] = useState<number | null>(null);
  const activeYear =
    pickedYear !== null && availableYears.includes(pickedYear)
      ? pickedYear
      : availableYears.includes(initialYear)
        ? initialYear
        : availableYears[0];

  const review = useMemo(
    () => computeYearReview(expenses, activeYear, monthlyIncome),
    [expenses, activeYear, monthlyIncome]
  );

  const maxMonthVal = useMemo(
    () => Math.max(1, ...review.monthlyTotals.map((m) => m.total)),
    [review.monthlyTotals]
  );

  const monthLetters = language === 'lt' ? MONTH_SHORT_LT : MONTH_SHORT_EN;

  const handleShareSummary = async () => {
    const topCat = review.topCategories[0];
    const topMerch = review.topMerchants[0];
    const lines = [
      `${t.yearReviewShareHeader(review.year)}`,
      `${t.yearReviewTotalSpent}: ${formatMoney(review.totalSpent)} (${t.txCount(review.receiptCount)})`,
      `${t.yearReviewAvgMonth}: ${formatMoney(review.avgMonthlySpend, false)} • ${t.yearReviewAvgDay}: ${formatMoney(review.avgDailySpend)}`,
      review.estimatedAnnualSaved !== null
        ? `${t.yearReviewEstSaved}: ${formatMoney(review.estimatedAnnualSaved, false)} (${review.savingsRatePct}%)`
        : null,
      topCat
        ? `${t.yearReviewTopCats}: #1 ${resolveCategoryLabel(topCat.category)} (${formatMoney(topCat.total, false)})`
        : null,
      topMerch
        ? `${t.yearReviewTopMerchants}: #1 ${topMerch.merchant} (${formatMoney(topMerch.total, false)})`
        : null,
      `${t.yearReviewTaxesPaid}: ${formatMoney(review.totalTaxes, false)}`,
      `${t.yearReviewNoSpendDays}: ${review.noSpendDaysYear}`,
    ].filter(Boolean);

    try {
      await Share.share({ message: lines.join('\n') });
    } catch {
      // Ignore cancelled share sheet
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.sparkIcon}>
                <Ionicons name="sparkles-outline" size={18} color={Colors.primary} />
              </View>
              <View>
                <Text style={styles.headerTitle}>{t.yearReviewTitle(review.year)}</Text>
                <Text style={styles.headerSub}>{t.yearReviewSub}</Text>
              </View>
            </View>
            <View style={styles.headerActions}>
              {review.receiptCount > 0 && (
                <Pressable onPress={() => void handleShareSummary()} style={styles.iconBtn}>
                  <Ionicons name="share-social-outline" size={19} color={Colors.primary} />
                </Pressable>
              )}
              <Pressable onPress={onClose} style={styles.iconBtn}>
                <Ionicons name="close" size={22} color={Colors.text} />
              </Pressable>
            </View>
          </View>

          {/* Year Selector Chips */}
          {availableYears.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.yearsRow}
            >
              {availableYears.map((y) => {
                const active = y === activeYear;
                return (
                  <Pressable
                    key={y}
                    onPress={() => setPickedYear(y)}
                    style={[styles.yearChip, active && styles.yearChipActive]}
                  >
                    <Text
                      style={[
                        styles.yearChipText,
                        active && { color: Colors.white },
                      ]}
                    >
                      {y}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          <ScrollView
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
          >
            {review.receiptCount === 0 ? (
              <View style={styles.emptyCard}>
                <Ionicons name="calendar-outline" size={34} color={Colors.textMuted} />
                <Text style={styles.emptyText}>{t.yearReviewEmpty(review.year)}</Text>
              </View>
            ) : (
              <>
                {/* Hero Card */}
                <View style={styles.heroCard}>
                  <View style={styles.heroTop}>
                    <Text style={styles.heroLabel}>{t.yearReviewTotalSpent}</Text>
                    {review.yoyChangePct !== null && (
                      <View
                        style={[
                          styles.yoyBadge,
                          {
                            backgroundColor:
                              review.yoyChangePct > 0
                                ? Colors.dangerSoft
                                : Colors.primarySoft,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.yoyText,
                            {
                              color:
                                review.yoyChangePct > 0
                                  ? Colors.danger
                                  : Colors.primary,
                            },
                          ]}
                        >
                          {review.yoyChangePct > 0 ? '+' : ''}
                          {review.yoyChangePct}% {t.yearReviewVsPrev(review.year - 1)}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.heroBig}>{formatMoney(review.totalSpent)}</Text>
                  <Text style={styles.heroSub}>
                    {t.yearReviewReceiptsSub(review.receiptCount, review.activeMonthsCount)}
                  </Text>

                  <View style={styles.heroStatsRow}>
                    <View style={styles.statTile}>
                      <Text style={styles.statLabel}>{t.yearReviewAvgMonth}</Text>
                      <Text style={styles.statVal}>
                        {formatMoney(review.avgMonthlySpend, false)}
                      </Text>
                    </View>
                    <View style={styles.statTile}>
                      <Text style={styles.statLabel}>{t.yearReviewAvgDay}</Text>
                      <Text style={styles.statVal}>
                        {formatMoney(review.avgDailySpend)}
                      </Text>
                    </View>
                  </View>

                  {review.estimatedAnnualSaved !== null && (
                    <View
                      style={[
                        styles.savedBanner,
                        review.estimatedAnnualSaved < 0 && {
                          backgroundColor: Colors.dangerSoft,
                          borderColor: Colors.danger,
                        },
                      ]}
                    >
                      <Ionicons
                        name={
                          review.estimatedAnnualSaved >= 0
                            ? 'trending-up'
                            : 'alert-circle-outline'
                        }
                        size={16}
                        color={
                          review.estimatedAnnualSaved >= 0
                            ? Colors.primary
                            : Colors.danger
                        }
                      />
                      <Text style={styles.savedBannerText}>
                        {t.yearReviewEstSaved}:{' '}
                        <Text style={{ fontWeight: '800' }}>
                          {review.estimatedAnnualSaved >= 0 ? '+' : ''}
                          {formatMoney(review.estimatedAnnualSaved, false)}
                        </Text>
                        {review.savingsRatePct !== null
                          ? ` (${review.savingsRatePct}%)`
                          : ''}
                      </Text>
                    </View>
                  )}
                </View>

                {/* 12-Month Breakdown Bar Chart */}
                <View style={styles.card}>
                  <Text style={styles.sectionTitle}>{t.yearReviewMonthlyChart}</Text>
                  <View style={styles.barsWrap}>
                    {review.monthlyTotals.map((m) => {
                      const pct =
                        m.total > 0 ? Math.max(8, Math.round((m.total / maxMonthVal) * 100)) : 3;
                      const isPeak =
                        review.biggestMonth !== null &&
                        m.monthKey === review.biggestMonth.monthKey;
                      return (
                        <View key={m.monthKey} style={styles.barCol}>
                          <View style={styles.barTrackVert}>
                            <View
                              style={[
                                styles.barFillVert,
                                {
                                  height: `${pct}%`,
                                  backgroundColor:
                                    m.total === 0
                                      ? Colors.border
                                      : isPeak
                                        ? Colors.warning
                                        : Colors.primary,
                                },
                              ]}
                            />
                          </View>
                          <Text
                            style={[
                              styles.barMonthText,
                              isPeak && { color: Colors.warning, fontWeight: '800' },
                            ]}
                          >
                            {monthLetters[m.monthIndex]}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                  {review.biggestMonth && (
                    <View style={styles.peakFooter}>
                      <Text style={styles.peakText}>
                        {t.yearReviewBiggestMonth}:{' '}
                        <Text style={{ color: Colors.warning, fontWeight: '700' }}>
                          {formatMonthLabel(review.biggestMonth.monthKey, language)} (
                          {formatMoney(review.biggestMonth.total, false)})
                        </Text>
                      </Text>
                      {review.lightestActiveMonth &&
                        review.lightestActiveMonth.monthKey !==
                          review.biggestMonth.monthKey && (
                          <Text style={styles.peakText}>
                            {t.yearReviewLightestMonth}:{' '}
                            <Text style={{ color: Colors.primary, fontWeight: '700' }}>
                              {formatMonthLabel(
                                review.lightestActiveMonth.monthKey,
                                language
                              )}{' '}
                              ({formatMoney(review.lightestActiveMonth.total, false)})
                            </Text>
                          </Text>
                        )}
                    </View>
                  )}
                </View>

                {/* Top 5 Categories */}
                <View style={styles.card}>
                  <Text style={styles.sectionTitle}>{t.yearReviewTopCats}</Text>
                  {review.topCategories.map((cat) => {
                    const meta = resolveCategoryMeta(cat.category);
                    const pct = Math.round(cat.share * 100);
                    return (
                      <View key={cat.category} style={styles.rankBlock}>
                        <View style={styles.rankTop}>
                          <View
                            style={[
                              styles.rankIcon,
                              { backgroundColor: `${meta.color}22` },
                            ]}
                          >
                            <Ionicons name={meta.icon} size={15} color={meta.color} />
                          </View>
                          <Text style={styles.rankName} numberOfLines={1}>
                            {resolveCategoryLabel(cat.category)}
                          </Text>
                          <Text style={styles.rankAmt}>
                            {formatMoney(cat.total, false)}{' '}
                            <Text style={styles.rankPct}>({pct}%)</Text>
                          </Text>
                        </View>
                        <View style={styles.rankTrack}>
                          <View
                            style={[
                              styles.rankFill,
                              {
                                width: `${Math.max(4, pct)}%`,
                                backgroundColor: meta.color,
                              },
                            ]}
                          />
                        </View>
                      </View>
                    );
                  })}
                </View>

                {/* Top 5 Merchants */}
                {review.topMerchants.length > 0 && (
                  <View style={styles.card}>
                    <Text style={styles.sectionTitle}>{t.yearReviewTopMerchants}</Text>
                    {review.topMerchants.map((m, idx) => (
                      <View
                        key={`${m.merchant}_${idx}`}
                        style={[
                          styles.merchantRow,
                          idx < review.topMerchants.length - 1 && styles.rowBorder,
                        ]}
                      >
                        <View style={styles.rankBadge}>
                          <Text style={styles.rankBadgeText}>#{idx + 1}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.merchantName} numberOfLines={1}>
                            {m.merchant}
                          </Text>
                          <Text style={styles.merchantVisits}>
                            {t.yearReviewVisits(m.count)}
                          </Text>
                        </View>
                        <Text style={styles.merchantTotal}>
                          {formatMoney(m.total, false)}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Highlights Strip: Taxes, No-Spend Days, Biggest Expense */}
                <View style={styles.highlightsRow}>
                  <View style={styles.highlightBox}>
                    <Ionicons
                      name="document-text-outline"
                      size={18}
                      color={Colors.danger}
                    />
                    <Text style={styles.statLabel}>{t.yearReviewTaxesPaid}</Text>
                    <Text style={styles.statVal}>
                      {formatMoney(review.totalTaxes, false)}
                    </Text>
                  </View>
                  <View style={styles.highlightBox}>
                    <Ionicons name="leaf-outline" size={18} color={Colors.primary} />
                    <Text style={styles.statLabel}>{t.yearReviewNoSpendDays}</Text>
                    <Text style={[styles.statVal, { color: Colors.primary }]}>
                      {review.noSpendDaysYear}
                    </Text>
                  </View>
                </View>

                {review.biggestExpense && (
                  <View style={styles.card}>
                    <Text style={styles.statLabel}>{t.yearReviewBiggestExpense}</Text>
                    <View style={styles.bigExpRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.merchantName} numberOfLines={1}>
                          {review.biggestExpense.title}
                        </Text>
                        <Text style={styles.merchantVisits}>
                          {resolveCategoryLabel(review.biggestExpense.category)} •{' '}
                          {formatDisplayDate(review.biggestExpense.date, language)}
                        </Text>
                      </View>
                      <Text style={styles.bigExpAmt}>
                        {formatMoney(review.biggestExpense.amount)}
                      </Text>
                    </View>
                  </View>
                )}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.78)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.bg,
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
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  sparkIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: '800',
  },
  headerSub: {
    color: Colors.textSecondary,
    fontSize: 11,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconBtn: {
    padding: 6,
  },
  yearsRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  yearChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 99,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  yearChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  yearChipText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  body: {
    padding: 16,
    paddingBottom: 34,
    gap: 12,
  },
  emptyCard: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 32,
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  emptyText: {
    color: Colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
  },
  heroCard: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.primary,
    gap: 8,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  heroLabel: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  yoyBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 99,
  },
  yoyText: {
    fontSize: 11,
    fontWeight: '700',
  },
  heroBig: {
    color: Colors.text,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  heroSub: {
    color: Colors.textMuted,
    fontSize: 12,
  },
  heroStatsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  statTile: {
    flex: 1,
    backgroundColor: Colors.bg,
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 2,
  },
  statLabel: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  statVal: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  savedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginTop: 2,
  },
  savedBannerText: {
    color: Colors.text,
    fontSize: 12,
    flex: 1,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10,
  },
  sectionTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  barsWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 5,
    height: 112,
    paddingTop: 6,
  },
  barCol: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
    height: '100%',
  },
  barTrackVert: {
    flex: 1,
    width: '100%',
    backgroundColor: Colors.bg,
    borderRadius: 6,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  barFillVert: {
    width: '100%',
    borderRadius: 6,
  },
  barMonthText: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
  },
  peakFooter: {
    gap: 3,
    paddingTop: 2,
  },
  peakText: {
    color: Colors.textSecondary,
    fontSize: 11,
  },
  rankBlock: {
    gap: 5,
  },
  rankTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rankIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankName: {
    flex: 1,
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  rankAmt: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  rankPct: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  rankTrack: {
    height: 6,
    backgroundColor: Colors.bg,
    borderRadius: 99,
    overflow: 'hidden',
  },
  rankFill: {
    height: '100%',
    borderRadius: 99,
  },
  merchantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 7,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rankBadge: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankBadgeText: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '800',
  },
  merchantName: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  merchantVisits: {
    color: Colors.textMuted,
    fontSize: 11,
  },
  merchantTotal: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  highlightsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  highlightBox: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 4,
  },
  bigExpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  bigExpAmt: {
    color: Colors.warning,
    fontSize: 16,
    fontWeight: '800',
  },
});
