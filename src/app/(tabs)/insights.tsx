import React, { useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TrendBarChart } from '@/components/TrendBarChart';
import { useFinances } from '@/db/FinanceContext';
import {
  exportExpensesCsv,
  exportFullBackupJson,
} from '@/services/receiptStorage';
import {
  computeDiscretionaryTotal,
  computeMonthlyTrend,
  generateSavingsTips,
  getMonthExpenses,
} from '@/services/savingsEngine';
import { Colors } from '@/theme/colors';
import { formatEur, formatMonthLabel } from '@/utils/format';

const TRIM_OPTIONS = [10, 15, 20, 30, 50] as const;

export default function InsightsScreen() {
  const {
    language,
    t,
    setLanguage,
    expenses,
    budgets,
    recurring,
    selectedMonth,
    resetAllData,
  } = useFinances();

  const [trimPercent, setTrimPercent] = useState<number>(20);

  const monthExpenses = useMemo(
    () => getMonthExpenses(expenses, selectedMonth),
    [expenses, selectedMonth]
  );

  const tips = useMemo(
    () => generateSavingsTips(expenses, budgets, recurring, selectedMonth, language),
    [expenses, budgets, recurring, selectedMonth, language]
  );

  const trend = useMemo(
    () => computeMonthlyTrend(expenses, selectedMonth, 6),
    [expenses, selectedMonth]
  );

  const discretionaryTotal = useMemo(
    () => computeDiscretionaryTotal(monthExpenses),
    [monthExpenses]
  );

  const simulatedMonthly = (discretionaryTotal * trimPercent) / 100;
  const simulatedYearly = simulatedMonthly * 12;

  const maxTipSavings = useMemo(
    () => tips.reduce((sum, item) => sum + (item.potentialMonthlySavings ?? 0), 0),
    [tips]
  );

  const selectedYear = selectedMonth.slice(0, 4);
  const ytdTaxes = useMemo(
    () =>
      expenses
        .filter((e) => e.date.startsWith(selectedYear))
        .reduce(
          (sum, e) => sum + (e.category === 'taxes' ? e.amount : e.taxAmount),
          0
        ),
    [expenses, selectedYear]
  );

  const monthTaxes = useMemo(
    () =>
      monthExpenses.reduce(
        (sum, e) => sum + (e.category === 'taxes' ? e.amount : e.taxAmount),
        0
      ),
    [monthExpenses]
  );

  const handleExportBackup = async () => {
    try {
      await exportFullBackupJson({ expenses, budgets, recurring });
    } catch {
      Alert.alert('JSON', 'Could not export JSON backup.');
    }
  };

  const handleExportCsv = async () => {
    if (expenses.length === 0) {
      Alert.alert(t.nothingToExport, t.addExpensesFirst);
      return;
    }
    try {
      await exportExpensesCsv(expenses);
    } catch {
      Alert.alert('CSV', 'Could not export CSV.');
    }
  };

  const handleReset = () => {
    Alert.alert(t.resetTitle, t.resetBody, [
      { text: t.cancel, style: 'cancel' },
      { text: t.deleteEverything, style: 'destructive', onPress: resetAllData },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.pageTitle}>{t.savingsTitle}</Text>
          <Text style={styles.pageSub}>
            {t.savingsSub(formatMonthLabel(selectedMonth, language))}
          </Text>
        </View>

        {/* Potential Savings Highlight */}
        {maxTipSavings > 0 && (
          <View style={styles.highlightCard}>
            <View style={styles.highlightIcon}>
              <Ionicons name="trending-up" size={24} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.highlightLabel}>{t.estSavingTitle}</Text>
              <Text style={styles.highlightBig}>
                {t.upToPerMonth(
                  formatEur(Math.min(maxTipSavings, discretionaryTotal || maxTipSavings))
                )}
              </Text>
              <Text style={styles.highlightSub}>{t.estSavingSub}</Text>
            </View>
          </View>
        )}

        {/* Actionable Tips */}
        <Text style={styles.sectionTitle}>{t.actionableSuggestions}</Text>
        {tips.map((tip) => {
          const accent =
            tip.severity === 'high'
              ? Colors.danger
              : tip.severity === 'medium'
                ? Colors.warning
                : Colors.primary;
          const icon =
            tip.severity === 'high'
              ? 'alert-circle-outline'
              : tip.severity === 'medium'
                ? 'bulb-outline'
                : 'checkmark-circle-outline';

          return (
            <View key={tip.id} style={[styles.tipCard, { borderLeftColor: accent }]}>
              <View style={styles.tipHeader}>
                <Ionicons name={icon} size={19} color={accent} />
                <Text style={styles.tipTitle}>{tip.title}</Text>
              </View>
              <Text style={styles.tipBody}>{tip.body}</Text>
              {tip.potentialMonthlySavings && tip.potentialMonthlySavings >= 5 ? (
                <View style={styles.savingsPill}>
                  <Text style={[styles.savingsPillText, { color: accent }]}>
                    {t.potentialImpact(
                      formatEur(tip.potentialMonthlySavings),
                      formatEur(tip.potentialMonthlySavings * 12, false)
                    )}
                  </Text>
                </View>
              ) : null}
            </View>
          );
        })}

        {/* What-If Savings Simulator */}
        <Text style={styles.sectionTitle}>{t.simulatorTitle}</Text>
        <View style={styles.card}>
          <Text style={styles.simDesc}>
            {t.simulatorDesc}
            <Text style={styles.bold}>{formatEur(discretionaryTotal)}</Text>
          </Text>
          <Text style={styles.simSub}>{t.ifYouTrim}</Text>
          <View style={styles.trimRow}>
            {TRIM_OPTIONS.map((pct) => {
              const active = trimPercent === pct;
              return (
                <Pressable
                  key={pct}
                  onPress={() => setTrimPercent(pct)}
                  style={[styles.trimBtn, active && styles.trimBtnActive]}
                >
                  <Text style={[styles.trimText, active && { color: Colors.white }]}>
                    {pct}%
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.simResultRow}>
            <View style={styles.simBox}>
              <Text style={styles.simBoxLabel}>{t.youSaveMonthly}</Text>
              <Text style={styles.simBoxVal}>{formatEur(simulatedMonthly)}</Text>
            </View>
            <View style={styles.simBox}>
              <Text style={styles.simBoxLabel}>{t.youSaveYearly}</Text>
              <Text style={[styles.simBoxVal, { color: Colors.primary }]}>
                {formatEur(simulatedYearly, false)}
              </Text>
            </View>
          </View>
        </View>

        {/* 6-Month Trend */}
        <Text style={styles.sectionTitle}>{t.trendTitle}</Text>
        <View style={styles.card}>
          <TrendBarChart
            data={trend}
            selectedMonth={selectedMonth}
            language={language}
            emptyLabel={t.trendEmpty}
          />
        </View>

        {/* Tax & VAT Tracker */}
        <Text style={styles.sectionTitle}>{t.taxesSummaryTitle}</Text>
        <View style={styles.card}>
          <View style={styles.simResultRow}>
            <View style={styles.simBox}>
              <Text style={styles.simBoxLabel}>{t.thisMonthTaxes}</Text>
              <Text style={styles.simBoxVal}>{formatEur(monthTaxes)}</Text>
            </View>
            <View style={styles.simBox}>
              <Text style={styles.simBoxLabel}>{t.ytdTaxes(selectedYear)}</Text>
              <Text style={styles.simBoxVal}>{formatEur(ytdTaxes)}</Text>
            </View>
          </View>
        </View>

        {/* Language Setting */}
        <Text style={styles.sectionTitle}>{t.languageSectionTitle}</Text>
        <View style={styles.card}>
          <View style={styles.langRow}>
            <Pressable
              onPress={() => setLanguage('en')}
              style={[
                styles.langOption,
                language === 'en' && styles.langOptionActive,
              ]}
            >
              <Ionicons
                name={language === 'en' ? 'radio-button-on' : 'radio-button-off'}
                size={18}
                color={language === 'en' ? Colors.primary : Colors.textMuted}
              />
              <Text
                style={[
                  styles.langOptionText,
                  language === 'en' && { color: Colors.text },
                ]}
              >
                English
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setLanguage('lt')}
              style={[
                styles.langOption,
                language === 'lt' && styles.langOptionActive,
              ]}
            >
              <Ionicons
                name={language === 'lt' ? 'radio-button-on' : 'radio-button-off'}
                size={18}
                color={language === 'lt' ? Colors.primary : Colors.textMuted}
              />
              <Text
                style={[
                  styles.langOptionText,
                  language === 'lt' && { color: Colors.text },
                ]}
              >
                Lietuvių
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Local Data & Backup */}
        <Text style={styles.sectionTitle}>{t.localDataTitle}</Text>
        <View style={styles.card}>
          <Text style={styles.backupNote}>{t.localDataNote}</Text>
          <View style={styles.backupRow}>
            <Pressable onPress={handleExportCsv} style={styles.backupBtn}>
              <Ionicons name="document-outline" size={16} color={Colors.primary} />
              <Text style={styles.backupBtnText}>{t.exportCsv}</Text>
            </Pressable>
            <Pressable onPress={handleExportBackup} style={styles.backupBtn}>
              <Ionicons name="code-download-outline" size={16} color={Colors.accent} />
              <Text style={[styles.backupBtnText, { color: Colors.accent }]}>
                {t.backupJson}
              </Text>
            </Pressable>
          </View>

          <Pressable onPress={handleReset} style={styles.dangerBtn}>
            <Ionicons name="trash-outline" size={15} color={Colors.danger} />
            <Text style={styles.dangerBtnText}>{t.resetAll}</Text>
          </Pressable>
        </View>
      </ScrollView>
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
    gap: 12,
  },
  header: {
    paddingTop: 8,
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
  highlightCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: Colors.primarySoft,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  highlightIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  highlightLabel: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  highlightBig: {
    color: Colors.text,
    fontSize: 22,
    fontWeight: '800',
    marginVertical: 2,
  },
  highlightSub: {
    color: Colors.textSecondary,
    fontSize: 12,
  },
  sectionTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 6,
  },
  tipCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    borderLeftWidth: 4,
    gap: 6,
  },
  tipHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tipTitle: {
    flex: 1,
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  tipBody: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  savingsPill: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.bg,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    marginTop: 2,
  },
  savingsPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12,
  },
  simDesc: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  bold: {
    color: Colors.text,
    fontWeight: '700',
  },
  simSub: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  trimRow: {
    flexDirection: 'row',
    gap: 8,
  },
  trimBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  trimBtnActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  trimText: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  simResultRow: {
    flexDirection: 'row',
    gap: 10,
  },
  simBox: {
    flex: 1,
    backgroundColor: Colors.bg,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 4,
  },
  simBoxLabel: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  simBoxVal: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  langRow: {
    flexDirection: 'row',
    gap: 10,
  },
  langOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  langOptionActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primarySoft,
  },
  langOptionText: {
    color: Colors.textSecondary,
    fontSize: 14,
    fontWeight: '700',
  },
  backupNote: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  backupRow: {
    flexDirection: 'row',
    gap: 10,
  },
  backupBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    paddingVertical: 11,
    borderRadius: 12,
  },
  backupBtnText: {
    color: Colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  dangerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.dangerSoft,
    borderWidth: 1,
    borderColor: Colors.danger,
    paddingVertical: 11,
    borderRadius: 12,
  },
  dangerBtnText: {
    color: Colors.danger,
    fontSize: 12,
    fontWeight: '700',
  },
});
