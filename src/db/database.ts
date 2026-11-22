import * as SQLite from 'expo-sqlite';
import type {
  CategoryBudget,
  CategoryId,
  Expense,
  ExpenseItem,
  MerchantRule,
  NewExpenseInput,
  NewExpenseItemInput,
  NewRecurringInput,
  RecurringExpense,
  RecurringFrequency,
  UpdateExpenseInput,
} from '@/types/finance';
import {
  getCurrentMonthKey,
  getCurrentPeriodKey,
  getTodayIso,
  normalizeMerchantKey,
  shiftMonthKey,
} from '@/utils/format';

const DB_NAME = 'finances_eur_v1.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function initSchema(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      merchant TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL,
      tax_amount REAL NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'other',
      date TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      receipt_uri TEXT,
      raw_ocr_text TEXT,
      recurring_id INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
    CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);

    CREATE TABLE IF NOT EXISTS expense_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expense_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 1,
      price REAL NOT NULL,
      FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_expense_items_expense_id ON expense_items(expense_id);

    CREATE TABLE IF NOT EXISTS budgets (
      category TEXT PRIMARY KEY,
      monthly_limit REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recurring_expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      merchant TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL,
      category TEXT NOT NULL DEFAULT 'other',
      frequency TEXT NOT NULL DEFAULT 'monthly',
      day_of_month INTEGER NOT NULL DEFAULT 1,
      auto_log INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1,
      last_logged_period TEXT,
      notes TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS merchant_rules (
      merchant_key TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await initSchema(db);
      return db;
    })();
  }
  return dbPromise;
}

interface ExpenseRow {
  id: number;
  title: string;
  merchant: string;
  amount: number;
  tax_amount: number;
  category: string;
  date: string;
  notes: string;
  receipt_uri: string | null;
  raw_ocr_text: string | null;
  recurring_id: number | null;
  created_at: string;
}

interface ExpenseItemRow {
  id: number;
  expense_id: number;
  name: string;
  quantity: number;
  price: number;
}

interface BudgetRow {
  category: string;
  monthly_limit: number;
}

interface RecurringRow {
  id: number;
  title: string;
  merchant: string;
  amount: number;
  category: string;
  frequency: string;
  day_of_month: number;
  auto_log: number;
  active: number;
  last_logged_period: string | null;
  notes: string;
}

interface MerchantRuleRow {
  merchant_key: string;
  category: string;
  updated_at: string;
}

function mapExpenseItem(row: ExpenseItemRow): ExpenseItem {
  return {
    id: row.id,
    expenseId: row.expense_id,
    name: row.name,
    quantity: row.quantity,
    price: row.price,
  };
}

function mapExpense(row: ExpenseRow, items: ExpenseItem[] = []): Expense {
  return {
    id: row.id,
    title: row.title,
    merchant: row.merchant,
    amount: row.amount,
    taxAmount: row.tax_amount,
    category: row.category as CategoryId,
    date: row.date,
    notes: row.notes,
    receiptUri: row.receipt_uri,
    rawOcrText: row.raw_ocr_text,
    recurringId: row.recurring_id,
    createdAt: row.created_at,
    items,
  };
}

function mapRecurring(row: RecurringRow): RecurringExpense {
  return {
    id: row.id,
    title: row.title,
    merchant: row.merchant,
    amount: row.amount,
    category: row.category as CategoryId,
    frequency: row.frequency as RecurringFrequency,
    dayOfMonth: row.day_of_month,
    autoLog: row.auto_log === 1,
    active: row.active === 1,
    lastLoggedPeriod: row.last_logged_period,
    notes: row.notes,
  };
}

// --- Expense Line Items CRUD ---

export async function fetchItemsByExpenseId(expenseId: number): Promise<ExpenseItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ExpenseItemRow>(
    'SELECT * FROM expense_items WHERE expense_id = ? ORDER BY id ASC',
    expenseId
  );
  return rows.map(mapExpenseItem);
}

