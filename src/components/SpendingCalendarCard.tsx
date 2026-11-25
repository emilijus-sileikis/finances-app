import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFinances } from '@/db/FinanceContext';
import { computeMonthCalendar, type DaySpendSummary } from '@/services/calendarAnalytics';
import type { ThemeColors } from '@/theme/colors';
import type { Expense } from '@/types/finance';
import { formatDisplayDate } from '@/utils/format';

interface SpendingCalendarCardProps {
  monthKey: string;
  monthExpenses: Expense[];
  onSelectExpense: (expense: Expense) => void;
}

const WEEKDAYS_EN = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const WEEKDAYS_LT = ['Pr', 'An', 'Tr', 'Kt', 'Pn', 'Št', 'Sk'];

function getTileStyle(cell: DaySpendSummary, Colors: ThemeColors) {
  if (cell.isFuture) {
    return { bg: 'transparent', border: Colors.border, text: Colors.textMuted };
  }
  if (cell.level === 0) {
    return { bg: Colors.primarySoft, border: 'rgba(16, 185, 129, 0.35)', text: Colors.primary };
  }
  if (cell.level === 1) {
    return { bg: Colors.accentSoft, border: 'rgba(56, 189, 248, 0.45)', text: Colors.accent };
  }
  if (cell.level === 2) {
    return { bg: Colors.warningSoft, border: 'rgba(245, 158, 11, 0.5)', text: Colors.warning };
  }
  return { bg: Colors.dangerSoft, border: 'rgba(239, 68, 68, 0.55)', text: Colors.danger };
}

export function SpendingCalendarCard({
  monthKey,
  monthExpenses,
  onSelectExpense,
}: SpendingCalendarCardProps) {
  const {
    language,
    t,
    currency,
    formatMoney,
    resolveCategoryMeta,
    resolveCategoryLabel,
    colors: Colors,
  } = useFinances();
  const styles = useMemo(() => createStyles(Colors), [Colors]);

  const [selectedIso, setSelectedIso] = useState<string | null>(null);
  const activeIso = selectedIso && selectedIso.startsWith(monthKey) ? selectedIso : null;

  const stats = useMemo(
    () => computeMonthCalendar(monthExpenses, monthKey, currency),
    [monthExpenses, monthKey, currency]
  );

  const selectedDayExpenses = useMemo(() => {
    if (!activeIso) return [];
    return monthExpenses.filter((e) => e.date === activeIso);
  }, [monthExpenses, activeIso]);

  const selectedDaySummary = useMemo(
    () => (activeIso ? stats.days.find((d) => d.isoDate === activeIso) ?? null : null),
    [stats.days, activeIso]
  );

  const weekdays = language === 'lt' ? WEEKDAYS_LT : WEEKDAYS_EN;

  // Build rows of 7 cells for clean alignment across all screen widths
  const weeks = useMemo(() => {
    const flat: (DaySpendSummary | null)[] = [
      ...Array.from({ length: stats.leadingBlanks }, () => null),
      ...stats.days,
    ];
    while (flat.length % 7 !== 0) {
      flat.push(null);
    }
    const rows: (DaySpendSummary | null)[][] = [];
    for (let i = 0; i < flat.length; i += 7) {
      rows.push(flat.slice(i, i + 7));
    }
    return rows;
  }, [stats.leadingBlanks, stats.days]);

  return (
    <View style={styles.card}>
      {/* Header + No-Spend Streak Badge */}
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t.calendarTitle}</Text>
          <Text style={styles.sub}>{t.calendarSub}</Text>
        </View>
        {stats.currentNoSpendStreak > 0 && (
          <View style={styles.streakPill}>
            <Ionicons name="flame-outline" size={14} color={Colors.primary} />
            <Text style={styles.streakText}>
              {t.noSpendStreakBadge(stats.currentNoSpendStreak)}
            </Text>
          </View>
        )}
      </View>

      {/* Mini Stats Row */}
      <View style={styles.kpiRow}>
        <View style={styles.kpiBox}>
          <Text style={styles.kpiLabel}>{t.calendarNoSpendLabel}</Text>
          <Text style={[styles.kpiVal, { color: Colors.primary }]}>
            {stats.noSpendDaysCount}
          </Text>
        </View>
        <View style={styles.kpiBox}>
          <Text style={styles.kpiLabel}>{t.calendarBestStreakLabel}</Text>
          <Text style={styles.kpiVal}>{t.calendarDaysUnit(stats.longestNoSpendStreak)}</Text>
        </View>
        <View style={styles.kpiBox}>
          <Text style={styles.kpiLabel}>{t.calendarPeakDayLabel}</Text>
          <Text
            style={[
              styles.kpiVal,
              stats.maxDailySpend > 0 && { color: Colors.warning },
            ]}
          >
            {stats.maxDailySpend > 0 ? formatMoney(stats.maxDailySpend, false) : '—'}
          </Text>
        </View>
      </View>

      {/* Weekday Header */}
      <View style={styles.weekRow}>
        {weekdays.map((wd, idx) => (
          <Text key={`${wd}_${idx}`} style={styles.weekdayText}>
            {wd}
          </Text>
        ))}
      </View>

      {/* Calendar Heatmap Grid */}
      <View style={styles.grid}>
        {weeks.map((week, wIdx) => (
          <View key={`w_${wIdx}`} style={styles.weekRow}>
            {week.map((cell, cIdx) => {
              if (!cell) {
                return <View key={`blank_${wIdx}_${cIdx}`} style={styles.cellSpacer} />;
              }
              const tone = getTileStyle(cell, Colors);
              const isSelected = activeIso === cell.isoDate;

              return (
                <Pressable
                  key={cell.isoDate}
                  onPress={() =>
                    setSelectedIso((prev) => (prev === cell.isoDate ? null : cell.isoDate))
                  }
                  style={[
                    styles.cell,
                    {
                      backgroundColor: tone.bg,
                      borderColor: isSelected
                        ? Colors.text
                        : cell.isToday
                          ? Colors.primary
                          : tone.border,
                    },
                    (isSelected || cell.isToday) && { borderWidth: 1.8 },
                    cell.isFuture && { opacity: 0.4 },
                  ]}
                >
                  <Text style={[styles.dayNum, { color: tone.text }]}>{cell.day}</Text>
                  {cell.count > 0 && (
                    <View
                      style={[
                        styles.spendDot,
                        { backgroundColor: tone.text },
                      ]}
                    />
                  )}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>

      {/* Legend */}
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: Colors.primarySoft, borderColor: Colors.primary }]} />
          <Text style={styles.legendText}>{t.calendarLegendZero}</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: Colors.accentSoft, borderColor: Colors.accent }]} />
          <Text style={styles.legendText}>{t.calendarLegendLow}</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: Colors.warningSoft, borderColor: Colors.warning }]} />
          <Text style={styles.legendText}>{t.calendarLegendMed}</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: Colors.dangerSoft, borderColor: Colors.danger }]} />
          <Text style={styles.legendText}>{t.calendarLegendHigh}</Text>
        </View>
      </View>

      {/* Selected Day Drawer */}
      {selectedDaySummary && (
        <View style={styles.dayDrawer}>
          <View style={styles.drawerHeader}>
            <Text style={styles.drawerDate}>
              {formatDisplayDate(selectedDaySummary.isoDate, language)}
            </Text>
            <Text
              style={[
                styles.drawerTotal,
                selectedDaySummary.total === 0 && { color: Colors.primary },
              ]}
            >
              {selectedDaySummary.total > 0
                ? formatMoney(selectedDaySummary.total)
                : t.calendarNoSpendDayBadge}
            </Text>
          </View>

          {selectedDayExpenses.length === 0 ? (
            <Text style={styles.drawerEmpty}>
              {selectedDaySummary.isFuture
                ? t.calendarFutureDayHint
                : t.calendarNoSpendDayMsg}
            </Text>
          ) : (
            selectedDayExpenses.map((exp, idx) => {
              const meta = resolveCategoryMeta(exp.category);
              return (
                <Pressable
                  key={exp.id}
                  onPress={() => onSelectExpense(exp)}
                  style={[
                    styles.drawerRow,
                    idx < selectedDayExpenses.length - 1 && styles.drawerRowBorder,
                  ]}
                >
                  <View style={[styles.drawerIcon, { backgroundColor: `${meta.color}22` }]}>
                    <Ionicons name={meta.icon} size={14} color={meta.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.drawerTitle} numberOfLines={1}>
                      {exp.title}
                    </Text>
                    <Text style={styles.drawerCat}>
                      {resolveCategoryLabel(exp.category)}
                    </Text>
                  </View>
                  <Text style={styles.drawerAmt}>-{formatMoney(exp.amount)}</Text>
                </Pressable>
              );
            })
          )}
        </View>
      )}
    </View>
  );
}

