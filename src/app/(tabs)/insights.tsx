import React, { useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TrendBarChart } from '@/components/TrendBarChart';
import {
  CUSTOM_CATEGORY_COLORS,
  CUSTOM_CATEGORY_ICONS,
} from '@/constants/categories';
import { CURRENCIES, formatEditableAmount } from '@/constants/currencies';
import { useFinances } from '@/db/FinanceContext';
import { parseBackupJson } from '@/services/backupRestore';
import {
  analyzeProductPrices,
  getTopTrackedProducts,
} from '@/services/priceHistory';
import {
  exportExpensesCsv,
  exportFullBackupJson,
  pickJsonBackupText,
} from '@/services/receiptStorage';
import {
  computeDiscretionaryTotal,
  computeMonthlyTrend,
  generateSavingsTips,
  getMonthExpenses,
} from '@/services/savingsEngine';
import { Colors } from '@/theme/colors';
import type {
  CategoryId,
  CustomCategory,
  IoniconName,
  MerchantRule,
  SavingsGoal,
} from '@/types/finance';
import {
  formatDisplayDate,
  formatMonthLabel,
  parseFlexibleAmount,
} from '@/utils/format';

const TRIM_OPTIONS = [10, 15, 20, 30, 50] as const;
const GOAL_COLORS = ['#10B981', '#38BDF8', '#A78BFA', '#F59E0B', '#EC4899', '#EF4444'] as const;