export async function insertExpenseItem(
  expenseId: number,
  item: NewExpenseItemInput
): Promise<number> {
  const db = await getDb();
  const qty =
    item.quantity !== undefined && Number.isFinite(item.quantity) && item.quantity > 0
      ? Math.round(item.quantity * 1000) / 1000
      : 1;
  const res = await db.runAsync(
    `INSERT INTO expense_items (expense_id, name, quantity, price)
     VALUES (?, ?, ?, ?)`,
    expenseId,
    item.name.trim(),
    qty,
    Math.round(item.price * 100) / 100
  );
  return res.lastInsertRowId;
}

export async function updateExpenseItem(
  id: number,
  updates: Partial<NewExpenseItemInput>
): Promise<void> {
  const db = await getDb();
  const existing = await db.getFirstAsync<ExpenseItemRow>(
    'SELECT * FROM expense_items WHERE id = ?',
    id
  );
  if (!existing) return;

  const nextName = updates.name !== undefined ? updates.name.trim() : existing.name;
  const nextQty =
    updates.quantity !== undefined && Number.isFinite(updates.quantity) && updates.quantity > 0
      ? Math.round(updates.quantity * 1000) / 1000
      : existing.quantity;
  const nextPrice =
    updates.price !== undefined
      ? Math.round(updates.price * 100) / 100
      : existing.price;

  await db.runAsync(
    'UPDATE expense_items SET name = ?, quantity = ?, price = ? WHERE id = ?',
    nextName,
    nextQty,
    nextPrice,
    id
  );
}

export async function deleteExpenseItem(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM expense_items WHERE id = ?', id);
}

export async function replaceExpenseItems(
  expenseId: number,
  items: NewExpenseItemInput[]
): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM expense_items WHERE expense_id = ?', expenseId);
    for (const item of items) {
      const trimmed = item.name.trim();
      if (!trimmed) continue;
      const qty =
        item.quantity !== undefined && Number.isFinite(item.quantity) && item.quantity > 0
          ? Math.round(item.quantity * 1000) / 1000
          : 1;
      await db.runAsync(
        `INSERT INTO expense_items (expense_id, name, quantity, price)
         VALUES (?, ?, ?, ?)`,
        expenseId,
        trimmed,
        qty,
        Math.round(item.price * 100) / 100
      );
    }
  });
}

// --- Expenses ---

export async function fetchAllExpenses(): Promise<Expense[]> {
  const db = await getDb();
  const [rows, itemRows] = await Promise.all([
    db.getAllAsync<ExpenseRow>('SELECT * FROM expenses ORDER BY date DESC, id DESC'),
    db.getAllAsync<ExpenseItemRow>('SELECT * FROM expense_items ORDER BY id ASC'),
  ]);

  const itemsByExpense = new Map<number, ExpenseItem[]>();
  for (const row of itemRows) {
    const mapped = mapExpenseItem(row);
    const list = itemsByExpense.get(mapped.expenseId) ?? [];
    list.push(mapped);
    itemsByExpense.set(mapped.expenseId, list);
  }

  return rows.map((row) => mapExpense(row, itemsByExpense.get(row.id) ?? []));
}