const createStyles = (Colors: ThemeColors) => StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  sub: {
    color: Colors.textMuted,
    fontSize: 11,
    marginTop: 1,
  },
  streakPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: Colors.primary,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 99,
  },
  streakText: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '700',
  },
  kpiRow: {
    flexDirection: 'row',
    gap: 8,
  },
  kpiBox: {
    flex: 1,
    backgroundColor: Colors.bg,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    gap: 2,
  },
  kpiLabel: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
  },
  kpiVal: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  weekRow: {
    flexDirection: 'row',
    gap: 5,
  },
  weekdayText: {
    flex: 1,
    textAlign: 'center',
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
  },
  grid: {
    gap: 5,
  },
  cellSpacer: {
    flex: 1,
    height: 36,
  },
  cell: {
    flex: 1,
    height: 36,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  dayNum: {
    fontSize: 12,
    fontWeight: '700',
  },
  spendDot: {
    width: 4,
    height: 4,
    borderRadius: 99,
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 2,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendSwatch: {
    width: 10,
    height: 10,
    borderRadius: 3,
    borderWidth: 1,
  },
  legendText: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
  },
  dayDrawer: {
    backgroundColor: Colors.bg,
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    gap: 6,
  },
  drawerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  drawerDate: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  drawerTotal: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '800',
  },
  drawerEmpty: {
    color: Colors.textSecondary,
    fontSize: 12,
  },
  drawerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  drawerRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  drawerIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  drawerCat: {
    color: Colors.textMuted,
    fontSize: 10,
  },
  drawerAmt: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
});