export default function InsightsScreen() {
  const {
    language,
    t,
    setLanguage,
    currency,
    currencyMeta,
    setCurrency,
    formatMoney,
    monthlyIncome,
    setMonthlyIncome,
    biometricLockEnabled,
    setBiometricLockEnabled,
    customCategories,
    customCategoryMetas,
    allCategories,
    resolveCategoryMeta,
    resolveCategoryLabel,
    expenses,
    budgets,
    recurring,
    merchantRules,
    quickPresets,
    savingsGoals,
    selectedMonth,
    addSavingsGoal,
    contributeToGoal,
    removeSavingsGoal,
    addCustomCategory,
    removeCustomCategory,
    saveMerchantRule,
    removeMerchantRule,
    importBackup,
    resetAllData,
  } = useFinances();

  const [trimPercent, setTrimPercent] = useState<number>(20);

  // Income modal
  const [showIncomeModal, setShowIncomeModal] = useState(false);
  const [incomeInput, setIncomeInput] = useState('');

  // Savings goal modals
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [goalTitle, setGoalTitle] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalSaved, setGoalSaved] = useState('');
  const [goalColor, setGoalColor] = useState<string>(GOAL_COLORS[0]);

  const [contribGoal, setContribGoal] = useState<SavingsGoal | null>(null);
  const [contribInput, setContribInput] = useState('');

  // Product price tracker search
  const [priceQuery, setPriceQuery] = useState('');

  // Custom Category modal
  const [showCustomCatModal, setShowCustomCatModal] = useState(false);
  const [catNameInput, setCatNameInput] = useState('');
  const [catIconInput, setCatIconInput] = useState<IoniconName>(CUSTOM_CATEGORY_ICONS[0]);
  const [catColorInput, setCatColorInput] = useState<string>(CUSTOM_CATEGORY_COLORS[0]);
  const [catDiscretionary, setCatDiscretionary] = useState(true);

  // Merchant Rule modal
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [ruleEditingExisting, setRuleEditingExisting] = useState(false);
  const [ruleMerchantInput, setRuleMerchantInput] = useState('');
  const [ruleCategoryInput, setRuleCategoryInput] = useState<CategoryId>('groceries');
  const [showAllRules, setShowAllRules] = useState(false);

  const monthExpenses = useMemo(
    () => getMonthExpenses(expenses, selectedMonth),
    [expenses, selectedMonth]
  );

  const monthSpent = useMemo(
    () => monthExpenses.reduce((s, e) => s + e.amount, 0),
    [monthExpenses]
  );

  const netSaved = monthlyIncome > 0 ? monthlyIncome - monthSpent : 0;
  const savingsRate =
    monthlyIncome > 0 ? Math.round((netSaved / monthlyIncome) * 100) : 0;

  const tips = useMemo(
    () =>
      generateSavingsTips(
        expenses,
        budgets,
        recurring,
        selectedMonth,
        language,
        currency,
        customCategoryMetas
      ),
    [expenses, budgets, recurring, selectedMonth, language, currency, customCategoryMetas]
  );

  const trend = useMemo(
    () => computeMonthlyTrend(expenses, selectedMonth, 6),
    [expenses, selectedMonth]
  );

  const discretionaryTotal = useMemo(
    () => computeDiscretionaryTotal(monthExpenses, customCategoryMetas),
    [monthExpenses, customCategoryMetas]
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

  // Product Price Tracker memos
  const topProducts = useMemo(() => getTopTrackedProducts(expenses, 8), [expenses]);
  const priceSummary = useMemo(
    () => analyzeProductPrices(expenses, priceQuery),
    [expenses, priceQuery]
  );

  // --- Handlers ---

  const openIncomeModal = () => {
    setIncomeInput(
      monthlyIncome > 0 ? formatEditableAmount(monthlyIncome, currency) : ''
    );
    setShowIncomeModal(true);
  };

  const handleSaveIncome = async () => {
    const trimmed = incomeInput.trim();
    if (!trimmed || trimmed === '0') {
      await setMonthlyIncome(0);
      setShowIncomeModal(false);
      return;
    }
    const val = parseFlexibleAmount(trimmed);
    if (val === null || val < 0) {
      Alert.alert(t.alertAmountTitle, t.alertAmountBody);
      return;
    }
    await setMonthlyIncome(val);
    setShowIncomeModal(false);
  };

  const handleCreateGoal = async () => {
    const target = parseFlexibleAmount(goalTarget);
    if (!goalTitle.trim() || target === null || target <= 0) {
      Alert.alert(t.alertAmountTitle, t.alertAmountBody);
      return;
    }
    const saved = goalSaved.trim() ? parseFlexibleAmount(goalSaved) ?? 0 : 0;
    await addSavingsGoal({
      title: goalTitle.trim(),
      targetAmount: target,
      savedAmount: saved,
      color: goalColor,
    });
    setGoalTitle('');
    setGoalTarget('');
    setGoalSaved('');
    setGoalColor(GOAL_COLORS[0]);
    setShowGoalModal(false);
  };

  const handleContribute = async () => {
    if (!contribGoal) return;
    const delta = parseFlexibleAmount(contribInput, true);
    if (delta === null || delta === 0) return;
    await contributeToGoal(contribGoal.id, delta);
    setContribGoal(null);
    setContribInput('');
  };

  const handleDeleteGoal = (goal: SavingsGoal) => {
    Alert.alert(t.goalDeleteTitle, t.goalDeleteBody(goal.title), [
      { text: t.cancel, style: 'cancel' },
      { text: t.delete, style: 'destructive', onPress: () => removeSavingsGoal(goal.id) },
    ]);
  };

  const handleExportBackup = async () => {
    try {
      await exportFullBackupJson({
        currency,
        monthlyIncome,
        customCategories,
        merchantRules,
        expenses,
        budgets,
        recurring,
        quickPresets,
        savingsGoals,
      });
    } catch {
      Alert.alert('JSON', 'Could not export JSON backup.');
    }
  };

  // --- Custom Categories, Merchant Rules & Biometric Lock Handlers ---

  const handleCreateCustomCategory = async () => {
    const clean = catNameInput.trim();
    if (!clean) {
      Alert.alert(t.customCatModalTitle, t.customCatNameRequired);
      return;
    }
    await addCustomCategory({
      label: clean,
      icon: catIconInput,
      color: catColorInput,
      isDiscretionary: catDiscretionary,
    });
    setCatNameInput('');
    setCatIconInput(CUSTOM_CATEGORY_ICONS[0]);
    setCatColorInput(CUSTOM_CATEGORY_COLORS[0]);
    setCatDiscretionary(true);
    setShowCustomCatModal(false);
  };

  const handleDeleteCustomCategory = (cat: CustomCategory) => {
    Alert.alert(t.deleteCustomCatTitle, t.deleteCustomCatBody(cat.label), [
      { text: t.cancel, style: 'cancel' },
      {
        text: t.delete,
        style: 'destructive',
        onPress: () => removeCustomCategory(cat.id),
      },
    ]);
  };

  const openNewRuleModal = () => {
    setRuleEditingExisting(false);
    setRuleMerchantInput('');
    setRuleCategoryInput('groceries');
    setShowRuleModal(true);
  };

  const openEditRuleModal = (rule: MerchantRule) => {
    setRuleEditingExisting(true);
    setRuleMerchantInput(rule.merchantKey);
    setRuleCategoryInput(rule.category);
    setShowRuleModal(true);
  };

  const handleSaveRule = async () => {
    const clean = ruleMerchantInput.trim();
    if (clean.length < 2) {
      Alert.alert(t.ruleModalTitle, t.ruleMerchantRequired);
      return;
    }
    await saveMerchantRule(clean, ruleCategoryInput);
    setShowRuleModal(false);
  };

  const handleDeleteRule = (rule: MerchantRule) => {
    Alert.alert(t.deleteRuleTitle, t.deleteRuleBody(rule.merchantKey), [
      { text: t.cancel, style: 'cancel' },
      {
        text: t.delete,
        style: 'destructive',
        onPress: () => removeMerchantRule(rule.merchantKey),
      },
    ]);
  };

  const handleToggleBiometricLock = async (nextVal: boolean) => {
    if (!nextVal) {
      await setBiometricLockEnabled(false);
      return;
    }
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !enrolled) {
        Alert.alert(t.biometricUnavailableTitle, t.biometricUnavailableBody);
        return;
      }
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: t.biometricEnablePrompt,
        cancelLabel: t.cancel,
        disableDeviceFallback: false,
      });
      if (res.success) {
        await setBiometricLockEnabled(true);
      }
    } catch {
      Alert.alert(t.biometricUnavailableTitle, t.biometricUnavailableBody);
    }
  };

  const handleImportBackup = async () => {
    try {
      const raw = await pickJsonBackupText();
      if (!raw) return;
      const validated = parseBackupJson(raw);

      Alert.alert(
        t.restoreConfirmTitle,
        t.restoreConfirmBody(
          validated.expenses.length,
          validated.budgets.length,
          validated.recurring.length,
          validated.savingsGoals.length
        ),
        [
          { text: t.cancel, style: 'cancel' },
          {
            text: t.restoreMergeBtn,
            onPress: async () => {
              const res = await importBackup(validated, 'merge');
              Alert.alert(
                t.restoreDoneTitle,
                t.restoreDoneBody(res.importedExpenses, res.skippedDuplicates)
              );
            },
          },
          {
            text: t.restoreReplaceBtn,
            style: 'destructive',
            onPress: async () => {
              const res = await importBackup(validated, 'replace');
              Alert.alert(
                t.restoreDoneTitle,
                t.restoreDoneBody(res.importedExpenses, res.skippedDuplicates)
              );
            },
          },
        ]
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid backup file.';
      Alert.alert(t.restoreFailTitle, msg);
    }
  };

  const handleExportCsv = async () => {
    if (expenses.length === 0) {
      Alert.alert(t.nothingToExport, t.addExpensesFirst);
      return;
    }
    try {
      await exportExpensesCsv(expenses, currency);
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
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.pageTitle}>{t.savingsTitle}</Text>
          <Text style={styles.pageSub}>
            {t.savingsSub(formatMonthLabel(selectedMonth, language))}
          </Text>
        </View>

        {/* Monthly Income & Net Savings */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>{t.incomeSectionTitle}</Text>
          {monthlyIncome > 0 && (
            <Pressable onPress={openIncomeModal}>
              <Text style={styles.sectionLink}>{t.editIncomeBtn}</Text>
            </Pressable>
          )}
        </View>
        <View style={styles.card}>
          {monthlyIncome <= 0 ? (
            <View style={{ gap: 10 }}>
              <Text style={styles.backupNote}>{t.incomeNotSet}</Text>
              <Pressable onPress={openIncomeModal} style={styles.primaryOutlineBtn}>
                <Ionicons name="cash-outline" size={16} color={Colors.primary} />
                <Text style={styles.primaryOutlineText}>{t.setIncomeBtn}</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.kpiStrip}>
              <View style={styles.simBox}>
                <Text style={styles.simBoxLabel}>{t.incomeLabel}</Text>
                <Text style={styles.kpiNum}>{formatMoney(monthlyIncome, false)}</Text>
              </View>
              <View style={styles.simBox}>
                <Text style={styles.simBoxLabel}>{t.netSavedLabel}</Text>
                <Text
                  style={[
                    styles.kpiNum,
                    { color: netSaved >= 0 ? Colors.primary : Colors.danger },
                  ]}
                >
                  {netSaved >= 0 ? '+' : ''}
                  {formatMoney(netSaved, false)}
                </Text>
              </View>
              <View style={styles.simBox}>
                <Text style={styles.simBoxLabel}>{t.savingsRateLabel}</Text>
                <Text
                  style={[
                    styles.kpiNum,
                    { color: savingsRate >= 20 ? Colors.primary : Colors.warning },
                  ]}
                >
                  {savingsRate}%
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* Savings Goals */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>{t.goalsSectionTitle}</Text>
          <Pressable onPress={() => setShowGoalModal(true)} style={styles.smallAddBtn}>
            <Ionicons name="add" size={14} color={Colors.primary} />
            <Text style={styles.smallAddText}>{t.addGoalBtn}</Text>
          </Pressable>
        </View>
        <View style={styles.card}>
          {savingsGoals.length === 0 ? (
            <Text style={styles.backupNote}>{t.goalsEmpty}</Text>
          ) : (
            savingsGoals.map((goal, idx) => {
              const pct = Math.min(
                100,
                Math.round((goal.savedAmount / Math.max(1, goal.targetAmount)) * 100)
              );
              const remaining = Math.max(0, goal.targetAmount - goal.savedAmount);
              const estMonths =
                remaining > 0 && netSaved > 0
                  ? Math.ceil(remaining / netSaved)
                  : null;

              return (
                <View
                  key={goal.id}
                  style={[
                    styles.goalRow,
                    idx < savingsGoals.length - 1 && styles.goalDivider,
                  ]}
                >
                  <View style={styles.goalTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.goalTitle}>{goal.title}</Text>
                      <Text style={styles.goalSub}>
                        {formatMoney(goal.savedAmount, false)} /{' '}
                        {formatMoney(goal.targetAmount, false)} ({pct}%)
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => {
                        setContribGoal(goal);
                        setContribInput('');
                      }}
                      style={styles.contribBtn}
                    >
                      <Text style={styles.contribBtnText}>{t.goalAddMoneyBtn}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => handleDeleteGoal(goal)}
                      style={styles.trashMini}
                      hitSlop={6}
                    >
                      <Ionicons name="trash-outline" size={15} color={Colors.danger} />
                    </Pressable>
                  </View>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.barFill,
                        { width: `${Math.max(3, pct)}%`, backgroundColor: goal.color },
                      ]}
                    />
                  </View>
                  {remaining === 0 ? (
                    <Text style={[styles.goalHint, { color: Colors.primary }]}>
                      {t.goalReached}
                    </Text>
                  ) : estMonths !== null ? (
                    <Text style={styles.goalHint}>{t.goalEstMonths(estMonths)}</Text>
                  ) : null}
                </View>
              );
            })
          )}
        </View>

        {/* Product Price Comparison & History */}
        <Text style={styles.sectionTitle}>{t.priceTrackerTitle}</Text>
        <View style={styles.card}>
          <Text style={styles.backupNote}>{t.priceTrackerSub}</Text>
          <View style={styles.searchWrap}>
            <Ionicons name="search-outline" size={16} color={Colors.textMuted} />
            <TextInput
              value={priceQuery}
              onChangeText={setPriceQuery}
              placeholder={t.priceSearchPlaceholder}
              placeholderTextColor={Colors.textMuted}
              style={styles.searchInput}
            />
            {priceQuery.length > 0 && (
              <Pressable onPress={() => setPriceQuery('')}>
                <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
              </Pressable>
            )}
          </View>

          {topProducts.length === 0 ? (
            <Text style={styles.backupNote}>{t.priceTrackerEmpty}</Text>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.productChips}
            >
              {topProducts.map((p) => {
                const active = priceQuery.trim().toLowerCase() === p.key;
                return (
                  <Pressable
                    key={p.key}
                    onPress={() => setPriceQuery(p.key)}
                    style={[styles.productChip, active && styles.productChipActive]}
                  >
                    <Text
                      style={[
                        styles.productChipName,
                        active && { color: Colors.primary },
                      ]}
                      numberOfLines={1}
                    >
                      {p.displayName}
                    </Text>
                    <Text style={styles.productChipMeta}>
                      {t.priceHistoryCount(p.count)} • {formatMoney(p.cheapestPrice)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          {priceQuery.trim().length >= 2 &&
            (priceSummary ? (
              <View style={styles.priceDetailBox}>
                {priceSummary.cheapestStore && (
                  <View style={styles.cheapestPill}>
                    <Ionicons name="trophy-outline" size={14} color={Colors.primary} />
                    <Text style={styles.cheapestText}>
                      {t.cheapestAt(
                        priceSummary.cheapestStore.store,
                        formatMoney(priceSummary.cheapestStore.minUnitPrice)
                      )}
                    </Text>
                  </View>
                )}

                <View style={styles.kpiStrip}>
                  <View style={styles.simBox}>
                    <Text style={styles.simBoxLabel}>{t.priceAvgLabel}</Text>
                    <Text style={styles.kpiNum}>
                      {formatMoney(priceSummary.avgUnitPrice)}
                    </Text>
                  </View>
                  <View style={styles.simBox}>
                    <Text style={styles.simBoxLabel}>{t.priceRangeLabel}</Text>
                    <Text style={styles.kpiNumSmall}>
                      {formatMoney(priceSummary.minUnitPrice)} –{' '}
                      {formatMoney(priceSummary.maxUnitPrice)}
                    </Text>
                  </View>
                  {priceSummary.priceChangePct !== null && (
                    <View style={styles.simBox}>
                      <Text style={styles.simBoxLabel}>{t.priceTrendLabel}</Text>
                      <Text
                        style={[
                          styles.kpiNum,
                          {
                            color:
                              priceSummary.priceChangePct > 0
                                ? Colors.danger
                                : Colors.primary,
                          },
                        ]}
                      >
                        {priceSummary.priceChangePct > 0 ? '+' : ''}
                        {priceSummary.priceChangePct}%
                      </Text>
                    </View>
                  )}
                </View>

                <View style={styles.historyList}>
                  {priceSummary.history.slice(0, 6).map((h, idx) => (
                    <View
                      key={`${h.expenseId}_${idx}`}
                      style={[
                        styles.historyRow,
                        idx < Math.min(priceSummary.history.length, 6) - 1 &&
                          styles.historyBorder,
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.historyStore} numberOfLines={1}>
                          {h.store} • {h.itemName}
                        </Text>
                        <Text style={styles.historyDate}>
                          {formatDisplayDate(h.date, language)}
                          {h.quantity !== 1 ? ` • ×${h.quantity}` : ''}
                        </Text>
                      </View>
                      <Text style={styles.historyPrice}>
                        {formatMoney(h.unitPrice)}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : (
              <Text style={styles.backupNote}>{t.priceNoMatch}</Text>
            ))}
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
                  formatMoney(Math.min(maxTipSavings, discretionaryTotal || maxTipSavings))
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
              {tip.potentialMonthlySavings &&
              tip.potentialMonthlySavings >= 5 * currencyMeta.eurRateApprox ? (
                <View style={styles.savingsPill}>
                  <Text style={[styles.savingsPillText, { color: accent }]}>
                    {t.potentialImpact(
                      formatMoney(tip.potentialMonthlySavings),
                      formatMoney(tip.potentialMonthlySavings * 12, false)
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
            <Text style={styles.bold}>{formatMoney(discretionaryTotal)}</Text>
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
              <Text style={styles.simBoxVal}>{formatMoney(simulatedMonthly)}</Text>
            </View>
            <View style={styles.simBox}>
              <Text style={styles.simBoxLabel}>{t.youSaveYearly}</Text>
              <Text style={[styles.simBoxVal, { color: Colors.primary }]}>
                {formatMoney(simulatedYearly, false)}
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
            currency={currency}
            emptyLabel={t.trendEmpty}
          />
        </View>

        {/* Tax & VAT Tracker */}
        <Text style={styles.sectionTitle}>{t.taxesSummaryTitle}</Text>
        <View style={styles.card}>
          <View style={styles.simResultRow}>
            <View style={styles.simBox}>
              <Text style={styles.simBoxLabel}>{t.thisMonthTaxes}</Text>
              <Text style={styles.simBoxVal}>{formatMoney(monthTaxes)}</Text>
            </View>
            <View style={styles.simBox}>
              <Text style={styles.simBoxLabel}>{t.ytdTaxes(selectedYear)}</Text>
              <Text style={styles.simBoxVal}>{formatMoney(ytdTaxes)}</Text>
            </View>
          </View>
        </View>

        {/* Custom Categories */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>{t.customCatsTitle}</Text>
          <Pressable
            onPress={() => setShowCustomCatModal(true)}
            style={styles.smallAddBtn}
          >
            <Ionicons name="add" size={14} color={Colors.primary} />
            <Text style={styles.smallAddText}>{t.addCustomCatBtn}</Text>
          </Pressable>
        </View>
        <View style={styles.card}>
          {customCategories.length === 0 ? (
            <Text style={styles.backupNote}>{t.customCatsEmpty}</Text>
          ) : (
            customCategories.map((cat, idx) => (
              <View
                key={cat.id}
                style={[
                  styles.manageRow,
                  idx < customCategories.length - 1 && styles.historyBorder,
                ]}
              >
                <View style={[styles.catBadge, { backgroundColor: `${cat.color}22` }]}>
                  <Ionicons name={cat.icon} size={17} color={cat.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.manageTitle}>{cat.label}</Text>
                  <Text style={styles.manageSub}>
                    {cat.isDiscretionary ? t.catDiscretionaryTag : t.catEssentialTag}
                  </Text>
                </View>
                <Pressable
                  onPress={() => handleDeleteCustomCategory(cat)}
                  style={styles.trashMini}
                  hitSlop={6}
                >
                  <Ionicons name="trash-outline" size={15} color={Colors.danger} />
                </Pressable>
              </View>
            ))
          )}
        </View>

        {/* Learned Merchant Rules Editor */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>
            {t.merchantRulesTitle}
            {merchantRules.length > 0 ? ` (${merchantRules.length})` : ''}
          </Text>
          <Pressable onPress={openNewRuleModal} style={styles.smallAddBtn}>
            <Ionicons name="add" size={14} color={Colors.primary} />
            <Text style={styles.smallAddText}>{t.addRuleBtn}</Text>
          </Pressable>
        </View>
        <View style={styles.card}>
          <Text style={styles.backupNote}>{t.merchantRulesSub}</Text>
          {merchantRules.length === 0 ? (
            <Text style={styles.backupNote}>{t.merchantRulesEmpty}</Text>
          ) : (
            <>
              {(showAllRules ? merchantRules : merchantRules.slice(0, 6)).map(
                (rule, idx, arr) => {
                  const meta = resolveCategoryMeta(rule.category);
                  return (
                    <View
                      key={rule.merchantKey}
                      style={[
                        styles.manageRow,
                        idx < arr.length - 1 && styles.historyBorder,
                      ]}
                    >
                      <Text style={styles.ruleKeyText} numberOfLines={1}>
                        {rule.merchantKey}
                      </Text>
                      <Pressable
                        onPress={() => openEditRuleModal(rule)}
                        style={[
                          styles.ruleCatPill,
                          {
                            borderColor: meta.color,
                            backgroundColor: `${meta.color}20`,
                          },
                        ]}
                      >
                        <Ionicons name={meta.icon} size={13} color={meta.color} />
                        <Text style={styles.ruleCatText} numberOfLines={1}>
                          {resolveCategoryLabel(rule.category)}
                        </Text>
                        <Ionicons
                          name="create-outline"
                          size={12}
                          color={Colors.textSecondary}
                        />
                      </Pressable>
                      <Pressable
                        onPress={() => handleDeleteRule(rule)}
                        style={styles.trashMini}
                        hitSlop={6}
                      >
                        <Ionicons name="trash-outline" size={15} color={Colors.danger} />
                      </Pressable>
                    </View>
                  );
                }
              )}
              {merchantRules.length > 6 && (
                <Pressable
                  onPress={() => setShowAllRules((v) => !v)}
                  style={styles.showMoreBtn}
                >
                  <Text style={styles.showMoreText}>
                    {showAllRules
                      ? t.showLessRules
                      : t.showAllRules(merchantRules.length)}
                  </Text>
                </Pressable>
              )}
            </>
          )}
        </View>

        {/* Security / Fingerprint & Face Lock */}
        <Text style={styles.sectionTitle}>{t.securitySectionTitle}</Text>
        <View style={styles.card}>
          <View style={styles.securityRow}>
            <View style={styles.securityIconWrap}>
              <Ionicons name="finger-print-outline" size={20} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.manageTitle}>{t.biometricLockTitle}</Text>
              <Text style={styles.manageSub}>{t.biometricLockDesc}</Text>
            </View>
            <Switch
              value={biometricLockEnabled}
              onValueChange={handleToggleBiometricLock}
              trackColor={{ false: Colors.border, true: Colors.primaryDark }}
              thumbColor={biometricLockEnabled ? Colors.primary : Colors.textMuted}
            />
          </View>
        </View>

        {/* Currency Setting */}
        <Text style={styles.sectionTitle}>{t.currencySectionTitle}</Text>
        <View style={styles.card}>
          <Text style={styles.backupNote}>{t.currencyNote}</Text>
          <View style={styles.currencyGrid}>
            {CURRENCIES.map((cur) => {
              const active = currency === cur.code;
              return (
                <Pressable
                  key={cur.code}
                  onPress={() => setCurrency(cur.code)}
                  style={[styles.currencyOption, active && styles.langOptionActive]}
                >
                  <Text
                    style={[
                      styles.currencySymbol,
                      active && { color: Colors.primary },
                    ]}
                  >
                    {cur.symbol}
                  </Text>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        styles.currencyCode,
                        active && { color: Colors.text },
                      ]}
                    >
                      {cur.code}
                    </Text>
                    <Text style={styles.currencyName} numberOfLines={1}>
                      {cur.name}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Language Setting */}
        <Text style={styles.sectionTitle}>{t.languageSectionTitle}</Text>
        <View style={styles.card}>
          <View style={styles.langRow}>
            <Pressable
              onPress={() => setLanguage('en')}
              style={[styles.langOption, language === 'en' && styles.langOptionActive]}
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
              style={[styles.langOption, language === 'lt' && styles.langOptionActive]}
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

        {/* Local Data & Backups (Export CSV, Backup JSON, Restore JSON, Reset) */}
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

          <Pressable onPress={handleImportBackup} style={styles.restoreBtn}>
            <Ionicons name="cloud-upload-outline" size={16} color={Colors.purple} />
            <Text style={[styles.backupBtnText, { color: Colors.purple }]}>
              {t.importJson}
            </Text>
          </Pressable>

          <Pressable onPress={handleReset} style={styles.dangerBtn}>
            <Ionicons name="trash-outline" size={15} color={Colors.danger} />
            <Text style={styles.dangerBtnText}>{t.resetAll}</Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* Monthly Income Modal */}
      <Modal
        visible={showIncomeModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowIncomeModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t.incomeModalTitle}</Text>
            <Text style={styles.modalSub}>{t.incomeModalSub(currency)}</Text>
            <View style={styles.euroRow}>
              <Text style={styles.euroMark}>{currencyMeta.symbol}</Text>
              <TextInput
                value={incomeInput}
                onChangeText={setIncomeInput}
                keyboardType="decimal-pad"
                placeholder={currencyMeta.decimals === 0 ? '3500000' : '2200'}
                placeholderTextColor={Colors.textMuted}
                autoFocus
                style={styles.modalInput}
              />
            </View>
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setShowIncomeModal(false)}
                style={styles.cancelBtn}
              >
                <Text style={styles.cancelText}>{t.cancel}</Text>
              </Pressable>
              <Pressable onPress={handleSaveIncome} style={styles.confirmBtn}>
                <Text style={styles.confirmText}>{t.saveIncomeBtn}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Create Savings Goal Modal */}
      <Modal
        visible={showGoalModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowGoalModal(false)}
      >
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.modalTitle}>{t.goalModalTitle}</Text>
              <Pressable onPress={() => setShowGoalModal(false)}>
                <Ionicons name="close" size={22} color={Colors.text} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.sheetBody}>
              <Text style={styles.fieldLabel}>{t.titleLabel} *</Text>
              <TextInput
                value={goalTitle}
                onChangeText={setGoalTitle}
                placeholder={t.goalTitlePlaceholder}
                placeholderTextColor={Colors.textMuted}
                style={styles.fieldInput}
              />

              <View style={styles.backupRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>
                    {t.goalTargetLabel(currencyMeta.symbol)}
                  </Text>
                  <TextInput
                    value={goalTarget}
                    onChangeText={setGoalTarget}
                    keyboardType="decimal-pad"
                    placeholder={currencyMeta.decimals === 0 ? '2000000' : '1500'}
                    placeholderTextColor={Colors.textMuted}
                    style={styles.fieldInput}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>
                    {t.goalSavedLabel(currencyMeta.symbol)}
                  </Text>
                  <TextInput
                    value={goalSaved}
                    onChangeText={setGoalSaved}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={Colors.textMuted}
                    style={styles.fieldInput}
                  />
                </View>
              </View>

              <Text style={styles.fieldLabel}>{t.goalColorLabel}</Text>
              <View style={styles.colorRow}>
                {GOAL_COLORS.map((col) => (
                  <Pressable
                    key={col}
                    onPress={() => setGoalColor(col)}
                    style={[
                      styles.colorDot,
                      { backgroundColor: col },
                      goalColor === col && styles.colorDotActive,
                    ]}
                  />
                ))}
              </View>

              <Pressable onPress={handleCreateGoal} style={styles.createBtn}>
                <Text style={styles.createBtnText}>{t.goalSaveBtn}</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Contribute to Savings Goal Modal */}
      <Modal
        visible={contribGoal !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setContribGoal(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {contribGoal ? t.goalContribTitle(contribGoal.title) : ''}
            </Text>
            <Text style={styles.modalSub}>{t.goalContribSub}</Text>
            <View style={styles.euroRow}>
              <Text style={styles.euroMark}>{currencyMeta.symbol}</Text>
              <TextInput
                value={contribInput}
                onChangeText={setContribInput}
                keyboardType="numbers-and-punctuation"
                placeholder={currencyMeta.decimals === 0 ? '100000' : '100'}
                placeholderTextColor={Colors.textMuted}
                autoFocus
                style={styles.modalInput}
              />
            </View>
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setContribGoal(null)}
                style={styles.cancelBtn}
              >
                <Text style={styles.cancelText}>{t.cancel}</Text>
              </Pressable>
              <Pressable onPress={handleContribute} style={styles.confirmBtn}>
                <Text style={styles.confirmText}>{t.goalContribBtn}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Create Custom Category Modal */}
      <Modal
        visible={showCustomCatModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCustomCatModal(false)}
      >
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.modalTitle}>{t.customCatModalTitle}</Text>
              <Pressable onPress={() => setShowCustomCatModal(false)}>
                <Ionicons name="close" size={22} color={Colors.text} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.sheetBody}>
              <Text style={styles.fieldLabel}>{t.customCatNameLabel} *</Text>
              <TextInput
                value={catNameInput}
                onChangeText={setCatNameInput}
                placeholder={t.customCatNamePlaceholder}
                placeholderTextColor={Colors.textMuted}
                style={styles.fieldInput}
              />

              <Text style={styles.fieldLabel}>{t.customCatIconLabel}</Text>
              <View style={styles.iconGrid}>
                {CUSTOM_CATEGORY_ICONS.map((iconName) => {
                  const selected = catIconInput === iconName;
                  return (
                    <Pressable
                      key={iconName}
                      onPress={() => setCatIconInput(iconName)}
                      style={[
                        styles.iconChoice,
                        selected && {
                          borderColor: catColorInput,
                          backgroundColor: `${catColorInput}25`,
                        },
                      ]}
                    >
                      <Ionicons
                        name={iconName}
                        size={20}
                        color={selected ? catColorInput : Colors.textSecondary}
                      />
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.fieldLabel}>{t.goalColorLabel}</Text>
              <View style={[styles.colorRow, { flexWrap: 'wrap' }]}>
                {CUSTOM_CATEGORY_COLORS.map((col) => (
                  <Pressable
                    key={col}
                    onPress={() => setCatColorInput(col)}
                    style={[
                      styles.colorDot,
                      { backgroundColor: col },
                      catColorInput === col && styles.colorDotActive,
                    ]}
                  />
                ))}
              </View>

              <View style={styles.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.manageTitle}>{t.customCatDiscretionaryLabel}</Text>
                  <Text style={styles.manageSub}>{t.customCatDiscretionaryDesc}</Text>
                </View>
                <Switch
                  value={catDiscretionary}
                  onValueChange={setCatDiscretionary}
                  trackColor={{ false: Colors.border, true: Colors.primaryDark }}
                  thumbColor={catDiscretionary ? Colors.primary : Colors.textMuted}
                />
              </View>

              <Pressable onPress={handleCreateCustomCategory} style={styles.createBtn}>
                <Text style={styles.createBtnText}>{t.customCatSaveBtn}</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Add / Edit Merchant Rule Modal */}
      <Modal
        visible={showRuleModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowRuleModal(false)}
      >
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.modalTitle}>
                {ruleEditingExisting ? t.ruleEditTitle : t.ruleModalTitle}
              </Text>
              <Pressable onPress={() => setShowRuleModal(false)}>
                <Ionicons name="close" size={22} color={Colors.text} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.sheetBody}>
              <Text style={styles.fieldLabel}>{t.ruleMerchantLabel} *</Text>
              <TextInput
                value={ruleMerchantInput}
                onChangeText={setRuleMerchantInput}
                editable={!ruleEditingExisting}
                placeholder={t.ruleMerchantPlaceholder}
                placeholderTextColor={Colors.textMuted}
                style={[
                  styles.fieldInput,
                  ruleEditingExisting && { opacity: 0.65 },
                ]}
              />

              <Text style={styles.fieldLabel}>{t.categoryLabel}</Text>
              <View style={styles.catGrid}>
                {allCategories.map((c) => {
                  const selected = ruleCategoryInput === c.id;
                  return (
                    <Pressable
                      key={c.id}
                      onPress={() => setRuleCategoryInput(c.id)}
                      style={[
                        styles.catChip,
                        selected && {
                          borderColor: c.color,
                          backgroundColor: `${c.color}25`,
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

              <Pressable onPress={handleSaveRule} style={styles.createBtn}>
                <Text style={styles.createBtnText}>{t.ruleSaveBtn}</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
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
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  sectionTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 6,
  },
  sectionLink: {
    color: Colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  smallAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: Colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 9,
  },
  smallAddText: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '700',
  },
  primaryOutlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: Colors.primary,
    paddingVertical: 11,
    borderRadius: 12,
  },
  primaryOutlineText: {
    color: Colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  kpiStrip: {
    flexDirection: 'row',
    gap: 8,
  },
  kpiNum: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  kpiNumSmall: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  goalRow: {
    gap: 8,
    paddingVertical: 4,
  },
  goalDivider: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingBottom: 12,
  },
  goalTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  goalTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  goalSub: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  contribBtn: {
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: Colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  contribBtnText: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '700',
  },
  trashMini: {
    padding: 6,
    backgroundColor: Colors.dangerSoft,
    borderRadius: 8,
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
  goalHint: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 11,
    backgroundColor: Colors.bg,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchInput: {
    flex: 1,
    color: Colors.text,
    paddingVertical: 9,
    fontSize: 13,
  },
  productChips: {
    gap: 8,
    paddingVertical: 2,
  },
  productChip: {
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    maxWidth: 170,
  },
  productChipActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primarySoft,
  },
  productChipName: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  productChipMeta: {
    color: Colors.textMuted,
    fontSize: 10,
    marginTop: 2,
  },
  priceDetailBox: {
    gap: 10,
  },
  cheapestPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  cheapestText: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },
  historyList: {
    backgroundColor: Colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  historyBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  historyStore: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  historyDate: {
    color: Colors.textMuted,
    fontSize: 11,
    marginTop: 1,
  },
  historyPrice: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700',
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
    padding: 11,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 4,
  },
  simBoxLabel: {
    color: Colors.textMuted,
    fontSize: 10,
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
  currencyGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  currencyOption: {
    width: '48.5%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  currencySymbol: {
    color: Colors.textSecondary,
    fontSize: 18,
    fontWeight: '800',
    minWidth: 22,
    textAlign: 'center',
  },
  currencyCode: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '800',
  },
  currencyName: {
    color: Colors.textMuted,
    fontSize: 10,
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
  restoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.purpleSoft,
    borderWidth: 1,
    borderColor: Colors.purple,
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12,
  },
  modalTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  modalSub: {
    color: Colors.textSecondary,
    fontSize: 13,
  },
  euroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
  },
  euroMark: {
    color: Colors.primary,
    fontSize: 22,
    fontWeight: '800',
    marginRight: 8,
  },
  modalInput: {
    flex: 1,
    color: Colors.text,
    fontSize: 22,
    fontWeight: '700',
    paddingVertical: 12,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cancelText: {
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  confirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
  },
  confirmText: {
    color: Colors.white,
    fontWeight: '700',
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  sheetBody: {
    padding: 18,
    paddingBottom: 32,
    gap: 10,
  },
  fieldLabel: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  fieldInput: {
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: Colors.text,
    fontSize: 14,
  },
  colorRow: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 6,
  },
  colorDot: {
    width: 30,
    height: 30,
    borderRadius: 99,
  },
  colorDotActive: {
    borderWidth: 3,
    borderColor: Colors.white,
    transform: [{ scale: 1.1 }],
  },
  createBtn: {
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  createBtnText: {
    color: Colors.white,
    fontSize: 15,
    fontWeight: '800',
  },
  manageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  catBadge: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manageTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  manageSub: {
    color: Colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  ruleKeyText: {
    flex: 1,
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  ruleCatPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 9,
    borderWidth: 1,
    maxWidth: '52%',
  },
  ruleCatText: {
    color: Colors.text,
    fontSize: 11,
    fontWeight: '700',
    flexShrink: 1,
  },
  showMoreBtn: {
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.border,
    marginTop: 4,
  },
  showMoreText: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  securityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  securityIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingVertical: 4,
  },
  iconChoice: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.bg,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    marginTop: 6,
  },
  catGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingVertical: 4,
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
});