export async function insertExpense(input: NewExpenseInput): Promise<number> {
  const db = await getDb();
  const now = new Date().toISOString();
  const res = await db.runAsync(
    `INSERT INTO expenses (title, merchant, amount, tax_amount, category, date, notes, receipt_uri, raw_ocr_text, recurring_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.title.trim(),
    input.merchant.trim(),
    Math.round(input.amount * 100) / 100,
    Math.round((input.taxAmount ?? 0) * 100) / 100,
    input.category,
    input.date,
    (input.notes ?? '').trim(),
    input.receiptUri ?? null,
    input.rawOcrText ?? null,
    input.recurringId ?? null,
    now
  );

  const expenseId = res.lastInsertRowId;

  if (input.items && input.items.length > 0) {
    await replaceExpenseItems(expenseId, input.items);
  }

  const key = normalizeMerchantKey(input.merchant || input.title);
  if (key.length >= 2) {
    await upsertMerchantRule(key, input.category);
  }

  return expenseId;
}

export async function updateExpense(
  id: number,
  updates: UpdateExpenseInput
): Promise<void> {
  const db = await getDb();
  const existing = await db.getFirstAsync<ExpenseRow>(
    'SELECT * FROM expenses WHERE id = ?',
    id
  );
  if (!existing) return;

  const nextTitle = updates.title !== undefined ? updates.title.trim() : existing.title;
  const nextMerchant =
    updates.merchant !== undefined ? updates.merchant.trim() : existing.merchant;
  const nextAmount =
    updates.amount !== undefined
      ? Math.round(updates.amount * 100) / 100
      : existing.amount;
  const nextTax =
    updates.taxAmount !== undefined
      ? Math.round(updates.taxAmount * 100) / 100
      : existing.tax_amount;
  const nextCategory = updates.category ?? (existing.category as CategoryId);
  const nextDate = updates.date ?? existing.date;
  const nextNotes = updates.notes !== undefined ? updates.notes.trim() : existing.notes;
  const nextReceiptUri =
    updates.receiptUri !== undefined ? updates.receiptUri : existing.receipt_uri;

  await db.runAsync(
    `UPDATE expenses
     SET title = ?, merchant = ?, amount = ?, tax_amount = ?, category = ?, date = ?, notes = ?, receipt_uri = ?
     WHERE id = ?`,
    nextTitle,
    nextMerchant,
    nextAmount,
    nextTax,
    nextCategory,
    nextDate,
    nextNotes,
    nextReceiptUri,
    id
  );

  if (updates.items !== undefined) {
    await replaceExpenseItems(id, updates.items);
  }

  const key = normalizeMerchantKey(nextMerchant || nextTitle);
  if (key.length >= 2) {
    await upsertMerchantRule(key, nextCategory);
  }
}

export async function deleteExpense(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM expense_items WHERE expense_id = ?', id);
  await db.runAsync('DELETE FROM expenses WHERE id = ?', id);
}

// --- Budgets ---

export async function fetchAllBudgets(): Promise<CategoryBudget[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<BudgetRow>('SELECT * FROM budgets');
  return rows.map((r) => ({
    category: r.category as CategoryId,
    monthlyLimit: r.monthly_limit,
  }));
}

export async function upsertBudget(category: CategoryId, monthlyLimit: number): Promise<void> {
  const db = await getDb();
  if (monthlyLimit <= 0) {
    await db.runAsync('DELETE FROM budgets WHERE category = ?', category);
    return;
  }
  await db.runAsync(
    `INSERT INTO budgets (category, monthly_limit) VALUES (?, ?)
     ON CONFLICT(category) DO UPDATE SET monthly_limit = excluded.monthly_limit`,
    category,
    Math.round(monthlyLimit * 100) / 100
  );
}

// --- Recurring Expenses ---

export async function fetchAllRecurring(): Promise<RecurringExpense[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<RecurringRow>(
    'SELECT * FROM recurring_expenses ORDER BY active DESC, day_of_month ASC, id DESC'
  );
  return rows.map(mapRecurring);
}

export async function insertRecurring(input: NewRecurringInput): Promise<number> {
  const db = await getDb();
  const clampedDay = Math.min(28, Math.max(1, Math.round(input.dayOfMonth || 1)));
  const res = await db.runAsync(
    `INSERT INTO recurring_expenses (title, merchant, amount, category, frequency, day_of_month, auto_log, active, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    input.title.trim(),
    input.merchant.trim(),
    Math.round(input.amount * 100) / 100,
    input.category,
    input.frequency,
    clampedDay,
    input.autoLog ? 1 : 0,
    (input.notes ?? '').trim()
  );
  return res.lastInsertRowId;
}

export async function toggleRecurringActive(id: number, active: boolean): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE recurring_expenses SET active = ? WHERE id = ?',
    active ? 1 : 0,
    id
  );
}

