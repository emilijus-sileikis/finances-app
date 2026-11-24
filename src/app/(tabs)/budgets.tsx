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
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFinances } from '@/db/FinanceContext';
import { getMonthExpenses } from '@/services/savingsEngine';
import { Colors } from '@/theme/colors';
import type { CategoryId, RecurringFrequency } from '@/types/finance';
import {
  formatMonthLabel,
  getCurrentPeriodKey,
  parseFlexibleAmount,
} from '@/utils/format';

export default function BudgetsScreen() {
  const {
    language,
    t,
    currency,
    currencyMeta,
    formatMoney,
    allCategories,
    resolveCategoryMeta,
    resolveCategoryLabel,
    expenses,
    budgets,
    recurring,
    selectedMonth,
    saveBudget,
    addRecurring,
    logRecurringNow,
    setRecurringActive,
    setRecurringAutoLog,
    removeRecurring,
  } = useFinances();

  const [tab, setTab] = useState<'budgets' | 'recurring'>('budgets');

  // Edit budget modal
  const [editingBudgetCat, setEditingBudgetCat] = useState<CategoryId | null>(null);
  const [budgetInput, setBudgetInput] = useState('');

  // Add recurring modal
  const [showAddRec, setShowAddRec] = useState(false);
  const [recTitle, setRecTitle] = useState('');
  const [recMerchant, setRecMerchant] = useState('');
  const [recAmount, setRecAmount] = useState('');
  const [recCategory, setRecCategory] = useState<CategoryId>('mortgage');
  const [recFreq, setRecFreq] = useState<RecurringFrequency>('monthly');
  const [recDay, setRecDay] = useState('1');
  const [recAutoLog, setRecAutoLog] = useState(true);

  const monthExpenses = useMemo(
    () => getMonthExpenses(expenses, selectedMonth),
    [expenses, selectedMonth]
  );

  const spentByCat = useMemo(() => {
    const map = new Map<CategoryId, number>();
    for (const e of monthExpenses) {
      map.set(e.category, (map.get(e.category) ?? 0) + e.amount);
    }
    return map;
  }, [monthExpenses]);

  const budgetByCat = useMemo(() => {
    const map = new Map<CategoryId, number>();
    for (const b of budgets) {
      map.set(b.category, b.monthlyLimit);
    }
    return map;
  }, [budgets]);

  const totalBudgeted = useMemo(
    () => budgets.reduce((s, b) => s + b.monthlyLimit, 0),
    [budgets]
  );

  const totalSpentInBudgeted = useMemo(
    () => budgets.reduce((s, b) => s + (spentByCat.get(b.category) ?? 0), 0),
    [budgets, spentByCat]
  );

  const monthlyRecurringTotal = useMemo(() => {
    return recurring
      .filter((r) => r.active)
      .reduce((sum, r) => {
        if (r.frequency === 'weekly') return sum + r.amount * 4.33;
        if (r.frequency === 'yearly') return sum + r.amount / 12;
        return sum + r.amount;
      }, 0);
  }, [recurring]);

  const openBudgetEditor = (cat: CategoryId) => {
    const existing = budgetByCat.get(cat);
    setEditingBudgetCat(cat);
    setBudgetInput(existing ? String(existing) : '');
  };

  const handleSaveBudget = async () => {
    if (!editingBudgetCat) return;
    const trimmed = budgetInput.trim();
    if (!trimmed || trimmed === '0') {
      await saveBudget(editingBudgetCat, 0);
      setEditingBudgetCat(null);
      return;
    }
    const parsed = parseFlexibleAmount(trimmed);
    if (parsed === null || parsed < 0) {
      Alert.alert(t.alertAmountTitle, t.alertAmountBody);
      return;
    }
    await saveBudget(editingBudgetCat, parsed);
    setEditingBudgetCat(null);
  };

  const handleCreateRecurring = async () => {
    const amt = parseFlexibleAmount(recAmount);
    if (!recTitle.trim() || amt === null || amt <= 0) {
      Alert.alert(t.alertAmountTitle, t.alertAmountBody);
      return;
    }
    const dayNum = Math.min(28, Math.max(1, Number(recDay) || 1));
    await addRecurring({
      title: recTitle.trim(),
      merchant: recMerchant.trim() || recTitle.trim(),
      amount: amt,
      category: recCategory,
      frequency: recFreq,
      dayOfMonth: dayNum,
      autoLog: recAutoLog,
    });
    setRecTitle('');
    setRecMerchant('');
    setRecAmount('');
    setRecDay('1');
    setShowAddRec(false);
  };

  const handleDeleteRecurring = (id: number, name: string) => {
    Alert.alert(t.deleteRecTitle, t.deleteRecBody(name), [
      { text: t.cancel, style: 'cancel' },
      { text: t.delete, style: 'destructive', onPress: () => removeRecurring(id) },
    ]);
  };

  const freqLabel = (f: RecurringFrequency) => {
    if (f === 'weekly') return t.freqWeekly;
    if (f === 'yearly') return t.freqYearly;
    return t.freqMonthly;
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.pageTitle}>{t.budgetsTitle}</Text>
          <Text style={styles.pageSub}>{formatMonthLabel(selectedMonth, language)}</Text>
        </View>
        {tab === 'recurring' && (
          <Pressable onPress={() => setShowAddRec(true)} style={styles.addBtn}>
            <Ionicons name="add" size={18} color={Colors.white} />
            <Text style={styles.addBtnText}>{t.addBill}</Text>
          </Pressable>
        )}
      </View>

      {/* Segmented Switcher */}
      <View style={styles.segmentWrap}>
        <Pressable
          onPress={() => setTab('budgets')}
          style={[styles.segmentBtn, tab === 'budgets' && styles.segmentActive]}
        >
          <Ionicons
            name="pie-chart-outline"
            size={15}
            color={tab === 'budgets' ? Colors.white : Colors.textSecondary}
          />
          <Text
            style={[
              styles.segmentText,
              tab === 'budgets' && { color: Colors.white },
            ]}
          >
            {t.monthlyBudgets}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setTab('recurring')}
          style={[styles.segmentBtn, tab === 'recurring' && styles.segmentActive]}
        >
          <Ionicons
            name="repeat-outline"
            size={15}
            color={tab === 'recurring' ? Colors.white : Colors.textSecondary}
          />
          <Text
            style={[
              styles.segmentText,
              tab === 'recurring' && { color: Colors.white },
            ]}
          >
            {t.recurringTab(recurring.filter((r) => r.active).length)}
          </Text>
        </Pressable>
      </View>

      {tab === 'budgets' ? (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* Overall Budget Hero */}
          <View style={styles.heroCard}>
            <View style={styles.heroTop}>
              <Text style={styles.heroLabel}>{t.totalMonthlyLimits}</Text>
              <Text style={styles.heroBig}>{formatMoney(totalBudgeted, false)}</Text>
            </View>
            <View style={styles.heroBarTrack}>
              <View
                style={[
                  styles.heroBarFill,
                  {
                    width: `${
                      totalBudgeted > 0
                        ? Math.min(100, (totalSpentInBudgeted / totalBudgeted) * 100)
                        : 0
                    }%`,
                    backgroundColor:
                      totalBudgeted > 0 && totalSpentInBudgeted > totalBudgeted
                        ? Colors.danger
                        : Colors.primary,
                  },
                ]}
              />
            </View>
            <Text style={styles.heroSub}>
              {totalBudgeted > 0
                ? t.budgetHeroSummary(
                    formatMoney(totalSpentInBudgeted),
                    formatMoney(Math.abs(totalBudgeted - totalSpentInBudgeted)),
                    totalSpentInBudgeted > totalBudgeted
                  )
                : t.budgetHeroEmpty}
            </Text>
          </View>

          {allCategories.map((cat) => {
            const limit = budgetByCat.get(cat.id) ?? 0;
            const spent = spentByCat.get(cat.id) ?? 0;
            const ratio = limit > 0 ? spent / limit : 0;
            const statusColor =
              limit === 0
                ? Colors.textMuted
                : ratio >= 1
                  ? Colors.danger
                  : ratio >= 0.8
                    ? Colors.warning
                    : Colors.primary;

            return (
              <Pressable
                key={cat.id}
                onPress={() => openBudgetEditor(cat.id)}
                style={styles.budgetCard}
              >
                <View style={styles.budgetTop}>
                  <View style={[styles.catIcon, { backgroundColor: `${cat.color}20` }]}>
                    <Ionicons name={cat.icon} size={18} color={cat.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.budgetCatName}>
                      {resolveCategoryLabel(cat.id)}
                    </Text>
                    <Text style={styles.budgetSpentText}>
                      {limit > 0
                        ? t.spentOf(formatMoney(spent), formatMoney(limit, false))
                        : t.spentOnly(formatMoney(spent))}
                    </Text>
                  </View>
                  <View style={styles.limitBadge}>
                    <Text style={styles.limitBadgeText}>
                      {limit > 0 ? formatMoney(limit, false) : t.setLimit}
                    </Text>
                  </View>
                </View>

                {limit > 0 && (
                  <View style={styles.progressSection}>
                    <View style={styles.barTrack}>
                      <View
                        style={[
                          styles.barFill,
                          {
                            width: `${Math.min(100, Math.max(3, ratio * 100))}%`,
                            backgroundColor: statusColor,
                          },
                        ]}
                      />
                    </View>
                    <Text style={[styles.remainingNote, { color: statusColor }]}>
                      {spent <= limit
                        ? t.leftPct(formatMoney(limit - spent), Math.round(ratio * 100))
                        : t.overBudget(formatMoney(spent - limit))}
                    </Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* Recurring Commitment Summary */}
          <View style={styles.heroCard}>
            <Text style={styles.heroLabel}>{t.activeRecurringTitle}</Text>
            <View style={styles.recSummaryRow}>
              <View>
                <Text style={styles.heroBig}>{formatMoney(monthlyRecurringTotal)}/mo</Text>
                <Text style={styles.heroSub}>
                  {t.recurringYearlySub(formatMoney(monthlyRecurringTotal * 12, false))}
                </Text>
              </View>
            </View>
          </View>

          {recurring.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="repeat-outline" size={36} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>{t.noRecurringTitle}</Text>
              <Text style={styles.emptyDesc}>{t.noRecurringDesc}</Text>
              <Pressable onPress={() => setShowAddRec(true)} style={styles.emptyBtn}>
                <Text style={styles.emptyBtnText}>{t.addFirstRecurring}</Text>
              </Pressable>
            </View>
          ) : (
            recurring.map((item) => {
              const meta = resolveCategoryMeta(item.category);
              const currentPeriod = getCurrentPeriodKey(item.frequency);
              const alreadyLogged = item.lastLoggedPeriod === currentPeriod;

              return (
                <View
                  key={item.id}
                  style={[styles.recCard, !item.active && { opacity: 0.55 }]}
                >
                  <View style={styles.recTop}>
                    <View style={[styles.catIcon, { backgroundColor: `${meta.color}20` }]}>
                      <Ionicons name={meta.icon} size={18} color={meta.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.budgetCatName}>{item.title}</Text>
                      <Text style={styles.budgetSpentText}>
                        {resolveCategoryLabel(item.category)} •{' '}
                        {freqLabel(item.frequency)}
                        {item.frequency === 'monthly'
                          ? ` (${t.dayLabel(item.dayOfMonth)})`
                          : ''}
                      </Text>
                    </View>
                    <Text style={styles.recAmount}>{formatMoney(item.amount)}</Text>
                  </View>

                  <View style={styles.recControls}>
                    <View style={styles.toggleGroup}>
                      <Text style={styles.toggleLabel}>{t.autoLog}</Text>
                      <Switch
                        value={item.autoLog}
                        onValueChange={(v) => setRecurringAutoLog(item.id, v)}
                        trackColor={{ false: Colors.border, true: Colors.primaryDark }}
                        thumbColor={item.autoLog ? Colors.primary : Colors.textMuted}
                      />
                    </View>

                    <View style={styles.toggleGroup}>
                      <Text style={styles.toggleLabel}>{t.active}</Text>
                      <Switch
                        value={item.active}
                        onValueChange={(v) => setRecurringActive(item.id, v)}
                        trackColor={{ false: Colors.border, true: Colors.primaryDark }}
                        thumbColor={item.active ? Colors.primary : Colors.textMuted}
                      />
                    </View>

                    <Pressable
                      onPress={() => handleDeleteRecurring(item.id, item.title)}
                      style={styles.iconTrash}
                    >
                      <Ionicons name="trash-outline" size={16} color={Colors.danger} />
                    </Pressable>
                  </View>

                  <View style={styles.recFooter}>
                    {alreadyLogged ? (
                      <View style={styles.loggedPill}>
                        <Ionicons name="checkmark-circle" size={14} color={Colors.primary} />
                        <Text style={styles.loggedText}>
                          {t.loggedFor(currentPeriod)}
                        </Text>
                      </View>
                    ) : (
                      <Pressable
                        onPress={() => logRecurringNow(item)}
                        style={styles.logNowBtn}
                      >
                        <Ionicons name="add-circle-outline" size={15} color={Colors.white} />
                        <Text style={styles.logNowText}>
                          {t.logNow(formatMoney(item.amount))}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      {/* Edit Budget Modal */}
      <Modal
        visible={editingBudgetCat !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingBudgetCat(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {editingBudgetCat
                ? t.monthlyBudgetModalTitle(resolveCategoryLabel(editingBudgetCat))
                : ''}
            </Text>
            <Text style={styles.modalSub}>{t.monthlyBudgetModalSub(currency)}</Text>
            <View style={styles.euroRow}>
              <Text style={styles.euroMark}>{currencyMeta.symbol}</Text>
              <TextInput
                value={budgetInput}
                onChangeText={setBudgetInput}
                keyboardType="decimal-pad"
                placeholder={currencyMeta.decimals === 0 ? '300000' : '300'}
                placeholderTextColor={Colors.textMuted}
                autoFocus
                style={styles.modalInput}
              />
            </View>
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setEditingBudgetCat(null)}
                style={styles.cancelBtn}
              >
                <Text style={styles.cancelText}>{t.cancel}</Text>
              </Pressable>
              <Pressable onPress={handleSaveBudget} style={styles.confirmBtn}>
                <Text style={styles.confirmText}>{t.saveLimit}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Add Recurring Expense Modal */}
      <Modal
        visible={showAddRec}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAddRec(false)}
      >
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.modalTitle}>{t.newRecurringTitle}</Text>
              <Pressable onPress={() => setShowAddRec(false)}>
                <Ionicons name="close" size={22} color={Colors.text} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.sheetBody}>
              <Text style={styles.fieldLabel}>{t.titleLabel} *</Text>
              <TextInput
                value={recTitle}
                onChangeText={setRecTitle}
                placeholder="Mortgage, Spotify, Telia..."
                placeholderTextColor={Colors.textMuted}
                style={styles.fieldInput}
              />

              <View style={styles.twoCol}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>{t.amountLabel(currencyMeta.symbol)} *</Text>
                  <TextInput
                    value={recAmount}
                    onChangeText={setRecAmount}
                    keyboardType="decimal-pad"
                    placeholder={currencyMeta.decimals === 0 ? '850000' : '850.00'}
                    placeholderTextColor={Colors.textMuted}
                    style={styles.fieldInput}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>{t.dayOfMonthLabel}</Text>
                  <TextInput
                    value={recDay}
                    onChangeText={setRecDay}
                    keyboardType="number-pad"
                    placeholder="1"
                    placeholderTextColor={Colors.textMuted}
                    style={styles.fieldInput}
                  />
                </View>
              </View>

              <Text style={styles.fieldLabel}>{t.merchantOptLabel}</Text>
              <TextInput
                value={recMerchant}
                onChangeText={setRecMerchant}
                placeholder="Swedbank, Telia..."
                placeholderTextColor={Colors.textMuted}
                style={styles.fieldInput}
              />

              <Text style={styles.fieldLabel}>{t.frequencyLabel}</Text>
              <View style={styles.freqRow}>
                {(['monthly', 'weekly', 'yearly'] as RecurringFrequency[]).map((f) => (
                  <Pressable
                    key={f}
                    onPress={() => setRecFreq(f)}
                    style={[styles.freqChip, recFreq === f && styles.freqChipActive]}
                  >
                    <Text
                      style={[
                        styles.freqText,
                        recFreq === f && { color: Colors.white },
                      ]}
                    >
                      {freqLabel(f)}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.fieldLabel}>{t.categoryLabel}</Text>
              <View style={styles.catGrid}>
                {allCategories.map((c) => {
                  const selected = recCategory === c.id;
                  return (
                    <Pressable
                      key={c.id}
                      onPress={() => setRecCategory(c.id)}
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

              <View style={styles.autoRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.autoTitle}>{t.autoLogOnDue}</Text>
                  <Text style={styles.autoDesc}>{t.autoLogDesc}</Text>
                </View>
                <Switch
                  value={recAutoLog}
                  onValueChange={setRecAutoLog}
                  trackColor={{ false: Colors.border, true: Colors.primaryDark }}
                  thumbColor={recAutoLog ? Colors.primary : Colors.textMuted}
                />
              </View>

              <Pressable onPress={handleCreateRecurring} style={styles.createBtn}>
                <Text style={styles.createBtnText}>{t.saveRecurring}</Text>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
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
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  addBtnText: {
    color: Colors.white,
    fontSize: 13,
    fontWeight: '700',
  },
  segmentWrap: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 9,
  },
  segmentActive: {
    backgroundColor: Colors.primary,
  },
  segmentText: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  scroll: {
    paddingHorizontal: 16,
    paddingBottom: 28,
    gap: 10,
  },
  heroCard: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10,
    marginBottom: 4,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  heroLabel: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  heroBig: {
    color: Colors.text,
    fontSize: 24,
    fontWeight: '800',
  },
  heroBarTrack: {
    height: 8,
    backgroundColor: Colors.bg,
    borderRadius: 99,
    overflow: 'hidden',
  },
  heroBarFill: {
    height: '100%',
    borderRadius: 99,
  },
  heroSub: {
    color: Colors.textMuted,
    fontSize: 12,
  },
  budgetCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10,
  },
  budgetTop: {
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
  budgetCatName: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  budgetSpentText: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  limitBadge: {
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  limitBadgeText: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  progressSection: {
    gap: 5,
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
  remainingNote: {
    fontSize: 11,
    fontWeight: '600',
  },
  recSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  recCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12,
  },
  recTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  recAmount: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  recControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 10,
  },
  toggleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  toggleLabel: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  iconTrash: {
    padding: 8,
    backgroundColor: Colors.dangerSoft,
    borderRadius: 10,
  },
  recFooter: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  loggedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.primarySoft,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  loggedText: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  logNowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  logNowText: {
    color: Colors.white,
    fontSize: 12,
    fontWeight: '700',
  },
  emptyBox: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
  },
  emptyTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  emptyDesc: {
    color: Colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  emptyBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 12,
    marginTop: 8,
  },
  emptyBtnText: {
    color: Colors.white,
    fontWeight: '700',
    fontSize: 13,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
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
    maxHeight: '88%',
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
    paddingBottom: 34,
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
  twoCol: {
    flexDirection: 'row',
    gap: 10,
  },
  freqRow: {
    flexDirection: 'row',
    gap: 8,
  },
  freqChip: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  freqChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  freqText: {
    color: Colors.textSecondary,
    fontSize: 12,
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
    gap: 5,
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
  autoRow: {
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
  autoTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  autoDesc: {
    color: Colors.textMuted,
    fontSize: 11,
    marginTop: 2,
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
});