export async function toggleRecurringAutoLog(id: number, autoLog: boolean): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE recurring_expenses SET auto_log = ? WHERE id = ?',
    autoLog ? 1 : 0,
    id
  );
}

export async function deleteRecurring(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM recurring_expenses WHERE id = ?', id);
}

export async function logRecurringForCurrentPeriod(
  item: RecurringExpense,
  overrideAmount?: number
): Promise<number> {
  const db = await getDb();
  const now = new Date();
  const periodKey = getCurrentPeriodKey(item.frequency, now);
  const amount = overrideAmount ?? item.amount;

  let dateStr = getTodayIso();
  if (item.frequency === 'monthly') {
    const monthKey = getCurrentMonthKey();
    const day = Math.min(item.dayOfMonth, now.getDate());
    dateStr = `${monthKey}-${String(day).padStart(2, '0')}`;
  }

  const expenseId = await insertExpense({
    title: item.title,
    merchant: item.merchant || item.title,
    amount,
    taxAmount: 0,
    category: item.category,
    date: dateStr,
    notes: item.notes ? `${item.notes} (Recurring)` : 'Recurring expense',
    recurringId: item.id,
  });

  await db.runAsync(
    'UPDATE recurring_expenses SET last_logged_period = ? WHERE id = ?',
    periodKey,
    item.id
  );

  return expenseId;
}

export async function processDueAutoRecurring(): Promise<number> {
  const items = await fetchAllRecurring();
  const now = new Date();
  const todayDay = now.getDate();
  let loggedCount = 0;

  for (const item of items) {
    if (!item.active || !item.autoLog) continue;
    const periodKey = getCurrentPeriodKey(item.frequency, now);
    if (item.lastLoggedPeriod === periodKey) continue;

    if (item.frequency === 'monthly' && todayDay < item.dayOfMonth) continue;

    await logRecurringForCurrentPeriod(item);
    loggedCount += 1;
  }

  return loggedCount;
}

// --- Merchant Rules ---

export async function fetchMerchantRules(): Promise<MerchantRule[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<MerchantRuleRow>('SELECT * FROM merchant_rules');
  return rows.map((r) => ({
    merchantKey: r.merchant_key,
    category: r.category as CategoryId,
    updatedAt: r.updated_at,
  }));
}

export async function upsertMerchantRule(
  merchantKey: string,
  category: CategoryId
): Promise<void> {
  const db = await getDb();
  const normalized = normalizeMerchantKey(merchantKey);
  if (normalized.length < 2) return;
  await db.runAsync(
    `INSERT INTO merchant_rules (merchant_key, category, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(merchant_key) DO UPDATE SET category = excluded.category, updated_at = excluded.updated_at`,
    normalized,
    category,
    new Date().toISOString()
  );
}

// --- Sample Data & Reset ---

export async function seedSampleData(): Promise<void> {
  const currMonth = getCurrentMonthKey();
  const prevMonth = shiftMonthKey(currMonth, -1);
  const twoMonthsAgo = shiftMonthKey(currMonth, -2);

  const sampleExpenses: NewExpenseInput[] = [
    // Current month
    {
      title: 'Monthly Mortgage',
      merchant: 'Home Bank Mortgage',
      amount: 850,
      category: 'mortgage',
      date: `${currMonth}-01`,
      notes: 'Fixed monthly payment',
    },
    {
      title: 'Lidl Weekly Shop',
      merchant: 'Lidl',
      amount: 24.45,
      taxAmount: 4.24,
      category: 'groceries',
      date: `${currMonth}-03`,
      notes: 'Groceries & produce',
      items: [
        { name: 'Pienas 2.5%', quantity: 2, price: 3.18 },
        { name: 'Chicken Breast 1kg', quantity: 1, price: 6.49 },
        { name: 'Eggs 10pcs', quantity: 1, price: 2.89 },
        { name: 'Bananas 1.2kg', quantity: 1, price: 1.79 },
        { name: 'Sourdough Bread', quantity: 1, price: 2.45 },
        { name: 'Cheddar Cheese', quantity: 1, price: 4.15 },
        { name: 'Coffee Beans 500g', quantity: 1, price: 4.5 },
        { name: 'Nuolaida', quantity: 1, price: -1.0 },
      ],
    },
    {
      title: 'Electricity & Fiber',
      merchant: 'Ignitis / Telia',
      amount: 98.4,
      taxAmount: 17.08,
      category: 'utilities',
      date: `${currMonth}-05`,
    },
    {
      title: 'Steam Autumn Sale',
      merchant: 'Steam',
      amount: 54.99,
      taxAmount: 9.54,
      category: 'games',
      date: `${currMonth}-06`,
      notes: '2 indie games + DLC',
      items: [
        { name: 'Hades II', quantity: 1, price: 28.99 },
        { name: 'Balatro', quantity: 1, price: 13.99 },
        { name: 'Cyberpunk DLC', quantity: 1, price: 12.01 },
      ],
    },
    {
      title: 'Maxima Groceries',
      merchant: 'Maxima',
      amount: 18.6,
      taxAmount: 3.23,
      category: 'groceries',
      date: `${currMonth}-08`,
      items: [
        { name: 'Milk 2.5%', quantity: 1, price: 1.65 },
        { name: 'Greek Yogurt', quantity: 2, price: 3.2 },
        { name: 'Avocados', quantity: 3, price: 4.5 },
        { name: 'Salmon Fillet', quantity: 1, price: 9.25 },
      ],
    },
    {
      title: 'Property & Municipal Tax',
      merchant: 'VMI Tax Office',
      amount: 145.0,
      taxAmount: 145.0,
      category: 'taxes',
      date: `${currMonth}-10`,
      notes: 'Quarterly tax receipt',
    },
    {
      title: 'Cinema & Drinks',
      merchant: 'Forum Cinemas',
      amount: 46.5,
      taxAmount: 8.07,
      category: 'fun',
      date: `${currMonth}-11`,
    },
    {
      title: 'Wolt Burgers',
      merchant: 'Wolt',
      amount: 28.9,
      taxAmount: 5.02,
      category: 'dining',
      date: `${currMonth}-12`,
    },
    {
      title: 'Fuel Fill-Up',
      merchant: 'Circle K',
      amount: 64.2,
      taxAmount: 11.14,
      category: 'transport',
      date: `${currMonth}-14`,
    },
    {
      title: 'PlayStation Store',
      merchant: 'PlayStation',
      amount: 39.99,
      taxAmount: 6.94,
      category: 'games',
      date: `${currMonth}-15`,
    },
    {
      title: 'Rimi Groceries',
      merchant: 'Rimi',
      amount: 8.0,
      taxAmount: 1.39,
      category: 'groceries',
      date: `${currMonth}-17`,
      items: [
        { name: 'Milk', quantity: 1, price: 3.0 },
        { name: 'Kinder Bueno', quantity: 1, price: 1.0 },
        { name: 'Eggs', quantity: 1, price: 4.0 },
      ],
    },
    {
      title: 'Coffee & Lunch',
      merchant: 'Caffeine',
      amount: 13.8,
      taxAmount: 2.39,
      category: 'dining',
      date: `${currMonth}-18`,
    },
    {
      title: 'Spotify & Cloud',
      merchant: 'Spotify',
      amount: 14.99,
      category: 'subscriptions',
      date: `${currMonth}-19`,
    },
    {
      title: 'Weekend Bowling & Pub',
      merchant: 'Apollo Bowling',
      amount: 58.0,
      taxAmount: 10.07,
      category: 'fun',
      date: `${currMonth}-20`,
    },

    // Previous month
    { title: 'Monthly Mortgage', merchant: 'Home Bank Mortgage', amount: 850, category: 'mortgage', date: `${prevMonth}-01` },
    { title: 'Lidl Groceries', merchant: 'Lidl', amount: 195.4, taxAmount: 33.91, category: 'groceries', date: `${prevMonth}-09` },
    { title: 'Utilities', merchant: 'Ignitis', amount: 91.2, taxAmount: 15.83, category: 'utilities', date: `${prevMonth}-06` },
    { title: 'Steam Purchase', merchant: 'Steam', amount: 29.99, taxAmount: 5.2, category: 'games', date: `${prevMonth}-14` },
    { title: 'Cinema Night', merchant: 'Forum Cinemas', amount: 34.0, taxAmount: 5.9, category: 'fun', date: `${prevMonth}-18` },
    { title: 'Fuel', merchant: 'Circle K', amount: 59.0, taxAmount: 10.24, category: 'transport', date: `${prevMonth}-12` },
    { title: 'Dining Out', merchant: 'Wolt', amount: 42.5, taxAmount: 7.38, category: 'dining', date: `${prevMonth}-22` },

    // 2 months ago
    { title: 'Monthly Mortgage', merchant: 'Home Bank Mortgage', amount: 850, category: 'mortgage', date: `${twoMonthsAgo}-01` },
    { title: 'Groceries Total', merchant: 'Rimi', amount: 210.0, taxAmount: 36.45, category: 'groceries', date: `${twoMonthsAgo}-15` },
    { title: 'Utilities', merchant: 'Ignitis', amount: 88.5, taxAmount: 15.36, category: 'utilities', date: `${twoMonthsAgo}-07` },
    { title: 'Games', merchant: 'Steam', amount: 24.99, category: 'games', date: `${twoMonthsAgo}-19` },
    { title: 'Fun & Concerts', merchant: 'Bilietai', amount: 52.0, category: 'fun', date: `${twoMonthsAgo}-21` },
  ];

  for (const exp of sampleExpenses) {
    await insertExpense(exp);
  }

  await upsertBudget('groceries', 300);
  await upsertBudget('fun', 100);
  await upsertBudget('games', 60);
  await upsertBudget('dining', 80);
  await upsertBudget('transport', 100);
  await upsertBudget('mortgage', 850);
  await upsertBudget('utilities', 120);

  await insertRecurring({
    title: 'Monthly Mortgage',
    merchant: 'Home Bank Mortgage',
    amount: 850,
    category: 'mortgage',
    frequency: 'monthly',
    dayOfMonth: 1,
    autoLog: true,
    notes: 'Auto-logged on the 1st',
  });
  await insertRecurring({
    title: 'Fiber Internet',
    merchant: 'Telia',
    amount: 24.9,
    category: 'utilities',
    frequency: 'monthly',
    dayOfMonth: 10,
    autoLog: true,
  });
  await insertRecurring({
    title: 'Spotify Duo',
    merchant: 'Spotify',
    amount: 14.99,
    category: 'subscriptions',
    frequency: 'monthly',
    dayOfMonth: 19,
    autoLog: false,
    notes: 'Confirm manually each month',
  });

  const db = await getDb();
  await db.runAsync(
    'UPDATE recurring_expenses SET last_logged_period = ?',
    currMonth
  );
}

export async function clearAllData(): Promise<void> {
  const db = await getDb();
  await db.execAsync(`
    DELETE FROM expense_items;
    DELETE FROM expenses;
    DELETE FROM budgets;
    DELETE FROM recurring_expenses;
    DELETE FROM merchant_rules;
  `);
}

// --- App Settings ---

export async function getAppSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_settings WHERE key = ?',
    key
  );
  return row?.value ?? null;
}

export async function setAppSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    value
  );
}
