import { AccountType, FinancialYearStatus, LedgerEntryType, Prisma, RecordStatus, VoucherStatus, VoucherType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { generateNextAccountCode, isAccountCodeConflict } from '../../lib/account-code';
import { SELECTABLE_ACCOUNT } from '../../lib/record-status';
import { logger } from '../../lib/logger';
import { AppError } from '../../utils/helpers';
import { DEFAULT_PAGE_SIZE, PaginatedResult, SELECTOR_MAX_PAGE_SIZE } from '../../utils/pagination';
import { assertNotMaalKhataLinkedAccount, isMaalKhataCategoryName } from '../products/maal-khata';
import {
  compareLedgerEntries,
  computeLedgerBalance,
  endOfDay,
  entryEffectiveDate,
  isTrialBalanceBalanced,
  parseVoucherDateInput,
  startOfDay,
  trialBalanceFromSignedBalance,
} from './ledger-utils';
import { verifyLedgerIntegrity, LEDGER_INTEGRITY_SQL } from './ledger-integrity';
export { verifyLedgerIntegrity, LEDGER_INTEGRITY_SQL };
import { isBardanaLedgerNote } from '../invoices/invoice-voucher-descriptions';
import { getStockSummary } from '../stock/stock.service';

type DbClient = Prisma.TransactionClient | typeof prisma;

/** Voucher posting recomputes full ledger chains — allow longer interactive transactions. */
export const WRITE_TRANSACTION_OPTIONS = { maxWait: 30_000, timeout: 120_000 } as const;

export function fiscalYearLabelForDate(date: Date): { label: string; startDate: Date } {
  const year = date.getFullYear();
  const month = date.getMonth();
  if (month >= 6) {
    return { label: `${year}-${year + 1}`, startDate: new Date(year, 6, 1) };
  }
  return { label: `${year - 1}-${year}`, startDate: new Date(year - 1, 6, 1) };
}

/** First financial year created on a fresh install (July 2026 – June 2027). */
export const INITIAL_FINANCIAL_YEAR = {
  label: '2026-2027',
  startDate: new Date(2026, 6, 1),
} as const;

function nextFiscalYearLabel(label: string): string {
  const startYear = parseInt(label.split('-')[0] ?? '', 10);
  if (!Number.isFinite(startYear)) {
    throw new AppError(500, 'Invalid financial year label');
  }
  return `${startYear + 1}-${startYear + 2}`;
}

export async function getActiveFinancialYearId(db: DbClient): Promise<number> {
  let year = await db.financialYear.findFirst({
    where: { status: FinancialYearStatus.ACTIVE },
    select: { id: true },
  });
  if (!year) {
    const current = fiscalYearLabelForDate(new Date());
    const created = await db.financialYear.create({
      data: {
        label: current.label,
        startDate: current.startDate,
        status: FinancialYearStatus.ACTIVE,
      },
    });
    year = { id: created.id };
  }
  return year.id;
}

export async function assertActiveFinancialYear(
  db: DbClient,
  financialYearId: number | null | undefined,
): Promise<void> {
  const activeId = await getActiveFinancialYearId(db);
  if (financialYearId == null || financialYearId !== activeId) {
    throw new AppError(
      403,
      'This record belongs to a closed financial year and can no longer be edited or deleted.',
    );
  }
}

/** Accounting date must fall inside the active financial year (not just "a year exists"). */
export async function assertVoucherDateInActiveFinancialYear(
  db: DbClient,
  voucherDate: Date,
  recordLabel: 'Voucher' | 'Invoice' = 'Voucher',
): Promise<number> {
  const activeYear = await db.financialYear.findFirst({
    where: { status: FinancialYearStatus.ACTIVE },
  });
  if (!activeYear) throw new AppError(400, 'No active financial year');

  const day = startOfDay(voucherDate);
  const yearStart = startOfDay(activeYear.startDate);
  if (day < yearStart) {
    throw new AppError(400, `${recordLabel} date is before the active financial year`);
  }
  if (activeYear.endDate) {
    const yearEnd = endOfDay(activeYear.endDate);
    if (day > yearEnd) {
      throw new AppError(400, `${recordLabel} date is after the active financial year`);
    }
  }
  return activeYear.id;
}

async function assertTrialBalanceInDev(db: DbClient) {
  // Full integrity scans the entire chart. Never run on the hot post path unless
  // explicitly requested — tests that need it should call verifyLedgerIntegrity().
  if (process.env.ACCOUNTING_STRICT_INTEGRITY !== '1') {
    return;
  }
  const report = await verifyLedgerIntegrity(db);
  if (!report.ok) {
    console.error('[accounting] Ledger integrity check failed after voucher change', report);
    throw new Error(
      `Ledger integrity failed: trial diff=${report.trialBalance.difference}, entry diff=${report.globalActiveEntryTotals.difference}, drift=${report.ledgerDrift.length}, vouchers=${report.unbalancedVouchers.length}`,
    );
  }
}

async function getOpeningBalanceSnapshot(
  db: DbClient,
  accountId: number,
  financialYearId: number,
): Promise<{ balance: number; priorYearLabel: string | null; hasSnapshot: boolean }> {
  const currentYear = await db.financialYear.findFirst({
    where: { id: financialYearId },
  });
  if (!currentYear) return { balance: 0, priorYearLabel: null, hasSnapshot: false };

  const priorYear = await db.financialYear.findFirst({
    where: { startDate: { lt: currentYear.startDate } },
    orderBy: { startDate: 'desc' },
    select: { id: true, label: true },
  });
  if (!priorYear) return { balance: 0, priorYearLabel: null, hasSnapshot: false };

  const snapshot = await db.financialYearClosingBalance.findUnique({
    where: {
      financialYearId_accountId: {
        financialYearId: priorYear.id,
        accountId,
      },
    },
  });
  if (!snapshot) {
    return { balance: 0, priorYearLabel: priorYear.label, hasSnapshot: false };
  }
  return {
    balance: Number(snapshot.balance),
    priorYearLabel: priorYear.label,
    hasSnapshot: true,
  };
}

export const FY_CHANGE_PASSWORD = 'CUIVHR';

export type FinancialYearClient = {
  id: number;
  label: string;
  startDate: Date;
  endDate: Date | null;
  status: FinancialYearStatus;
  isActive: boolean;
};

function sanitizeFinancialYear(
  year: {
    id: number;
    label: string;
    startDate: Date;
    endDate: Date | null;
    status: FinancialYearStatus;
  },
): FinancialYearClient {
  return {
    id: year.id,
    label: year.label,
    startDate: year.startDate,
    endDate: year.endDate,
    status: year.status,
    isActive: year.status === FinancialYearStatus.ACTIVE,
  };
}

export async function getActiveFinancialYear(db: DbClient = prisma): Promise<FinancialYearClient> {
  const id = await getActiveFinancialYearId(db);
  const year = await db.financialYear.findUniqueOrThrow({ where: { id } });
  return sanitizeFinancialYear(year);
}

export async function listFinancialYears(): Promise<FinancialYearClient[]> {
  const years = await prisma.financialYear.findMany({
    where: {},
    orderBy: { startDate: 'desc' },
    select: {
      id: true,
      label: true,
      startDate: true,
      endDate: true,
      status: true,
    },
  });
  return years.map(sanitizeFinancialYear);
}

export type ChangeFinancialYearResult =
  | { ok: true; closedYear: FinancialYearClient; newYear: FinancialYearClient }
  | { ok: false };

/** Admin-only financial year rollover. Wrong password returns { ok: false } silently. */
export async function changeFinancialYear(
  userId: number,
  password: string,
): Promise<ChangeFinancialYearResult> {
  if (password !== FY_CHANGE_PASSWORD) {
    return { ok: false };
  }

  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const activeYear = await tx.financialYear.findFirst({
      where: { status: FinancialYearStatus.ACTIVE },
    });
    if (!activeYear) throw new AppError(400, 'No active financial year to close');

    const ledgers = await tx.ledger.findMany({ select: { balance: true } });
    let closingDebit = 0;
    let closingCredit = 0;
    for (const ledger of ledgers) {
      const { debit, credit } = trialBalanceFromSignedBalance(Number(ledger.balance));
      closingDebit += debit;
      closingCredit += credit;
    }
    if (!isTrialBalanceBalanced(closingDebit, closingCredit)) {
      throw new AppError(
        400,
        'Cannot change financial year while trial balance is out of balance',
      );
    }

    const accounts = await tx.account.findMany({
      where: {},
      include: { ledger: true },
    });

    const computedAt = new Date();
    // Per-account closing balances are independent, but each upsert carries a distinct balance value;
    // Prisma has no batch upsert — sequential upserts kept for correctness.
    for (const account of accounts) {
      const balance = account.ledger ? Number(account.ledger.balance) : 0;
      await tx.financialYearClosingBalance.upsert({
        where: {
          financialYearId_accountId: {
            financialYearId: activeYear.id,
            accountId: account.id,
          },
        },
        create: {
          financialYearId: activeYear.id,
          accountId: account.id,
          balance,
          computedAt,
        },
        update: { balance, computedAt },
      });
    }

    const endDate = new Date();
    const closedYear = await tx.financialYear.update({
      where: { id: activeYear.id },
      data: {
        status: FinancialYearStatus.CLOSED,
        closedAt: endDate,
        closedById: userId,
        endDate,
      },
    });

    const nextStart = new Date(endDate);
    nextStart.setDate(nextStart.getDate() + 1);
    nextStart.setHours(0, 0, 0, 0);

    const changedAt = new Date();
    const newYear = await tx.financialYear.create({
      data: {
        label: nextFiscalYearLabel(activeYear.label),
        startDate: nextStart,
        status: FinancialYearStatus.ACTIVE,
        changedAt,
        changedById: userId,
      },
    });

    return { closedYear, newYear };
  }, WRITE_TRANSACTION_OPTIONS);

  return {
    ok: true,
    closedYear: sanitizeFinancialYear(result.closedYear),
    newYear: sanitizeFinancialYear(result.newYear),
  };
}

/** @deprecated Use changeFinancialYear — kept for existing route compatibility during transition. */
export async function closeFinancialYear(userId: number) {
  const result = await changeFinancialYear(userId, FY_CHANGE_PASSWORD);
  if (!result.ok) throw new AppError(403, 'Not authorized');
  return { closedYear: result.closedYear, newYear: result.newYear };
}

function isBankOrCashCategory(name: string) {
  const n = name.trim().toLowerCase();
  return n.includes('bank') || n.includes('cash');
}

async function loadAccounts(
  tx: Prisma.TransactionClient,
  debitAccountId: number,
  creditAccountId: number,
) {
  if (debitAccountId === creditAccountId) {
    throw new AppError(400, 'Debit and credit accounts must be different');
  }

  // Parallel reads inside $transaction are safe with connection_limit=5; kept sequential for clarity.
  const debitAccount = await tx.account.findFirst({
    where: { id: debitAccountId, ...SELECTABLE_ACCOUNT },
      include: { category: true },
  });
  const creditAccount = await tx.account.findFirst({
    where: { id: creditAccountId, ...SELECTABLE_ACCOUNT },
      include: { category: true },
  });

  if (!debitAccount || !creditAccount) {
    throw new AppError(400, 'One or both accounts are invalid');
  }

  return { debitAccount, creditAccount };
}

function assertVoucherAccountRules(
  type: VoucherType,
  debitAccount: { category: { name: string } },
  creditAccount: { category: { name: string } },
) {
  if (type === 'RECEIPT' && !isBankOrCashCategory(debitAccount.category.name)) {
    throw new AppError(400, 'Receipt must debit a Bank or Cash account (To side)');
  }
  if (type === 'PAYMENT' && !isBankOrCashCategory(creditAccount.category.name)) {
    throw new AppError(400, 'Payment must credit a Bank or Cash account (From side)');
  }
}

type VoucherCreateInput = {
  type: VoucherType;
  debitAccountId: number;
  creditAccountId: number;
  amount: number;
  date: Date;
  description?: string;
  reference: string;
};

/** Shared server-side validation for all voucher types (payment, receipt, journal). */
async function validateVoucherCreate(
  tx: Prisma.TransactionClient,
  data: VoucherCreateInput,
) {
  if (!(data.amount > 0)) {
    throw new AppError(400, 'Amount must be greater than zero');
  }

  if (data.type === 'KACHI') {
    throw new AppError(400, 'Invoice vouchers are created via invoice posting');
  }

  const reference = data.reference?.trim();
  if (!reference) {
    throw new AppError(400, 'Reference is required');
  }

  const { debitAccount, creditAccount } = await loadAccounts(
    tx,
    data.debitAccountId,
    data.creditAccountId,
  );
  assertVoucherAccountRules(data.type, debitAccount, creditAccount);

  const financialYearId = await assertVoucherDateInActiveFinancialYear(tx, data.date);

  return { debitAccount, creditAccount, financialYearId };
}

export async function recomputeLedgerRunningBalancesInTx(
  tx: Prisma.TransactionClient,
  ledgerId: number,
  financialYearId: number,
) {
  const ledger = await tx.ledger.findUniqueOrThrow({
    where: { id: ledgerId },
    include: { account: true },
  });

  const { balance: opening } = await getOpeningBalanceSnapshot(tx, ledger.accountId, financialYearId);
  const { yearStart, yearEnd } = await loadFinancialYearBounds(tx, financialYearId);

  const entries = await tx.ledgerEntry.findMany({
    where: ledgerEntriesForYearWhere(ledgerId, financialYearId, yearStart, yearEnd),
    include: { voucher: { select: { date: true, number: true } } },
    orderBy: { id: 'asc' },
  });

  entries.sort(compareLedgerEntries);

  // Sequential: each entry balance depends on the running total from prior entries.
  let running = opening;
  for (const entry of entries) {
    const debit = entry.type === LedgerEntryType.DEBIT ? Number(entry.amount) : 0;
    const credit = entry.type === LedgerEntryType.CREDIT ? Number(entry.amount) : 0;
    running = computeLedgerBalance(running, debit, credit);
    const stored = Number(entry.balance);
    if (Math.abs(stored - running) >= 0.005) {
      await tx.ledgerEntry.update({ where: { id: entry.id }, data: { balance: running } });
    }
  }

  await recomputeFullLedgerBalanceInTx(tx, ledgerId);
}

type LedgerEntryTip = {
  id: number;
  ledgerId: number;
  financialYearId: number | null;
  type: LedgerEntryType;
  amount: Prisma.Decimal | number;
  balance: Prisma.Decimal | number;
  createdAt: Date;
  isOpeningBalance: boolean;
  voucher: { date: Date; number: number } | null;
};

/** Latest entry by ledger sort order, excluding freshly posted ids. */
async function findLatestLedgerEntryExcluding(
  tx: Prisma.TransactionClient,
  ledgerId: number,
  excludeIds: number[],
): Promise<LedgerEntryTip | null> {
  const exclude = excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {};
  const include = { voucher: { select: { date: true, number: true } } } as const;

  const latestLinked = await tx.ledgerEntry.findFirst({
    where: { ledgerId, ...exclude, voucherId: { not: null } },
    include,
    orderBy: [
      { voucher: { date: 'desc' } },
      { voucher: { number: 'desc' } },
      { id: 'desc' },
    ],
  });

  const latestOpening = await tx.ledgerEntry.findFirst({
    where: { ledgerId, ...exclude, isOpeningBalance: true },
    include,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });

  const latestOrphan = await tx.ledgerEntry.findFirst({
    where: { ledgerId, ...exclude, voucherId: null, isOpeningBalance: false },
    include,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });

  const candidates = [latestLinked, latestOpening, latestOrphan].filter(
    (e): e is NonNullable<typeof e> => e != null,
  );
  if (candidates.length === 0) return null;

  let tip = candidates[0];
  for (let i = 1; i < candidates.length; i += 1) {
    if (compareLedgerEntries(candidates[i], tip) > 0) tip = candidates[i];
  }
  return tip;
}

/**
 * After posting brand-new ledger entries: O(1) append when they sort after the current tip.
 * Falls back to full FY + all-time recompute for backdated / out-of-order inserts.
 */
export const ledgerBalanceApplyStats = {
  incremental: 0,
  full: 0,
};

export function resetLedgerBalanceApplyStats() {
  ledgerBalanceApplyStats.incremental = 0;
  ledgerBalanceApplyStats.full = 0;
}

async function applyPostedLedgerEntriesInTx(
  tx: Prisma.TransactionClient,
  ledgerId: number,
  financialYearId: number,
  newEntryIds: number[],
): Promise<'incremental' | 'full'> {
  if (newEntryIds.length === 0) return 'incremental';

  const newEntries = await tx.ledgerEntry.findMany({
    where: { id: { in: newEntryIds } },
    include: { voucher: { select: { date: true, number: true } } },
  });
  if (newEntries.length !== newEntryIds.length) {
    await recomputeLedgerRunningBalancesInTx(tx, ledgerId, financialYearId);
    ledgerBalanceApplyStats.full += 1;
    return 'full';
  }
  newEntries.sort(compareLedgerEntries);

  const tip = await findLatestLedgerEntryExcluding(tx, ledgerId, newEntryIds);
  const isAppend = tip == null || compareLedgerEntries(tip, newEntries[0]) < 0;
  if (!isAppend) {
    await recomputeLedgerRunningBalancesInTx(tx, ledgerId, financialYearId);
    ledgerBalanceApplyStats.full += 1;
    return 'full';
  }

  const ledger = await tx.ledger.findUniqueOrThrow({ where: { id: ledgerId } });
  let liveBalance = Number(ledger.balance);

  let fyRunning: number;
  if (tip && tip.financialYearId === financialYearId) {
    fyRunning = Number(tip.balance);
  } else {
    const snap = await getOpeningBalanceSnapshot(tx, ledger.accountId, financialYearId);
    fyRunning = snap.balance;
  }

  for (const entry of newEntries) {
    const debit = entry.type === LedgerEntryType.DEBIT ? Number(entry.amount) : 0;
    const credit = entry.type === LedgerEntryType.CREDIT ? Number(entry.amount) : 0;
    liveBalance = computeLedgerBalance(liveBalance, debit, credit);
    fyRunning = computeLedgerBalance(fyRunning, debit, credit);
    // Sequential: FY running balance on each new entry depends on the previous entry in sort order.
    await tx.ledgerEntry.update({
      where: { id: entry.id },
      data: { balance: fyRunning },
    });
  }

  await tx.ledger.update({ where: { id: ledgerId }, data: { balance: liveBalance } });
  ledgerBalanceApplyStats.incremental += 1;
  return 'incremental';
}

/** Live ledger balance spans all financial years; never scope to active FY only. */
async function recomputeFullLedgerBalanceInTx(
  tx: Prisma.TransactionClient,
  ledgerId: number,
): Promise<number> {
  const entries = await tx.ledgerEntry.findMany({
    where: { ledgerId },
    include: { voucher: { select: { date: true, number: true } } },
    orderBy: { id: 'asc' },
  });
  entries.sort(compareLedgerEntries);

  let running = 0;
  for (const entry of entries) {
    const debit = entry.type === LedgerEntryType.DEBIT ? Number(entry.amount) : 0;
    const credit = entry.type === LedgerEntryType.CREDIT ? Number(entry.amount) : 0;
    running = computeLedgerBalance(running, debit, credit);
  }

  await tx.ledger.update({ where: { id: ledgerId }, data: { balance: running } });
  return running;
}

/** Legacy names — no longer auto-created; cleaned up when empty/unused. */
export const CUSTOMERS_CATEGORY_NAME = 'Customers';
export const SUPPLIERS_CATEGORY_NAME = 'Suppliers';
export const INCOME_CATEGORY_NAME = 'Income';
export const INVENTORY_CATEGORY_NAME = 'Inventory';

export const SALE_REVENUE_ACCOUNT_NAME = 'Sale Revenue';
export const SERVICE_REVENUE_ACCOUNT_NAME = 'Service Revenue';
export const INVENTORY_ACCOUNT_NAME = 'Inventory';
export const CASH_IN_HAND_ACCOUNT_NAME = 'Cash in Hand';

/** Install-time categories only. Party/invoice categories are lazy-created elsewhere. */
export const DEFAULT_CATEGORY_NAMES = [
  'Assets',
  'Cash',
  'Bank',
  'Expenses',
  'Capital',
] as const;

/** Removed from auto-generation; safe-cleaned when unused. */
export const REMOVED_AUTO_CATEGORY_NAMES = [
  CUSTOMERS_CATEGORY_NAME,
  SUPPLIERS_CATEGORY_NAME,
  INVENTORY_CATEGORY_NAME,
  INCOME_CATEGORY_NAME,
] as const;

export function isCustomersCategoryName(name: string) {
  return name.trim().toLowerCase() === CUSTOMERS_CATEGORY_NAME.toLowerCase();
}

export function isSuppliersCategoryName(name: string) {
  return name.trim().toLowerCase() === SUPPLIERS_CATEGORY_NAME.toLowerCase();
}

export function isInventoryCategoryName(name: string) {
  return name.trim().toLowerCase() === INVENTORY_CATEGORY_NAME.toLowerCase();
}

export function isSystemAccountCategoryName(name: string) {
  return isMaalKhataCategoryName(name);
}

export async function listAccountCategories(pagination?: { limit: number; offset: number }) {
  await bootstrapChartOfAccounts();

  const limit = pagination?.limit ?? SELECTOR_MAX_PAGE_SIZE;
  const offset = pagination?.offset ?? 0;

  const [categories, customerCount, supplierCount, inventoryAccounts, total] = await Promise.all([
    prisma.accountCategory.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        isActive: true,
        createdAt: true,
        _count: { select: { accounts: { where: { isActive: true } } } },
      },
      orderBy: { name: 'asc' },
      take: limit,
      skip: offset,
    }),
    prisma.customer.count({ where: { isActive: true } }),
    prisma.supplier.count({ where: { isActive: true } }),
    prisma.account.count({
      where: { isActive: true, name: { equals: INVENTORY_ACCOUNT_NAME } },
    }),
    pagination ? prisma.accountCategory.count({ where: { isActive: true } }) : Promise.resolve(0),
  ]);

  const items = categories.map((category) => {
    const isCustomers = isCustomersCategoryName(category.name);
    const isSuppliers = isSuppliersCategoryName(category.name);
    const isInventory = isInventoryCategoryName(category.name);
    return {
      id: category.id,
      name: category.name,
      isActive: category.isActive,
      createdAt: category.createdAt,
      accounts: [],
      isCustomersCategory: isCustomers,
      isSuppliersCategory: isSuppliers,
      isInventoryCategory: isInventory,
      entryCount: isCustomers
        ? customerCount
        : isSuppliers
          ? supplierCount
          : isInventory
            ? inventoryAccounts
            : category._count.accounts,
    };
  });

  return {
    items,
    total: pagination ? total : items.length,
    limit,
    offset,
  };
}

export async function createAccountCategory(name: string) {
  const trimmedName = await assertUniqueCategoryName(name);
  return prisma.accountCategory.create({ data: { name: trimmedName } });
}

export async function softDeleteAccountCategory(id: number) {
  const category = await prisma.accountCategory.findFirst({
    where: { id, isActive: true },
    include: { accounts: { where: { isActive: true } } },
  });
  if (!category) throw new AppError(404, 'Category not found');

  if (isSystemAccountCategoryName(category.name)) {
    throw new AppError(400, `The ${category.name} category cannot be deleted`);
  }

  if (category.accounts.length > 0) {
    throw new AppError(
      400,
      `Category "${category.name}" has ${category.accounts.length} active account(s) and cannot be deleted`,
    );
  }

  return prisma.accountCategory.update({
    where: { id },
    data: { isActive: false },
  });
}

async function generateNextAccountCodeInTx(
  tx: Prisma.TransactionClient,
): Promise<string> {
  return generateNextAccountCode(tx);
}

async function resolveAccountType(
  categoryId: number,
  explicit?: AccountType,
): Promise<AccountType> {
  if (explicit) return explicit;

  const sibling = await prisma.account.findFirst({
    where: { categoryId, isActive: true },
    select: { type: true },
  });
  return sibling?.type ?? AccountType.ASSET;
}

export const OPENING_BALANCE_EQUITY_ACCOUNT_NAME = 'Opening Balance Equity';

async function findOrCreateOpeningBalanceEquityAccount(
  tx: Prisma.TransactionClient,
  ) {
  const existing = await tx.account.findFirst({
    where: { isActive: true,
      type: AccountType.EQUITY,
      name: { equals: OPENING_BALANCE_EQUITY_ACCOUNT_NAME },
    },
    include: { ledger: true },
  });
  if (existing?.ledger) {
    if (!existing.excludeFromSelectors) {
      await tx.account.update({
        where: { id: existing.id },
        data: { excludeFromSelectors: true },
      });
    }
    return existing;
  }

  let category = await tx.accountCategory.findFirst({
    where: { isActive: true,
      name: { equals: 'Capital' },
    },
  });
  if (!category) {
    category = await tx.accountCategory.create({
      data: { name: 'Capital' },
    });
  }

  const account = await tx.account.create({
    data: { categoryId: category.id,
      name: OPENING_BALANCE_EQUITY_ACCOUNT_NAME,
      code: await generateNextAccountCodeInTx(tx),
      type: AccountType.EQUITY,
      excludeFromSelectors: true,
    },
  });

  const ledger = await tx.ledger.create({
    data: { accountId: account.id, balance: 0 },
  });

  return tx.account.findUniqueOrThrow({
    where: { id: account.id },
    include: { ledger: true },
  });
}

async function postOpeningBalanceOffset(
  tx: Prisma.TransactionClient,
  accountName: string,
  amount: number,
  side: 'DR' | 'CR',
) {
  const equityAccount = await findOrCreateOpeningBalanceEquityAccount(tx);
  const equityLedger = equityAccount.ledger!;
  const offsetType = side === 'DR' ? LedgerEntryType.CREDIT : LedgerEntryType.DEBIT;
  const financialYearId = await getActiveFinancialYearId(tx);

  const entry = await tx.ledgerEntry.create({
    data: {
      ledgerId: equityLedger.id,
      type: offsetType,
      amount,
      balance: 0,
      notes: `Opening Balance — offset for ${accountName}`,
      isOpeningBalance: true,
      financialYearId,
    },
  });
  await applyPostedLedgerEntriesInTx(tx, equityLedger.id, financialYearId, [entry.id]);
}

/**
 * Balanced opening-balance pair (account/product ledger + Opening Balance Equity).
 * Used by account creation and valued product opening stock.
 */
export async function postOpeningBalanceInTx(
  tx: Prisma.TransactionClient,
  data: {
    ledgerId: number;
    accountName: string;
    amount: number;
    side: 'DR' | 'CR';
    notes?: string;
  },
) {
  const amount = Math.abs(Number(data.amount));
  if (!(amount > 0)) return;

  const financialYearId = await getActiveFinancialYearId(tx);
  const entry = await tx.ledgerEntry.create({
    data: {
      ledgerId: data.ledgerId,
      type: data.side === 'DR' ? LedgerEntryType.DEBIT : LedgerEntryType.CREDIT,
      amount,
      balance: 0,
      notes: data.notes ?? 'Opening Balance',
      isOpeningBalance: true,
      financialYearId,
    },
  });
  await postOpeningBalanceOffset(tx, data.accountName, amount, data.side);
  await applyPostedLedgerEntriesInTx(tx, data.ledgerId, financialYearId, [entry.id]);
}

/**
 * Balanced stock-adjustment pair (product Maal Khata + Opening Balance Equity).
 * Same DR product / CR equity pattern as opening stock, but dated and not flagged as opening balance.
 */
export async function postStockAdjustmentBalanceInTx(
  tx: Prisma.TransactionClient,
  data: {
    ledgerId: number;
    accountName: string;
    amount: number;
    side: 'DR' | 'CR';
    notes: string;
    financialYearId: number;
    entryDate: Date;
  },
) {
  const amount = Math.abs(Number(data.amount));
  if (!(amount > 0)) return;

  const equityAccount = await findOrCreateOpeningBalanceEquityAccount(tx);
  const equityLedger = equityAccount.ledger!;
  const offsetType = data.side === 'DR' ? LedgerEntryType.CREDIT : LedgerEntryType.DEBIT;

  const productEntry = await tx.ledgerEntry.create({
    data: {
      ledgerId: data.ledgerId,
      type: data.side === 'DR' ? LedgerEntryType.DEBIT : LedgerEntryType.CREDIT,
      amount,
      balance: 0,
      notes: data.notes,
      isOpeningBalance: false,
      financialYearId: data.financialYearId,
      createdAt: data.entryDate,
    },
  });

  const equityEntry = await tx.ledgerEntry.create({
    data: {
      ledgerId: equityLedger.id,
      type: offsetType,
      amount,
      balance: 0,
      notes: `Stock Adjustment — offset for ${data.accountName}`,
      isOpeningBalance: false,
      financialYearId: data.financialYearId,
      createdAt: data.entryDate,
    },
  });

  await applyPostedLedgerEntriesInTx(tx, data.ledgerId, data.financialYearId, [productEntry.id]);
  await applyPostedLedgerEntriesInTx(tx, equityLedger.id, data.financialYearId, [equityEntry.id]);
}

function parseAdjustmentDate(value: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new AppError(400, 'Invalid adjustment date');
  d.setHours(12, 0, 0, 0);
  return d;
}

export async function createAccountAdjustment(data: {
  adjustmentDate: string;
  accountId: number;
  amount: number;
  side: 'DR' | 'CR';
  createdById?: number;
  postImmediately?: boolean;
}) {
  const amount = Math.abs(Number(data.amount));
  if (!(amount > 0)) throw new AppError(400, 'Amount must be greater than zero');
  if (data.side !== 'DR' && data.side !== 'CR') {
    throw new AppError(400, 'Side must be DR or CR');
  }

  const adjustmentDate = parseAdjustmentDate(data.adjustmentDate);

  const account = await prisma.account.findFirst({
    where: { id: data.accountId, ...SELECTABLE_ACCOUNT },
    include: { category: true, ledger: true },
  });
  if (!account) throw new AppError(404, 'Account not found');
  if (!account.ledger) throw new AppError(400, 'Account ledger not found');
  if (isMaalKhataCategoryName(account.category?.name ?? '')) {
    throw new AppError(400, 'Product accounts must be adjusted using Stock Adjustment');
  }

  const postImmediately = data.postImmediately !== false;
  if (!postImmediately) {
    if (data.createdById == null) throw new AppError(400, 'createdById is required for pending adjustments');
    await prisma.$transaction(async (tx) => {
      await assertVoucherDateInActiveFinancialYear(tx, adjustmentDate, 'Invoice');
    });
    const pending = await prisma.pendingAdjustment.create({
      data: {
        kind: 'ACCOUNT',
        status: RecordStatus.PENDING_APPROVAL,
        adjustmentDate,
        createdById: data.createdById,
        accountId: account.id,
        amount,
        side: data.side,
      },
    });
    return {
      pendingApproval: true as const,
      id: pending.id,
      accountId: account.id,
      accountName: account.name,
      balance: Number(account.ledger.balance),
    };
  }

  return prisma.$transaction(async (tx) => {
    await assertVoucherDateInActiveFinancialYear(tx, adjustmentDate, 'Invoice');

    await postOpeningBalanceInTx(tx, {
      ledgerId: account.ledger!.id,
      accountName: account.name,
      amount,
      side: data.side,
      notes: 'Account Adjustment',
    });

    const ledger = await tx.ledger.findUnique({ where: { id: account.ledger!.id } });
    return {
      pendingApproval: false as const,
      accountId: account.id,
      accountName: account.name,
      balance: ledger ? Number(ledger.balance) : 0,
    };
  });
}

export async function approveAccountAdjustment(id: number, _approvedById: number) {
  return prisma.$transaction(async (tx) => {
    const pending = await tx.pendingAdjustment.findFirst({
      where: { id, kind: 'ACCOUNT', status: RecordStatus.PENDING_APPROVAL },
      include: { account: { include: { ledger: true } } },
    });
    if (!pending) throw new AppError(404, 'Pending account adjustment not found');
    if (!pending.account?.ledger) throw new AppError(400, 'Account ledger not found');
    if (pending.account.status !== RecordStatus.ACTIVE || !pending.account.isActive) {
      throw new AppError(400, 'Account is not active');
    }

    const amount = Math.abs(Number(pending.amount ?? 0));
    const side = pending.side === 'CR' ? 'CR' : 'DR';
    await assertVoucherDateInActiveFinancialYear(tx, pending.adjustmentDate, 'Invoice');
    await postOpeningBalanceInTx(tx, {
      ledgerId: pending.account.ledger.id,
      accountName: pending.account.name,
      amount,
      side,
      notes: 'Account Adjustment',
    });
    await tx.pendingAdjustment.update({
      where: { id: pending.id },
      data: { status: RecordStatus.ACTIVE },
    });
    const ledger = await tx.ledger.findUnique({ where: { id: pending.account.ledger.id } });
    return {
      accountId: pending.account.id,
      accountName: pending.account.name,
      balance: ledger ? Number(ledger.balance) : 0,
    };
  }, WRITE_TRANSACTION_OPTIONS);
}

export async function rejectAccountAdjustment(id: number) {
  const pending = await prisma.pendingAdjustment.findFirst({
    where: { id, kind: 'ACCOUNT', status: RecordStatus.PENDING_APPROVAL },
  });
  if (!pending) throw new AppError(404, 'Pending account adjustment not found');
  await prisma.pendingAdjustment.delete({ where: { id } });
  return { ok: true, id };
}

export async function createAccount(data: {
  categoryId: number;
  name: string;
  code?: string;
  type?: AccountType;
  openingBalance?: number;
  openingBalanceSide?: 'DR' | 'CR';
  createdById?: number;
  postImmediately?: boolean;
}) {
  const trimmedName = await assertUniqueAccountName(data.name);

  if (isInventoryAccountName(trimmedName)) {
    throw new AppError(
      400,
      'The name "Inventory" is reserved for legacy inventory accounts and cannot be reused',
    );
  }

  const category = await prisma.accountCategory.findFirst({
    where: { id: data.categoryId, isActive: true },
  });
  if (!category) throw new AppError(400, 'Invalid category');

  if (isCustomersCategoryName(category.name) || isSuppliersCategoryName(category.name)) {
    throw new AppError(
      400,
      'Legacy Customers/Suppliers categories are retired — use Sale Party or Purchase Party accounts',
    );
  }

  if (isMaalKhataCategoryName(category.name)) {
    throw new AppError(
      400,
      'Product ledgers are created automatically when you add a product',
    );
  }

  const type = await resolveAccountType(data.categoryId, data.type);
  const useAutoCode = !data.code?.trim();
  if (!useAutoCode) {
    await assertUniqueAccountCode(data.code!);
  }

  const amount = Math.abs(data.openingBalance ?? 0);
  // Dr or Cr is always allowed — openingBalanceSide overrides category default when provided.
  const side = data.openingBalanceSide ?? defaultOpeningSide(type);
  const signedBalance = amount === 0 ? 0 : side === 'DR' ? amount : -amount;
  const postImmediately = data.postImmediately !== false;
  if (!postImmediately && data.createdById == null) {
    throw new AppError(400, 'createdById is required for pending accounts');
  }

  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const trimmedCode = useAutoCode
          ? await generateNextAccountCode(tx)
          : normalizeLabel(data.code!);

    const account = await tx.account.create({
      data: {
        categoryId: data.categoryId,
        name: trimmedName,
        code: trimmedCode,
        type,
            status: postImmediately ? RecordStatus.ACTIVE : RecordStatus.PENDING_APPROVAL,
            createdById: data.createdById ?? null,
            pendingOpeningBalance: postImmediately || amount === 0 ? null : amount,
            pendingOpeningSide: postImmediately || amount === 0 ? null : side,
      },
    });

        if (!postImmediately) {
          return tx.account.findUniqueOrThrow({
            where: { id: account.id },
            include: { category: true, ledger: true },
          });
        }

    const ledger = await tx.ledger.create({
          data: { accountId: account.id, balance: 0 },
    });

    if (amount > 0 && trimmedName.toLowerCase() !== 'opening balance equity') {
          await postOpeningBalanceInTx(tx, {
          ledgerId: ledger.id,
            accountName: trimmedName,
          amount,
            side,
          notes: 'Opening Balance',
          });
        } else if (amount > 0) {
          await tx.ledger.update({ where: { id: ledger.id }, data: { balance: signedBalance } });
        }

        return tx.account.findUniqueOrThrow({
          where: { id: account.id },
          include: { category: true, ledger: true },
        });
      }, WRITE_TRANSACTION_OPTIONS);
    } catch (error) {
      if (useAutoCode && isAccountCodeConflict(error) && attempt < 5) continue;
      throw error;
    }
  }

  throw new AppError(500, 'Could not allocate a unique account code — try again');
}

export async function approveAccount(accountId: number, _approvedById: number) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const account = await tx.account.findFirst({
      where: { id: accountId, status: RecordStatus.PENDING_APPROVAL },
      include: { product: true, category: true, ledger: true },
    });
    if (!account) throw new AppError(404, 'Pending account not found');
    if (account.product) {
      throw new AppError(400, 'Approve the product to activate this account');
    }

    let ledger = account.ledger;
    if (!ledger) {
      ledger = await tx.ledger.create({ data: { accountId: account.id, balance: 0 } });
    }

    const amount = Math.abs(Number(account.pendingOpeningBalance ?? 0));
    const side = account.pendingOpeningSide === 'CR' ? 'CR' : 'DR';

    await tx.account.update({
      where: { id: account.id },
      data: {
        status: RecordStatus.ACTIVE,
        pendingOpeningBalance: null,
        pendingOpeningSide: null,
        },
      });

    if (amount > 0 && account.name.toLowerCase() !== 'opening balance equity') {
      await postOpeningBalanceInTx(tx, {
        ledgerId: ledger.id,
        accountName: account.name,
        amount,
        side,
        notes: 'Opening Balance',
      });
    } else if (amount > 0) {
      const signedBalance = side === 'DR' ? amount : -amount;
      await tx.ledger.update({ where: { id: ledger.id }, data: { balance: signedBalance } });
    }

    return tx.account.findUniqueOrThrow({
      where: { id: account.id },
      include: { category: true, ledger: true },
    });
  }, WRITE_TRANSACTION_OPTIONS);
}

export async function rejectAccount(accountId: number) {
  const account = await prisma.account.findFirst({
    where: { id: accountId, status: RecordStatus.PENDING_APPROVAL },
    include: { product: true },
  });
  if (!account) throw new AppError(404, 'Pending account not found');
  if (account.product) {
    throw new AppError(400, 'Reject the product to remove this account');
  }
  await prisma.account.delete({ where: { id: accountId } });
  return { ok: true, id: accountId };
}

function defaultOpeningSide(type: AccountType): 'DR' | 'CR' {
  return type === AccountType.ASSET || type === AccountType.EXPENSE ? 'DR' : 'CR';
}

function ledgerEntriesForYearWhere(
  ledgerId: number,
  financialYearId: number,
  yearStart: Date,
  yearEnd: Date | null,
): Prisma.LedgerEntryWhereInput {
  return {
    ledgerId,
    isReversal: false,
    OR: [
      {
        voucher: {
          financialYearId,
          status: VoucherStatus.ACTIVE,
        },
      },
      {
        isOpeningBalance: true,
        financialYearId,
      },
      {
        isOpeningBalance: true,
        financialYearId: null,
        createdAt: {
          gte: yearStart,
          ...(yearEnd ? { lte: yearEnd } : {}),
        },
      },
    ],
  };
}

async function loadFinancialYearBounds(db: DbClient, financialYearId: number) {
  const year = await db.financialYear.findFirst({
    where: { id: financialYearId },
    select: { startDate: true, endDate: true },
  });
  if (!year) throw new AppError(404, 'Financial year not found');
  return {
    yearStart: startOfDay(year.startDate),
    yearEnd: year.endDate ? endOfDay(year.endDate) : null,
  };
}

function normalizeLabel(value: string) {
  return value.trim();
}

async function assertUniqueCategoryName(name: string) {
  const trimmed = normalizeLabel(name);
  if (!trimmed) throw new AppError(400, 'Category name is required');

  const existing = await prisma.accountCategory.findFirst({
    where: { isActive: true, name: { equals: trimmed } },
  });
  if (existing) {
    throw new AppError(400, `Category "${existing.name}" already exists`);
  }
  return trimmed;
}

async function assertUniqueAccountName(name: string) {
  const trimmed = normalizeLabel(name);
  if (!trimmed) throw new AppError(400, 'Account name is required');

  const existing = await prisma.account.findFirst({
    where: { name: { equals: trimmed } },
  });
  if (existing) {
    throw new AppError(400, `Account "${existing.name}" already exists`);
  }
  return trimmed;
}

async function assertUniqueAccountCode(code: string) {
  const trimmed = normalizeLabel(code);
  if (!trimmed) throw new AppError(400, 'Account code is required');

  const existing = await prisma.account.findFirst({
    where: { code: { equals: trimmed } },
  });
  if (existing) {
    throw new AppError(400, `Account code "${existing.code}" already exists`);
  }
  return trimmed;
}

function isSaleRevenueAccountName(name?: string | null) {
  return name?.trim().toLowerCase() === SALE_REVENUE_ACCOUNT_NAME.toLowerCase();
}

function isInventoryAccountName(name?: string | null) {
  return name?.trim().toLowerCase() === INVENTORY_ACCOUNT_NAME.toLowerCase();
}

function isSaleVoucher(voucher: {
  type?: VoucherType | null;
  creditAccount?: { name: string } | null;
  debitAccount?: { name: string } | null;
} | null) {
  if (!voucher || voucher.type !== VoucherType.JOURNAL) return false;
  return isSaleRevenueAccountName(voucher.creditAccount?.name) && !!voucher.debitAccount?.name;
}

function isPurchaseVoucher(voucher: {
  type?: VoucherType | null;
  creditAccount?: { name: string } | null;
  debitAccount?: { name: string } | null;
} | null) {
  if (!voucher || voucher.type !== VoucherType.JOURNAL) return false;
  return (
    isInventoryAccountName(voucher.debitAccount?.name)
    && !!voucher.creditAccount?.name
    && !isSaleRevenueAccountName(voucher.creditAccount?.name)
  );
}

function voucherTypeLabel(
  voucher: {
    type?: VoucherType | null;
    creditAccount?: { name: string } | null;
    debitAccount?: { name: string } | null;
  } | null,
  isReversal: boolean,
) {
  if (isSaleVoucher(voucher)) {
    return isReversal ? 'Sale (Reversal)' : 'Sale';
  }
  if (isPurchaseVoucher(voucher)) {
    return isReversal ? 'Purchase (Reversal)' : 'Purchase';
  }
  const type = voucher?.type;
  if (!type) return isReversal ? 'Journal (Reversal)' : 'Journal';
  const base =
    type === 'PAYMENT' ? 'Payment'
      : type === 'RECEIPT' ? 'Receipt'
        : type === 'KACHI' ? 'Kachi'
          : type === 'SALE_INVOICE' ? 'Sale Invoice'
            : type === 'PURCHASE_INVOICE' ? 'Purchase Invoice'
              : 'Journal';
  return isReversal ? `${base} (Reversal)` : base;
}

function voucherDisplayNo(type: VoucherType | null | undefined, number: number | null | undefined) {
  return formatVoucherLabel(type, number);
}

/** Voucher label — number only; type is shown in its own column. */
export function formatVoucherLabel(
  _type: VoucherType | null | undefined,
  number: number | null | undefined,
): string {
  if (!number) return '0';
  return String(number);
}

export function formatPurchaseItemsDescription(
  items: { quantity: number; product?: { name: string } | null; part?: { name: string } | null }[],
): string {
  if (!items.length) return '';
  return items
    .map((item) => {
      const name = item.product?.name ?? item.part?.name ?? 'Item';
      return `${name} × ${item.quantity}`;
    })
    .join(', ');
}

async function loadPurchaseDescriptionsByRef(_refs: string[]) {
  return new Map<string, string>();
}

async function loadSaleDescriptionsByRef(_refs: string[]) {
  return new Map<string, string>();
}

function buildLedgerEntryDescription(
  e: { isOpeningBalance: boolean; notes?: string | null },
  voucher: {
    type?: VoucherType | null;
    description?: string | null;
    creditAccount?: { name: string } | null;
    debitAccount?: { name: string } | null;
  } | null,
  purchaseSummary?: string,
  saleSummary?: string,
): string {
  if (e.isOpeningBalance) return 'Opening Balance';
  if (isBardanaLedgerNote(e.notes)) return e.notes!.trim();
  if (!voucher?.creditAccount || !voucher?.debitAccount) {
    return e.notes?.trim() || voucher?.description?.trim() || '';
  }

  if (isSaleVoucher(voucher)) {
    const base = `From sale revenue to ${voucher.debitAccount.name}`;
    return saleSummary ? `${base} — ${saleSummary}` : base;
  }

  if (isPurchaseVoucher(voucher)) {
    const base = `From ${voucher.creditAccount.name} to inventory`;
    return purchaseSummary ? `${base} — ${purchaseSummary}` : base;
  }

  const auto = `From ${voucher.creditAccount.name} to ${voucher.debitAccount.name}`;
  const custom = voucher.description?.trim();
  return custom ? `${auto} — ${custom}` : auto;
}

/** Payment, Receipt, and Journal each have their own number sequence per financial year. */
const STANDARD_VOUCHER_TYPES: VoucherType[] = ['PAYMENT', 'RECEIPT', 'JOURNAL'];

function isStandardVoucherType(type: VoucherType): type is 'PAYMENT' | 'RECEIPT' | 'JOURNAL' {
  return (STANDARD_VOUCHER_TYPES as string[]).includes(type);
}

async function nextVoucherNumber(
  tx: Prisma.TransactionClient,
  financialYearId: number,
  type: VoucherType,
): Promise<number> {
  const { _max } = await tx.voucher.aggregate({
    where: { financialYearId, type },
    _max: { number: true },
  });
  return (_max.number ?? 0) + 1;
}

async function nextMultiLegVoucherNumber(
  tx: Prisma.TransactionClient,
  financialYearId: number,
  type: Extract<VoucherType, 'KACHI' | 'SALE_INVOICE' | 'PURCHASE_INVOICE'>,
): Promise<number> {
  return nextVoucherNumber(tx, financialYearId, type);
}

/** Read-only preview of the next voucher number for a type in the active financial year. */
export async function previewNextVoucherNumber(
  type: VoucherType = 'PAYMENT',
): Promise<{
  number: number;
  financialYearId: number;
  type: VoucherType;
}> {
  if (!isStandardVoucherType(type)) {
    throw new AppError(400, 'Invalid voucher type for number preview');
  }
  const financialYearId = await getActiveFinancialYearId(prisma);
  const number = await nextVoucherNumber(prisma, financialYearId, type);
  return { number, financialYearId, type };
}

function parseDateStart(value: string) {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseDateEnd(value: string) {
  const d = new Date(value);
  d.setHours(23, 59, 59, 999);
  return d;
}

function entryDebitCredit(type: LedgerEntryType, amount: number) {
  if (type === LedgerEntryType.DEBIT) return { debit: amount, credit: 0 };
  return { debit: 0, credit: amount };
}

/** Reversal rows and cancelled/pending vouchers are bookkeeping only — omit from reports. */
function isReportableLedgerEntry(e: {
  isReversal: boolean;
  voucher: { status: VoucherStatus } | null;
}) {
  if (e.isReversal) return false;
  if (e.voucher?.status === VoucherStatus.CANCELLED) return false;
  if (e.voucher?.status === VoucherStatus.PENDING_APPROVAL) return false;
  return true;
}

function reportBalanceFromEntries(
  entries: { type: LedgerEntryType; amount: number | Prisma.Decimal; isReversal: boolean; voucher: { status: VoucherStatus } | null }[],
) {
  return entries
    .filter(isReportableLedgerEntry)
    .reduce((sum, e) => {
      const { debit, credit } = entryDebitCredit(e.type, Number(e.amount));
      return sum + debit - credit;
    }, 0);
}

export async function runAccountingMaintenance() {
  await prisma.$transaction(async (tx) => {
    await consolidateDuplicateInventoryAccounts(tx);
    await syncCustomerSupplierAccountsInTx(tx);
  });
}

export async function listAccounts(
  options?: {
    includeLedger?: boolean;
    forSelectors?: boolean;
    search?: string;
    categoryId?: number;
  },
  pagination?: { limit: number; offset: number },
): Promise<PaginatedResult<Awaited<ReturnType<typeof mapListedAccount>>>> {
  const includeLedger = options?.includeLedger !== false;
  const forSelectors = options?.forSelectors !== false;
  const limit = pagination?.limit ?? SELECTOR_MAX_PAGE_SIZE;
  const offset = pagination?.offset ?? 0;
  const where: Prisma.AccountWhereInput = {
    ...SELECTABLE_ACCOUNT,
    ...(forSelectors ? { excludeFromSelectors: false } : {}),
  };

  if (options?.categoryId != null) {
    where.categoryId = options.categoryId;
  }

  const search = options?.search?.trim();
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { code: { contains: search } },
      { category: { is: { name: { contains: search } } } },
    ];
  }

  const [accounts, total] = await Promise.all([
    prisma.account.findMany({
      where,
      select: {
        id: true,
        categoryId: true,
        name: true,
        code: true,
        type: true,
        isActive: true,
        createdAt: true,
        category: { select: { id: true, name: true, isActive: true, createdAt: true } },
        ...(includeLedger
          ? { ledger: { select: { id: true, accountId: true, balance: true, updatedAt: true } } }
          : {}),
      },
    orderBy: { code: 'asc' },
      take: limit,
      skip: offset,
    }),
    prisma.account.count({ where }),
  ]);

  return {
    items: accounts.map(mapListedAccount),
    total,
    limit,
    offset,
  };
}

function mapListedAccount({
  ledger,
  ...account
}: {
  id: number;
  categoryId: number;
  name: string;
  code: string;
  type: AccountType;
  isActive: boolean;
  createdAt: Date;
  category: { id: number; name: string; isActive: boolean; createdAt: Date };
  ledger?: { id: number; accountId: number; balance: unknown; updatedAt: Date } | null;
}) {
  return {
    ...account,
    ledger: ledger ? { ...ledger, balance: Number(ledger.balance) } : null,
  };
}

export async function ensureSaleRevenueAccount(tx: Prisma.TransactionClient) {
  const category = await tx.accountCategory.findFirst({
    where: { isActive: true, name: { equals: INCOME_CATEGORY_NAME } },
  });
  if (!category) return null;

  const existing = await tx.account.findFirst({
    where: {
      isActive: true,
      categoryId: category.id,
      name: { equals: SALE_REVENUE_ACCOUNT_NAME },
    },
    include: { ledger: true },
  });
  return existing?.ledger ? existing : null;
}

export async function ensureServiceRevenueAccount(tx: Prisma.TransactionClient) {
  const category = await tx.accountCategory.findFirst({
    where: { isActive: true, name: { equals: INCOME_CATEGORY_NAME } },
  });
  if (!category) return null;

  const existing = await tx.account.findFirst({
    where: {
      isActive: true,
      categoryId: category.id,
      name: { equals: SERVICE_REVENUE_ACCOUNT_NAME },
    },
    include: { ledger: true },
  });
  return existing?.ledger ? existing : null;
}

export async function ensureCustomerAccount(
  tx: Prisma.TransactionClient,
  customer: { id: number; name: string },
) {
  const category = await ensureCategoryInTx(tx, 'Sale Party');
  const code = `C${String(customer.id).padStart(4, '0')}`;

  const existing = await tx.account.findFirst({
    where: { isActive: true, code },
    include: { ledger: true },
  });
  if (existing) {
    if (!existing.ledger) {
      await tx.ledger.create({ data: { accountId: existing.id, balance: 0 } });
    }
    const updates: Prisma.AccountUpdateInput = {};
    if (existing.name !== customer.name) updates.name = customer.name;
    if (existing.categoryId !== category.id) {
      updates.category = { connect: { id: category.id } };
      updates.type = AccountType.ASSET;
    }
    if (Object.keys(updates).length > 0) {
      await tx.account.update({ where: { id: existing.id }, data: updates });
    }
    return tx.account.findUniqueOrThrow({ where: { id: existing.id }, include: { ledger: true } });
  }

  const account = await tx.account.create({
    data: {
      categoryId: category.id,
      name: customer.name,
      code,
      type: AccountType.ASSET,
    },
  });
  await tx.ledger.create({ data: { accountId: account.id, balance: 0 } });
  return tx.account.findUniqueOrThrow({ where: { id: account.id }, include: { ledger: true } });
}

export async function ensureSupplierAccount(
  tx: Prisma.TransactionClient,
  supplier: { id: number; name: string },
) {
  const category = await ensureCategoryInTx(tx, KACHI_MAAL_CATEGORY_NAMES.PURCHASE_PARTY);
  const code = `S${String(supplier.id).padStart(4, '0')}`;

  const existing = await tx.account.findFirst({
    where: { isActive: true, code },
    include: { ledger: true },
  });
  if (existing) {
    if (!existing.ledger) {
      await tx.ledger.create({ data: { accountId: existing.id, balance: 0 } });
    }
    const updates: Prisma.AccountUpdateInput = {};
    if (existing.name !== supplier.name) updates.name = supplier.name;
    if (existing.categoryId !== category.id) {
      updates.category = { connect: { id: category.id } };
      updates.type = AccountType.LIABILITY;
    }
    if (Object.keys(updates).length > 0) {
      await tx.account.update({ where: { id: existing.id }, data: updates });
    }
    return tx.account.findUniqueOrThrow({ where: { id: existing.id }, include: { ledger: true } });
  }

  const account = await tx.account.create({
    data: {
      categoryId: category.id,
      name: supplier.name,
      code,
      type: AccountType.LIABILITY,
    },
  });
  await tx.ledger.create({ data: { accountId: account.id, balance: 0 } });
  return tx.account.findUniqueOrThrow({ where: { id: account.id }, include: { ledger: true } });
}

export const KACHI_MAAL_CATEGORY_NAMES = {
  PURCHASE_PARTY: 'Purchase Party',
  INT_PURCHASE: 'Purchase Party',
  EXT_PURCHASE: 'Purchase Party',
  SALE_PARTY: 'Sale Party',
  REVENUE: 'Revenue',
  SALE_FEE: 'Sale Fee',
} as const;

/** Ledger categories accepted as invoice party accounts (includes legacy purchase party names). */
export const PARTY_ACCOUNT_CATEGORY_NAMES = [
  KACHI_MAAL_CATEGORY_NAMES.SALE_PARTY,
  KACHI_MAAL_CATEGORY_NAMES.PURCHASE_PARTY,
  'Int. Purchase Party',
  'Ext. Purchase Party',
] as const;

const PARTY_ACCOUNT_CATEGORY_SET = new Set<string>(PARTY_ACCOUNT_CATEGORY_NAMES);

export async function assertPartyAccount(
  tx: Prisma.TransactionClient,
  accountId: number,
  label = 'Party',
) {
  const account = await tx.account.findFirst({
    where: { id: accountId, isActive: true },
    include: { category: true },
  });
  if (!account) throw new AppError(400, `${label} account not found`);
  if (!PARTY_ACCOUNT_CATEGORY_SET.has(account.category.name)) {
    throw new AppError(400, `${label} must be a Sale Party or Purchase Party account`);
  }
  return account;
}

export type KachiMaalSystemAccounts = {
  commission: { id: number; name: string };
  mazduri: { id: number; name: string };
  broker: { id: number; name: string };
  marketFee: { id: number; name: string };
  misc: { id: number; name: string };
};

/** One-time auto-creation of Kachi Maal fee categories and accounts. */
export async function ensureKachiMaalAccounts(
  tx: Prisma.TransactionClient,
): Promise<KachiMaalSystemAccounts> {
  const purchaseTarget = await ensureCategoryInTx(tx, KACHI_MAAL_CATEGORY_NAMES.PURCHASE_PARTY);
  await ensureCategoryInTx(tx, KACHI_MAAL_CATEGORY_NAMES.SALE_PARTY);
  const revenue = await ensureCategoryInTx(tx, KACHI_MAAL_CATEGORY_NAMES.REVENUE);
  const saleFee = await ensureCategoryInTx(tx, KACHI_MAAL_CATEGORY_NAMES.SALE_FEE);

  // Migrate any legacy "Ext. Purchase Party" or "Int. Purchase Party" categories into "Purchase Party"
  const legacyCatNames = ['Ext. Purchase Party', 'Int. Purchase Party'];
  for (const legacyName of legacyCatNames) {
    const oldCats = await tx.accountCategory.findMany({
      where: { name: legacyName },
    });
    for (const oldCat of oldCats) {
      if (oldCat.id !== purchaseTarget.id) {
        await tx.account.updateMany({
          where: { categoryId: oldCat.id },
          data: { categoryId: purchaseTarget.id },
        });
        await tx.accountCategory.update({
          where: { id: oldCat.id },
          data: { isActive: false },
        });
      }
    }
  }

  const commission = await ensureDefaultAccountInTx(tx, revenue.id, 'Commission', AccountType.REVENUE, 'REV-COMM');
  const mazduri = await ensureDefaultAccountInTx(tx, saleFee.id, 'Mazduri', AccountType.EXPENSE, 'SF-MAZ');
  const broker = await ensureDefaultAccountInTx(tx, saleFee.id, 'Broker', AccountType.EXPENSE, 'SF-BRK');
  const marketFee = await ensureDefaultAccountInTx(tx, saleFee.id, 'Market Fee', AccountType.EXPENSE, 'SF-MKT');
  const misc = await ensureDefaultAccountInTx(tx, saleFee.id, 'Misc', AccountType.EXPENSE, 'SF-MISC');

  return {
    commission: { id: commission.id, name: commission.name },
    mazduri: { id: mazduri.id, name: mazduri.name },
    broker: { id: broker.id, name: broker.name },
    marketFee: { id: marketFee.id, name: marketFee.name },
    misc: { id: misc.id, name: misc.name },
  };
}

export const PURCHASE_MAZDURI_ACCOUNT_NAME = 'Purchase Mazduri';

/** System fee account credited for Purchase Invoice Mazduri (under Sale Fee category). */
export async function ensurePurchaseMazduriAccount(
  tx: Prisma.TransactionClient,
): Promise<{ id: number; name: string }> {
  const saleFee = await ensureCategoryInTx(tx, KACHI_MAAL_CATEGORY_NAMES.SALE_FEE);
  const account = await ensureDefaultAccountInTx(
    tx,
    saleFee.id,
    PURCHASE_MAZDURI_ACCOUNT_NAME,
    AccountType.EXPENSE,
    'SF-PMAZ',
  );
  return { id: account.id, name: account.name };
}

async function syncCustomerSupplierAccountsInTx(tx: Prisma.TransactionClient) {
  const customers = await tx.customer.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
  });
  const suppliers = await tx.supplier.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
  });

  for (const customer of customers) {
    await ensureCustomerAccount(tx, customer);
  }
  for (const supplier of suppliers) {
    await ensureSupplierAccount(tx, supplier);
  }
}

export async function syncCustomerSupplierAccounts() {
  await prisma.$transaction(async (tx) => {
    await syncCustomerSupplierAccountsInTx(tx);
  });
}

/**
 * Find existing Inventory account if present. Does not create Inventory category/account.
 */
export async function ensureInventoryAccount(tx: Prisma.TransactionClient) {
  const category = await tx.accountCategory.findFirst({
    where: { isActive: true, name: { equals: INVENTORY_CATEGORY_NAME } },
  });

  const allNamed = await tx.account.findMany({
    where: { isActive: true, name: { equals: INVENTORY_ACCOUNT_NAME } },
    include: { ledger: true },
    orderBy: { id: 'asc' },
  });

  if (allNamed.length === 0) return null;

  let canonical =
    (category
      ? allNamed.find((a) => a.categoryId === category.id && a.ledger) ??
        allNamed.find((a) => a.categoryId === category.id)
      : null) ??
    allNamed.find((a) => a.ledger) ??
    allNamed[0] ??
    null;

  if (!canonical) return null;

  if (category && canonical.categoryId !== category.id) {
    canonical = await tx.account.update({
      where: { id: canonical.id },
      data: { categoryId: category.id, type: AccountType.ASSET },
      include: { ledger: true },
    });
  }

  if (!canonical.ledger) {
    await tx.ledger.create({ data: { accountId: canonical.id, balance: 0 } });
    canonical = await tx.account.findUniqueOrThrow({
      where: { id: canonical.id },
      include: { ledger: true },
    });
  }

  return canonical;
}

async function mergeInventoryAccountIntoCanonical(
  tx: Prisma.TransactionClient,
  canonical: { id: number; ledger: { id: number } | null },
  duplicate: { id: number; ledger: { id: number; balance: unknown } | null },
) {
  if (duplicate.id === canonical.id) return;

  if (duplicate.ledger) {
    await tx.ledgerEntry.updateMany({
      where: { ledgerId: duplicate.ledger.id },
      data: { ledgerId: canonical.ledger!.id },
    });

    await tx.voucher.updateMany({
      where: { debitAccountId: duplicate.id },
      data: { debitAccountId: canonical.id },
    });
    await tx.voucher.updateMany({
      where: { creditAccountId: duplicate.id },
      data: { creditAccountId: canonical.id },
    });

    const entries = await tx.ledgerEntry.findMany({
      where: { ledgerId: canonical.ledger!.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    let balance = 0;
    // Sequential: each entry balance is a cumulative running total after ledger merge.
    for (const entry of entries) {
      balance +=
        entry.type === LedgerEntryType.DEBIT ? Number(entry.amount) : -Number(entry.amount);
      await tx.ledgerEntry.update({ where: { id: entry.id }, data: { balance } });
    }

    await tx.ledger.update({
      where: { id: canonical.ledger!.id },
      data: { balance },
    });

    await tx.ledger.update({
      where: { id: duplicate.ledger.id },
      data: { balance: 0 },
    });
  }

  await tx.account.update({
    where: { id: duplicate.id },
    data: { isActive: false },
  });
}

/** Merge duplicate Inventory accounts when they already exist — never creates Inventory. */
export async function consolidateDuplicateInventoryAccounts(
  tx: Prisma.TransactionClient,
) {
  const canonical = await ensureInventoryAccount(tx);
  if (!canonical) return null;

  const duplicates = await tx.account.findMany({
    where: {
      isActive: true,
      id: { not: canonical.id },
      name: { equals: INVENTORY_ACCOUNT_NAME },
    },
    include: { ledger: true },
  });

  for (const dup of duplicates) {
    await mergeInventoryAccountIntoCanonical(tx, canonical, dup);
  }

  return canonical;
}

async function ensureCategoryInTx(tx: Prisma.TransactionClient, name: string) {
  if (name === 'Ext. Purchase Party' || name === 'Int. Purchase Party') {
    name = KACHI_MAAL_CATEGORY_NAMES.PURCHASE_PARTY;
  }
  const existing = await tx.accountCategory.findFirst({
    where: { isActive: true, name: { equals: name } },
  });
  if (existing) return existing;
  return tx.accountCategory.create({ data: { name } });
}

async function ensureDefaultAccountInTx(
  tx: Prisma.TransactionClient,
  categoryId: number,
  accountName: string,
  type: AccountType,
  preferredCode?: string,
) {
  const existing = await tx.account.findFirst({
    where: { isActive: true,
      name: { equals: accountName },
    },
    include: { ledger: true },
  });

  if (existing) {
    if (!existing.ledger) {
      await tx.ledger.create({ data: { accountId: existing.id, balance: 0 } });
    }
    if (existing.categoryId !== categoryId) {
      await tx.account.update({
        where: { id: existing.id },
        data: { categoryId, type },
      });
    }
    return existing;
  }

  let code = preferredCode;
  if (code) {
    const codeTaken = await tx.account.findFirst({ where: { code } });
    if (codeTaken) code = undefined;
  }
  if (!code) code = await generateNextAccountCodeInTx(tx);

  const account = await tx.account.create({
    data: { categoryId, name: accountName, code, type },
  });
  await tx.ledger.create({ data: { accountId: account.id, balance: 0 } });
  return account;
}

async function accountHasLinkedUsage(
  tx: Prisma.TransactionClient,
  accountId: number,
  ledgerId: number | null | undefined,
) {
  if (ledgerId) {
    const entry = await tx.ledgerEntry.findFirst({
      where: { ledgerId },
      select: { id: true },
    });
    if (entry) return true;
  }

  const voucher = await tx.voucher.findFirst({
    where: {
      OR: [{ debitAccountId: accountId }, { creditAccountId: accountId }],
    },
    select: { id: true },
  });
  return Boolean(voucher);
}

/**
 * Soft-remove retired auto categories (Customers, Suppliers, Inventory, Income).
 * Customers/Suppliers accounts are moved to Sale Party / Ext. Purchase Party.
 * Inventory/Income are removed only when unused; otherwise flagged for manual review.
 */
async function cleanupRemovedAutoCategories(tx: Prisma.TransactionClient) {
  const partyTargets: Record<string, { category: string; type: AccountType }> = {
    [CUSTOMERS_CATEGORY_NAME]: { category: 'Sale Party', type: AccountType.ASSET },
    [SUPPLIERS_CATEGORY_NAME]: { category: 'Ext. Purchase Party', type: AccountType.LIABILITY },
  };

  for (const name of REMOVED_AUTO_CATEGORY_NAMES) {
    const categories = await tx.accountCategory.findMany({
      where: { isActive: true, name: { equals: name } },
      include: {
        accounts: {
          where: { isActive: true },
          include: { ledger: true },
        },
      },
      orderBy: { id: 'asc' },
    });

    for (const category of categories) {
      const partyTarget = partyTargets[name];

      if (partyTarget) {
        const target = await ensureCategoryInTx(tx, partyTarget.category);
        const toMigrate = category.accounts.filter((account) => account.categoryId !== target.id);
        if (toMigrate.length > 0) {
          // Independent rows — same target category/type for all accounts in this batch.
          await tx.account.updateMany({
            where: { id: { in: toMigrate.map((account) => account.id) } },
              data: { categoryId: target.id, type: partyTarget.type },
            });
        }
        await tx.accountCategory.update({
          where: { id: category.id },
          data: { isActive: false },
        });
        logger.info(`Migrated "${name}" accounts to "${partyTarget.category}" and removed category`, {
          categoryId: category.id,
          accountCount: category.accounts.length,
        });
        continue;
      }

      const usedAccountNames: string[] = [];
      const unusedAccounts = [];

      for (const account of category.accounts) {
        // Sequential: usage check is per account (ledger/voucher links differ per row).
        const used = await accountHasLinkedUsage(tx, account.id, account.ledger?.id);
        if (used) usedAccountNames.push(account.name);
        else unusedAccounts.push(account);
      }

      if (usedAccountNames.length > 0) {
        logger.warn(
          `Skipping removal of category "${name}" — has linked ledger entries or vouchers (manual review needed)`,
          { categoryId: category.id, accounts: usedAccountNames },
        );
        continue;
      }

      if (unusedAccounts.length > 0) {
        // Independent deactivations — batch by id list.
        await tx.account.updateMany({
          where: { id: { in: unusedAccounts.map((account) => account.id) } },
          data: { isActive: false },
        });
      }

      await tx.accountCategory.update({
        where: { id: category.id },
        data: { isActive: false },
      });
      logger.info(`Removed unused auto-generated category "${name}"`, {
        categoryId: category.id,
        deactivatedAccounts: unusedAccounts.length,
      });
    }
  }
}

async function consolidateDuplicateInventoryCategories(tx: Prisma.TransactionClient) {
  const categories = await tx.accountCategory.findMany({
    where: { isActive: true,
      name: { equals: INVENTORY_CATEGORY_NAME },
    },
    include: { accounts: { where: { isActive: true } } },
    orderBy: { id: 'asc' },
  });

  if (categories.length <= 1) return categories[0] ?? null;

  const [canonical, ...duplicates] = categories;
  for (const dup of duplicates) {
    for (const account of dup.accounts) {
      await tx.account.update({
        where: { id: account.id },
        data: { categoryId: canonical.id, type: AccountType.ASSET },
      });
    }
    await tx.accountCategory.update({ where: { id: dup.id }, data: { isActive: false } });
  }
  return canonical;
}

/** Recompute every live ledger balance from all entries (fixes FY-scoped recompute drift). */
export async function repairAllLiveLedgerBalances(): Promise<void> {
  const ledgers = await prisma.ledger.findMany({ select: { id: true } });
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    for (const { id } of ledgers) {
      await recomputeFullLedgerBalanceInTx(tx, id);
    }
  }, WRITE_TRANSACTION_OPTIONS);
}

/** Create default chart-of-accounts categories and core accounts for a branch. Idempotent. */
export async function bootstrapChartOfAccounts() {
  await prisma.$transaction(async (tx) => {
    await getActiveFinancialYearId(tx);
    for (const name of DEFAULT_CATEGORY_NAMES) {
      await ensureCategoryInTx(tx, name);
    }

    const cashCategory = await ensureCategoryInTx(tx, 'Cash');
    await ensureDefaultAccountInTx(
      tx,
      cashCategory.id,
      CASH_IN_HAND_ACCOUNT_NAME,
      AccountType.ASSET,
      '1',
    );

    // Party / Kachi Maal categories and system fee accounts used across the app.
    await ensureKachiMaalAccounts(tx);

    // Only consolidate Inventory if it already exists — never create it.
    await consolidateDuplicateInventoryCategories(tx);
    await consolidateDuplicateInventoryAccounts(tx);

    await cleanupRemovedAutoCategories(tx);
  }, WRITE_TRANSACTION_OPTIONS);
}

export async function createVoucherInTx(
  tx: Prisma.TransactionClient,
  data: {
    type: VoucherType;
    debitAccountId: number;
    creditAccountId: number;
    amount: number;
    date: Date | string;
    description?: string;
    reference: string;
    createdById: number;
    postImmediately?: boolean;
  },
) {
  const postImmediately = data.postImmediately !== false;
  const trimmedReference = data.reference.trim();
  let voucherDate: Date;
  try {
    voucherDate = parseVoucherDateInput(data.date);
  } catch {
    throw new AppError(400, 'Invalid voucher date');
  }
  const { financialYearId } = await validateVoucherCreate(tx, {
    type: data.type,
    debitAccountId: data.debitAccountId,
    creditAccountId: data.creditAccountId,
    amount: data.amount,
    date: voucherDate,
    description: data.description,
    reference: trimmedReference,
  });

  const number = await nextVoucherNumber(tx, financialYearId, data.type);

  const voucher = await tx.voucher.create({
    data: {
      type: data.type,
      number,
      date: voucherDate,
      debitAccountId: data.debitAccountId,
      creditAccountId: data.creditAccountId,
      amount: data.amount,
      description: data.description,
      reference: trimmedReference,
      createdById: data.createdById,
      financialYearId,
      status: postImmediately ? VoucherStatus.ACTIVE : VoucherStatus.PENDING_APPROVAL,
    },
  });

  if (postImmediately) {
    await postVoucherLedgerEntries(
      tx,
      voucher.id,
      data.debitAccountId,
      data.creditAccountId,
      data.amount,
      data.description,
      financialYearId,
    );

    await assertTrialBalanceInDev(tx);
  }

  return voucher;
}

export async function createVoucher(data: {
  type: VoucherType;
  debitAccountId: number;
  creditAccountId: number;
  amount: number;
  date: Date | string;
  description?: string;
  reference: string;
  createdById: number;
  postImmediately?: boolean;
}) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const voucher = await createVoucherInTx(tx, data);
    return tx.voucher.findUniqueOrThrow({ where: { id: voucher.id }, include: voucherInclude });
  }, WRITE_TRANSACTION_OPTIONS);
}

export async function createVouchersBatch(data: {
  vouchers: Array<{
    type: VoucherType;
    debitAccountId: number;
    creditAccountId: number;
    amount: number;
    date: Date | string;
    description?: string;
    reference: string;
  }>;
  createdById: number;
  postImmediately?: boolean;
}) {
  if (!Array.isArray(data.vouchers) || data.vouchers.length === 0) {
    throw new AppError(400, 'At least one voucher is required');
  }

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const createdList = [];
    for (const vData of data.vouchers) {
      const createdVoucher = await createVoucherInTx(tx, {
        ...vData,
        createdById: data.createdById,
        postImmediately: data.postImmediately,
      });
      const fullVoucher = await tx.voucher.findUniqueOrThrow({
        where: { id: createdVoucher.id },
        include: voucherInclude,
      });
      createdList.push(fullVoucher);
    }
    return createdList;
  }, WRITE_TRANSACTION_OPTIONS);
}

export async function approveVoucher(voucherId: number, approvedById: number) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const voucher = await tx.voucher.findFirst({
      where: { id: voucherId, status: VoucherStatus.PENDING_APPROVAL },
    });
    if (!voucher) throw new AppError(404, 'Pending voucher not found');
    if (voucher.debitAccountId == null || voucher.creditAccountId == null) {
      throw new AppError(400, 'Voucher accounts missing');
    }
    await assertActiveFinancialYear(tx, voucher.financialYearId);

    // Mark ACTIVE before posting so ledger recompute includes the new entries.
    await tx.voucher.update({
      where: { id: voucher.id },
      data: {
        status: VoucherStatus.ACTIVE,
        modifiedById: approvedById,
      },
    });

    const finYearId = voucher.financialYearId ?? (await getActiveFinancialYearId(tx));
    const existingEntries = await tx.ledgerEntry.count({ where: { voucherId: voucher.id } });
    if (existingEntries === 0) {
      await postVoucherLedgerEntries(
        tx,
        voucher.id,
        voucher.debitAccountId,
        voucher.creditAccountId,
        Number(voucher.amount),
        voucher.description,
        finYearId,
      );
    } else {
      await assertVoucherEntriesBalanced(tx, voucher.id, 2);
      const debitLedger = await tx.ledger.findUniqueOrThrow({
        where: { accountId: voucher.debitAccountId },
      });
      const creditLedger = await tx.ledger.findUniqueOrThrow({
        where: { accountId: voucher.creditAccountId },
      });
      await recomputeLedgerRunningBalancesInTx(tx, debitLedger.id, finYearId);
      await recomputeLedgerRunningBalancesInTx(tx, creditLedger.id, finYearId);
    }

    await assertTrialBalanceInDev(tx);
    return tx.voucher.findUniqueOrThrow({ where: { id: voucher.id }, include: voucherInclude });
  }, WRITE_TRANSACTION_OPTIONS);
}

async function assertVoucherEntriesBalanced(
  tx: Prisma.TransactionClient,
  voucherId: number,
  expectedLegCount?: number,
) {
  const entries = await tx.ledgerEntry.findMany({
    where: { voucherId, isReversal: false },
    select: { type: true, amount: true },
  });
  if (expectedLegCount != null && entries.length !== expectedLegCount) {
    throw new AppError(500, 'Voucher ledger entries are incomplete — posting aborted');
  }
  let totalDebit = 0;
  let totalCredit = 0;
  for (const entry of entries) {
    const amount = Number(entry.amount);
    if (entry.type === LedgerEntryType.DEBIT) totalDebit += amount;
    else totalCredit += amount;
  }
  if (!isTrialBalanceBalanced(totalDebit, totalCredit)) {
    throw new AppError(500, 'Voucher ledger entries are out of balance — posting aborted');
  }
}

async function postVoucherLedgerEntries(
  tx: Prisma.TransactionClient,
  voucherId: number,
  debitAccountId: number,
  creditAccountId: number,
  amount: number,
  notes: string | null | undefined,
  financialYearId: number,
) {
  const debitLedger = await tx.ledger.findUniqueOrThrow({ where: { accountId: debitAccountId } });
  const creditLedger = await tx.ledger.findUniqueOrThrow({ where: { accountId: creditAccountId } });

  const debitEntry = await tx.ledgerEntry.create({
    data: {
        ledgerId: debitLedger.id,
        voucherId,
      financialYearId,
        type: LedgerEntryType.DEBIT,
        amount,
        balance: 0,
        notes: notes ?? undefined,
        isReversal: false,
      },
  });
  const creditEntry = await tx.ledgerEntry.create({
    data: {
        ledgerId: creditLedger.id,
        voucherId,
      financialYearId,
        type: LedgerEntryType.CREDIT,
        amount,
        balance: 0,
        notes: notes ?? undefined,
        isReversal: false,
      },
  });

  await applyPostedLedgerEntriesInTx(tx, debitLedger.id, financialYearId, [debitEntry.id]);
  await applyPostedLedgerEntriesInTx(tx, creditLedger.id, financialYearId, [creditEntry.id]);
  await assertVoucherEntriesBalanced(tx, voucherId, 2);
}

export type VoucherLeg = {
  accountId: number;
  type: LedgerEntryType;
  amount: number;
  description?: string;
  /** Flat Mazduri portion on product debit legs (Purchase Invoice). */
  mazduriAmount?: number | null;
};

async function postMultiLegVoucherEntries(
  tx: Prisma.TransactionClient,
  voucherId: number,
  legs: VoucherLeg[],
  financialYearId: number,
) {
  const ledgerByAccountId = new Map<number, number>();
  const newEntryIdsByLedger = new Map<number, number[]>();

  for (const leg of legs) {
    let ledgerId = ledgerByAccountId.get(leg.accountId);
    if (ledgerId == null) {
      const ledger = await tx.ledger.findUniqueOrThrow({ where: { accountId: leg.accountId } });
      ledgerId = ledger.id;
      ledgerByAccountId.set(leg.accountId, ledgerId);
    }

    const mazduri =
      leg.mazduriAmount != null && Number(leg.mazduriAmount) > 0
        ? Number(leg.mazduriAmount)
        : null;

    const entry = await tx.ledgerEntry.create({
      data: {
        ledgerId,
        voucherId,
        financialYearId,
        type: leg.type,
        amount: leg.amount,
        balance: 0,
        notes: leg.description ?? undefined,
        mazduriAmount: mazduri,
        isReversal: false,
      },
    });

    const ids = newEntryIdsByLedger.get(ledgerId) ?? [];
    ids.push(entry.id);
    newEntryIdsByLedger.set(ledgerId, ids);
  }

  for (const [ledgerId, entryIds] of newEntryIdsByLedger) {
    await applyPostedLedgerEntriesInTx(tx, ledgerId, financialYearId, entryIds);
  }
}

export async function createMultiLegVoucherInTx(
  tx: Prisma.TransactionClient,
  data: {
    type: Extract<VoucherType, 'KACHI' | 'SALE_INVOICE' | 'PURCHASE_INVOICE'>;
    legs: VoucherLeg[];
    amount: number;
    date: Date | string;
    description: string;
    reference: string;
    createdById: number;
  },
) {
  if (data.legs.length < 2) {
    throw new AppError(400, 'Multi-leg voucher requires at least two ledger legs');
  }

  const totalDebits = roundMoney(
    data.legs
      .filter((leg) => leg.type === LedgerEntryType.DEBIT)
      .reduce((sum, leg) => sum + leg.amount, 0),
  );
  const totalCredits = roundMoney(
    data.legs
      .filter((leg) => leg.type === LedgerEntryType.CREDIT)
      .reduce((sum, leg) => sum + leg.amount, 0),
  );

  if (Math.abs(totalDebits - totalCredits) > 0.01) {
    throw new AppError(500, 'Multi-leg voucher debits and credits do not balance');
  }

  const trimmedReference = data.reference.trim();

  let voucherDate: Date;
  try {
    voucherDate = parseVoucherDateInput(data.date);
  } catch {
    throw new AppError(400, 'Invalid voucher date');
  }

  const financialYearId = await assertVoucherDateInActiveFinancialYear(tx, voucherDate);
  const number = await nextMultiLegVoucherNumber(tx, financialYearId, data.type);

  const voucher = await tx.voucher.create({
    data: {
      type: data.type,
      number,
      date: voucherDate,
      debitAccountId: null,
      creditAccountId: null,
      amount: data.amount,
      description: data.description,
      reference: trimmedReference || null,
      createdById: data.createdById,
      financialYearId,
      status: VoucherStatus.ACTIVE,
    },
  });

  await postMultiLegVoucherEntries(tx, voucher.id, data.legs, financialYearId);
  await assertTrialBalanceInDev(tx);

  return voucher;
}

export async function createKachiVoucherInTx(
  tx: Prisma.TransactionClient,
  data: {
    legs: VoucherLeg[];
    amount: number;
    date: Date | string;
    description: string;
    reference: string;
    createdById: number;
  },
) {
  return createMultiLegVoucherInTx(tx, { ...data, type: VoucherType.KACHI });
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

async function reverseVoucherLedgerEntries(
  tx: Prisma.TransactionClient,
  voucher: { id: number },
  notes: string,
) {
  const entries = await tx.ledgerEntry.findMany({
    where: { voucherId: voucher.id, isReversal: false },
    orderBy: { id: 'asc' },
  });

  for (const entry of entries) {
    await tx.ledgerEntry.create({
      data: {
        ledgerId: entry.ledgerId,
        voucherId: voucher.id,
        financialYearId: entry.financialYearId,
        type: entry.type === LedgerEntryType.DEBIT ? LedgerEntryType.CREDIT : LedgerEntryType.DEBIT,
        amount: entry.amount,
        balance: 0,
        notes,
        isReversal: true,
      },
    });
  }
}

const voucherInclude = {
  debitAccount: true,
  creditAccount: true,
  ledgerEntries: {
    where: { isReversal: false },
    orderBy: { id: 'asc' as const },
    include: {
      ledger: {
        include: {
          account: { select: { id: true, name: true, code: true } },
        },
      },
    },
  },
  createdBy: { select: { id: true, displayName: true, username: true } },
  modifiedBy: { select: { id: true, displayName: true, username: true } },
  deletedBy: { select: { id: true, displayName: true, username: true } },
} as const;

function voucherDashboardAccountLabel(voucher: {
  type: VoucherType;
  description?: string | null;
  debitAccount?: { name: string } | null;
  creditAccount?: { name: string } | null;
}) {
  if (voucher.type === 'KACHI') {
    return voucher.description?.trim() || 'Kachi Maal';
  }
  if (voucher.type === 'RECEIPT') return voucher.creditAccount?.name ?? '—';
  if (voucher.type === 'PAYMENT') return voucher.debitAccount?.name ?? '—';
  const debit = voucher.debitAccount?.name ?? '—';
  const credit = voucher.creditAccount?.name ?? '—';
  return `${debit} → ${credit}`;
}

export async function getDashboardSummary() {
  let financialYearId: number | undefined;
  try {
    financialYearId = await getActiveFinancialYearId(prisma);
  } catch {
    financialYearId = undefined;
  }

  const accounts = await prisma.account.findMany({
    where: { isActive: true },
    include: { category: true, ledger: true },
  });

  let cashBalance = 0;
  for (const account of accounts) {
    if (account.category && isBankOrCashCategory(account.category.name) && account.ledger) {
      cashBalance += Number(account.ledger.balance);
    }
  }

  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());

  const [vouchersToday, recentRows, productStock] = financialYearId
    ? await Promise.all([
        prisma.voucher.count({
          where: {
            financialYearId,
            status: { not: VoucherStatus.PENDING_APPROVAL },
            date: { gte: todayStart, lte: todayEnd },
          },
        }),
        prisma.voucher.findMany({
          where: {
            financialYearId,
            status: { not: VoucherStatus.PENDING_APPROVAL },
          },
          include: voucherInclude,
          orderBy: [{ date: 'desc' }, { number: 'desc' }],
          take: 10,
        }),
        getStockSummary(),
      ])
    : [0, [], await getStockSummary()];

  return {
    cashBalance,
    productStock,
    vouchersToday,
    recentVouchers: (recentRows as Array<{
      id: number;
      number: number;
      type: VoucherType;
      amount: unknown;
      date: Date;
      status: VoucherStatus;
      debitAccount?: { name: string } | null;
      creditAccount?: { name: string } | null;
    }>).map((v) => ({
      id: v.id,
      number: v.number,
      type: v.type,
      amount: Number(v.amount),
      date: v.date,
      status: v.status,
      accountLabel: voucherDashboardAccountLabel(v),
    })),
  };
}

async function batchOpeningBalanceSnapshots(
  db: DbClient,
  accountIds: number[],
  financialYearId: number,
): Promise<Map<number, number>> {
  const balances = new Map<number, number>();
  for (const accountId of accountIds) {
    balances.set(accountId, 0);
  }
  if (accountIds.length === 0) return balances;

  const currentYear = await db.financialYear.findFirst({
    where: { id: financialYearId },
  });
  if (!currentYear) return balances;

  const priorYear = await db.financialYear.findFirst({
    where: { startDate: { lt: currentYear.startDate } },
    orderBy: { startDate: 'desc' },
    select: { id: true },
  });
  if (!priorYear) return balances;

  const snapshots = await db.financialYearClosingBalance.findMany({
    where: {
      financialYearId: priorYear.id,
      accountId: { in: accountIds },
    },
  });

  for (const snapshot of snapshots) {
    balances.set(snapshot.accountId, Number(snapshot.balance));
  }

  return balances;
}

export async function listVouchers(
  filters?: {
    fromDate?: string;
    toDate?: string;
    type?: VoucherType;
    financialYearId?: number;
  },
  pagination?: { limit: number; offset: number },
): Promise<PaginatedResult<Awaited<ReturnType<typeof fetchVoucherListPage>>[number]>> {
  let financialYearId = filters?.financialYearId;
  if (financialYearId == null) {
  try {
    financialYearId = await getActiveFinancialYearId(prisma);
  } catch {
    financialYearId = undefined;
    }
  }

  const where: Prisma.VoucherWhereInput = {
    ...(financialYearId != null && { financialYearId }),
    status: { not: VoucherStatus.PENDING_APPROVAL },
  };

  if (filters?.fromDate || filters?.toDate) {
    where.date = {};
    if (filters.fromDate) {
      where.date.gte = parseDateStart(filters.fromDate);
    }
    if (filters.toDate) {
      where.date.lte = parseDateEnd(filters.toDate);
    }
  }

  if (filters?.type) {
    where.type = filters.type;
  }

  const limit = pagination?.limit ?? DEFAULT_PAGE_SIZE;
  const offset = pagination?.offset ?? 0;

  const [items, total] = await Promise.all([
    fetchVoucherListPage(where, limit, offset),
    prisma.voucher.count({ where }),
  ]);

  return { items, total, limit, offset };
}

function fetchVoucherListPage(
  where: Prisma.VoucherWhereInput,
  limit: number,
  offset: number,
) {
  return prisma.voucher.findMany({
    where,
    include: voucherInclude,
    orderBy: [{ date: 'desc' }, { number: 'desc' }],
    take: limit,
    skip: offset,
  });
}

export async function updateVoucherAmount(
  voucherId: number,
  newAmount: number,
  userId: number,
) {
  if (newAmount <= 0) {
    throw new AppError(400, 'Amount must be greater than zero');
  }

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const voucher = await tx.voucher.findFirst({
      where: { id: voucherId },
    });
    if (!voucher) throw new AppError(404, 'Voucher not found');
    if (voucher.status === VoucherStatus.CANCELLED) {
      throw new AppError(400, 'Cannot update amount on a cancelled voucher');
    }
    if (voucher.status === VoucherStatus.PENDING_APPROVAL) {
      throw new AppError(400, 'Cannot update amount on a pending voucher');
    }
    if (voucher.type === 'KACHI' || voucher.type === 'SALE_INVOICE' || voucher.type === 'PURCHASE_INVOICE') {
      throw new AppError(400, 'Invoice voucher amounts cannot be edited');
    }
    await assertActiveFinancialYear(tx, voucher.financialYearId);

    const oldAmount = Number(voucher.amount);
    const delta = newAmount - oldAmount;
    if (Math.abs(delta) < 0.005) {
      return tx.voucher.findUniqueOrThrow({ where: { id: voucher.id }, include: voucherInclude });
    }

    const entries = await tx.ledgerEntry.findMany({
      where: { voucherId: voucher.id, isReversal: false },
      orderBy: { id: 'asc' },
    });

    if (entries.length !== 2) {
      throw new AppError(400, 'Voucher ledger entries are invalid for amount update');
    }

    const debitEntry = entries.find((e) => e.type === LedgerEntryType.DEBIT);
    const creditEntry = entries.find((e) => e.type === LedgerEntryType.CREDIT);
    if (!debitEntry || !creditEntry) {
      throw new AppError(400, 'Voucher ledger entries are invalid for amount update');
    }

    await tx.ledgerEntry.update({
      where: { id: debitEntry.id },
      data: { amount: newAmount },
    });
    await tx.ledgerEntry.update({
      where: { id: creditEntry.id },
      data: { amount: newAmount },
    });

    await recomputeLedgerRunningBalancesInTx(tx, debitEntry.ledgerId, voucher.financialYearId!);
    await recomputeLedgerRunningBalancesInTx(tx, creditEntry.ledgerId, voucher.financialYearId!);

    await assertTrialBalanceInDev(tx);

    return tx.voucher.update({
      where: { id: voucher.id },
      data: { amount: newAmount, modifiedById: userId },
      include: voucherInclude,
    });
  }, WRITE_TRANSACTION_OPTIONS);
}

export async function cancelVoucher(voucherId: number, userId: number) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    return cancelVoucherInTx(tx, voucherId, userId);
  }, WRITE_TRANSACTION_OPTIONS);
}

export async function cancelVoucherInTx(
  tx: Prisma.TransactionClient,
  voucherId: number,
  userId: number,
) {
  const voucher = await tx.voucher.findFirst({
    where: { id: voucherId },
  });
  if (!voucher) throw new AppError(404, 'Voucher not found');
  if (voucher.status === VoucherStatus.CANCELLED) {
    throw new AppError(400, 'Voucher is already cancelled');
  }
  await assertActiveFinancialYear(tx, voucher.financialYearId);

  await reverseVoucherLedgerEntries(
    tx,
    voucher,
    `Reversal — cancelled voucher #${formatVoucherLabel(voucher.type, voucher.number)}`,
  );

  const now = new Date();
  const updated = await tx.voucher.update({
    where: { id: voucher.id },
    data: {
      status: VoucherStatus.CANCELLED,
      deletedById: userId,
      deletedAt: now,
      modifiedById: userId,
    },
    include: voucherInclude,
  });

  const affectedEntries = await tx.ledgerEntry.findMany({
    where: { voucherId: voucher.id },
    select: { ledgerId: true },
  });
  const ledgerIds = [...new Set(affectedEntries.map((entry) => entry.ledgerId))];
  for (const ledgerId of ledgerIds) {
    await recomputeLedgerRunningBalancesInTx(tx, ledgerId, voucher.financialYearId!);
  }

  await assertTrialBalanceInDev(tx);

  return updated;
}

export async function cancelActiveVouchersByReferenceInTx(
  tx: Prisma.TransactionClient,
  reference: string,
  userId: number,
) {
  const trimmed = reference.trim();
  if (!trimmed) return;

  const vouchers = await tx.voucher.findMany({
    where: { reference: trimmed, status: VoucherStatus.ACTIVE },
    orderBy: { id: 'asc' },
  });

  for (const voucher of vouchers) {
    await cancelVoucherInTx(tx, voucher.id, userId);
  }
}

/** @deprecated Use cancelVoucher — kept for route compatibility */
export async function deleteVoucher(voucherId: number, userId: number) {
  return cancelVoucher( voucherId, userId);
}

type AccountBalanceRow = {
  accountId: number;
  accountCode: string;
  accountName: string;
  categoryId: number;
  categoryName: string;
  balance: number;
  debit: number;
  credit: number;
};

type AccountForBalanceReport = {
  id: number;
  code: string;
  name: string;
  categoryId: number;
  category: { name: string } | null;
  ledger: { id: number } | null;
};

type LedgerEntryForBalance = {
  ledgerId: number;
  type: string;
  amount: unknown;
  isOpeningBalance?: boolean;
  createdAt: Date;
  voucher: { date: Date; status: string; number: string | null } | null;
};

function computeAccountBalanceRow(
  account: AccountForBalanceReport,
  params: {
    asOf: Date;
    side: 'debit' | 'credit' | 'both';
    openingByAccount: Map<number, number>;
    entriesByLedger: Map<number, LedgerEntryForBalance[]>;
  },
): AccountBalanceRow | null {
  if (!account.ledger) return null;

  const baseOpening = params.openingByAccount.get(account.id) ?? 0;
  const entries = [...(params.entriesByLedger.get(account.ledger.id) ?? [])];
  entries.sort(compareLedgerEntries);

  let running = baseOpening;
  for (const entry of entries) {
    const at = startOfDay(entryEffectiveDate(entry));
    if (at > params.asOf) continue;
    const { debit, credit } = entryDebitCredit(entry.type, Number(entry.amount));
    running += debit - credit;
  }

  const { debit, credit } = trialBalanceFromSignedBalance(running);
  if (params.side === 'debit' && debit <= 0) return null;
  if (params.side === 'credit' && credit <= 0) return null;

  return {
    accountId: account.id,
    accountCode: account.code,
    accountName: account.name,
    categoryId: account.categoryId,
    categoryName: account.category?.name ?? '',
    balance: running,
    debit,
    credit,
  };
}

function computeAccountBalanceRows(
  accounts: AccountForBalanceReport[],
  params: {
    asOf: Date;
    side: 'debit' | 'credit' | 'both';
    openingByAccount: Map<number, number>;
    entriesByLedger: Map<number, LedgerEntryForBalance[]>;
  },
): AccountBalanceRow[] {
  const rows: AccountBalanceRow[] = [];
  for (const account of accounts) {
    const row = computeAccountBalanceRow(account, params);
    if (row) rows.push(row);
  }
  return rows;
}

function sumAccountBalanceRows(rows: AccountBalanceRow[]) {
  return {
    totalDebit: rows.reduce((sum, row) => sum + row.debit, 0),
    totalCredit: rows.reduce((sum, row) => sum + row.credit, 0),
  };
}

function buildAccountBalanceGroupTotals(rows: AccountBalanceRow[]) {
  const groupTotalsMap = new Map<number, { totalDebit: number; totalCredit: number }>();
  for (const row of rows) {
    const existing = groupTotalsMap.get(row.categoryId) ?? { totalDebit: 0, totalCredit: 0 };
    existing.totalDebit += row.debit;
    existing.totalCredit += row.credit;
    groupTotalsMap.set(row.categoryId, existing);
  }
  return groupTotalsMap;
}

function buildAccountBalanceDisplayGroups(
  paginatedRows: AccountBalanceRow[],
  groupTotalsMap: Map<number, { totalDebit: number; totalCredit: number }>,
) {
  const groupsMap = new Map<
    number,
    {
      categoryId: number;
      categoryName: string;
      accounts: AccountBalanceRow[];
      totalDebit: number;
      totalCredit: number;
    }
  >();
  for (const row of paginatedRows) {
    const groupTotals = groupTotalsMap.get(row.categoryId) ?? { totalDebit: 0, totalCredit: 0 };
    const existing = groupsMap.get(row.categoryId);
    if (existing) {
      existing.accounts.push(row);
    } else {
      groupsMap.set(row.categoryId, {
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        accounts: [row],
        totalDebit: groupTotals.totalDebit,
        totalCredit: groupTotals.totalCredit,
      });
    }
  }
  return Array.from(groupsMap.values());
}

export async function getAccountBalancesAsOf(params: {
  date: string;
  categoryId?: number;
  productCategoryId?: number;
  side?: 'debit' | 'credit' | 'both';
  limit?: number;
  offset?: number;
  financialYearId?: number;
}) {
  if (params.categoryId != null && params.productCategoryId != null) {
    throw new AppError(400, 'Use either categoryId or productCategoryId, not both');
  }

  const side = params.side ?? 'both';
  const asOf = parseDateEnd(params.date);
  const financialYearId =
    params.financialYearId != null
      ? params.financialYearId
      : await getActiveFinancialYearId(prisma);
  if (params.financialYearId != null) {
    const year = await prisma.financialYear.findFirst({ where: { id: params.financialYearId } });
    if (!year) throw new AppError(404, 'Financial year not found');
  }
  const { yearStart, yearEnd } = await loadFinancialYearBounds(prisma, financialYearId);

  let productLinkedAccountIds: number[] | undefined;
  if (params.productCategoryId != null) {
    const products = await prisma.product.findMany({
      where: { categoryId: params.productCategoryId },
      select: { accountId: true },
    });
    productLinkedAccountIds = products.map((product) => product.accountId);
    if (productLinkedAccountIds.length === 0) {
      return {
        date: params.date,
        side,
        categoryId: null,
        productCategoryId: params.productCategoryId,
        totalCount: 0,
        accounts: [],
        groups: [],
        totalDebit: 0,
        totalCredit: 0,
      };
    }
  }

  const where = {
    ...SELECTABLE_ACCOUNT,
    excludeFromSelectors: false,
    ...(params.categoryId != null ? { categoryId: params.categoryId } : {}),
    ...(productLinkedAccountIds != null ? { id: { in: productLinkedAccountIds } } : {}),
  };

  // Full filtered account set — balance rows and totals must be computed from ALL matching
  // accounts because debit/credit side filtering happens after balance computation (cannot
  // paginate at the DB level before that step).
  const allAccounts = await prisma.account.findMany({
    where,
    include: { category: true, ledger: true },
    orderBy: [{ category: { name: 'asc' } }, { code: 'asc' }],
  });

  const accountIds = allAccounts.map((a) => a.id);
  const openingByAccount = await batchOpeningBalanceSnapshots(prisma, accountIds, financialYearId);

  const ledgerIds = allAccounts
    .map((a) => a.ledger?.id)
    .filter((id): id is number => id != null);

  const allEntries = ledgerIds.length
    ? await prisma.ledgerEntry.findMany({
        where: {
          ledgerId: { in: ledgerIds },
          isReversal: false,
          OR: [
            {
              voucher: {
                financialYearId,
                status: VoucherStatus.ACTIVE,
              },
            },
            {
              isOpeningBalance: true,
              createdAt: {
                gte: yearStart,
                ...(yearEnd ? { lte: yearEnd } : {}),
              },
            },
          ],
        },
        include: {
          voucher: { select: { date: true, status: true, number: true } },
        },
      })
    : [];

  const entriesByLedger = new Map<number, typeof allEntries>();
  for (const entry of allEntries) {
    const list = entriesByLedger.get(entry.ledgerId) ?? [];
    list.push(entry);
    entriesByLedger.set(entry.ledgerId, list);
  }

  const balanceParams = {
    asOf,
    side,
    openingByAccount,
    entriesByLedger,
  };

  const allRows = computeAccountBalanceRows(allAccounts, balanceParams);
  const { totalDebit, totalCredit } = sumAccountBalanceRows(allRows);
  const totalCount = allRows.length;
  const groupTotalsMap = buildAccountBalanceGroupTotals(allRows);

  const paginatedRows =
    params.limit != null
      ? allRows.slice(params.offset ?? 0, (params.offset ?? 0) + params.limit)
      : allRows;

  const groups = buildAccountBalanceDisplayGroups(paginatedRows, groupTotalsMap);

  return {
    date: params.date,
    side,
    categoryId: params.categoryId ?? null,
    productCategoryId: params.productCategoryId ?? null,
    totalCount,
    accounts: paginatedRows,
    groups,
    totalDebit,
    totalCredit,
  };
}

export async function getTrialBalance(options?: {
  limit?: number;
  offset?: number;
  financialYearId?: number;
}) {
  if (options?.financialYearId != null) {
    const year = await prisma.financialYear.findFirst({
      where: { id: options.financialYearId },
    });
    if (!year) throw new AppError(404, 'Financial year not found');

    if (year.status === FinancialYearStatus.CLOSED) {
      return getTrialBalanceFromClosingSnapshots(options.financialYearId, year.label, options);
    }
  }

  return getLiveTrialBalance(options);
}

/** Live cumulative trial balance from ledger balances — unaffected by FY rollover. */
async function getLiveTrialBalance(options?: { limit?: number; offset?: number; financialYearId?: number }) {
  const total = await prisma.ledger.count();
  const ledgers = await prisma.ledger.findMany({
    where: {},
    include: { account: true },
    orderBy: [{ account: { type: 'asc' } }, { account: { code: 'asc' } }],
    ...(options?.limit != null ? { skip: options.offset ?? 0, take: options.limit } : {}),
  });

  const accounts = ledgers.map((l: (typeof ledgers)[number]) => {
    const balance = Number(l.balance);
    const { debit, credit } = trialBalanceFromSignedBalance(balance);
    return {
      accountId: l.accountId,
      accountCode: l.account.code,
      accountName: l.account.name,
      accountType: l.account.type,
      balance,
      debit,
      credit,
    };
  });

  const allLedgers = await prisma.ledger.findMany({ select: { balance: true } });
  let totalDebit = 0;
  let totalCredit = 0;
  for (const l of allLedgers) {
    const { debit, credit } = trialBalanceFromSignedBalance(Number(l.balance));
    totalDebit += debit;
    totalCredit += credit;
  }

  return {
    accounts,
    totalDebit,
    totalCredit,
    isBalanced: isTrialBalanceBalanced(totalDebit, totalCredit),
    totalCount: total,
    scope: 'live' as const,
    financialYearId: options?.financialYearId ?? null,
    financialYearLabel: null as string | null,
  };
}

/** Closed-year trial balance from FY closing snapshots captured at rollover. */
async function getTrialBalanceFromClosingSnapshots(
  financialYearId: number,
  financialYearLabel: string,
  options?: { limit?: number; offset?: number },
) {
  const snapshots = await prisma.financialYearClosingBalance.findMany({
    where: { financialYearId },
    include: { account: true },
    orderBy: [{ account: { type: 'asc' } }, { account: { code: 'asc' } }],
    ...(options?.limit != null ? { skip: options.offset ?? 0, take: options.limit } : {}),
  });

  const totalCount = await prisma.financialYearClosingBalance.count({ where: { financialYearId } });

  const accounts = snapshots.map((snap) => {
    const balance = Number(snap.balance);
    const { debit, credit } = trialBalanceFromSignedBalance(balance);
    return {
      accountId: snap.accountId,
      accountCode: snap.account.code,
      accountName: snap.account.name,
      accountType: snap.account.type,
      balance,
      debit,
      credit,
    };
  });

  const allSnapshots = await prisma.financialYearClosingBalance.findMany({
    where: { financialYearId },
    select: { balance: true },
  });
  let totalDebit = 0;
  let totalCredit = 0;
  for (const snap of allSnapshots) {
    const { debit, credit } = trialBalanceFromSignedBalance(Number(snap.balance));
    totalDebit += debit;
    totalCredit += credit;
  }

  return {
    accounts,
    totalDebit,
    totalCredit,
    isBalanced: isTrialBalanceBalanced(totalDebit, totalCredit),
    totalCount,
    scope: 'closing_snapshot' as const,
    financialYearId,
    financialYearLabel,
  };
}

export async function getLedgerEntries(
  accountId: number,
  fromDate?: string,
  toDate?: string,
  pagination?: LedgerReportPagination,
) {
  const financialYearId = await getActiveFinancialYearId(prisma);
  return buildLedgerEntriesReport(accountId, financialYearId, fromDate, toDate, pagination);
}

export async function getLedgerEntriesForYear(
  accountId: number,
  financialYearId: number,
  fromDate?: string,
  toDate?: string,
  pagination?: LedgerReportPagination,
) {
  const year = await prisma.financialYear.findFirst({
    where: { id: financialYearId },
  });
  if (!year) throw new AppError(404, 'Financial year not found');
  return buildLedgerEntriesReport(accountId, financialYearId, fromDate, toDate, pagination);
}

type LedgerReportPagination =
  | { mode: 'offset'; limit: number; offset: number }
  | { mode: 'cursor'; limit: number; cursor: number | null };

const ledgerEntryReportSelect = {
  id: true,
  type: true,
  amount: true,
  notes: true,
  mazduriAmount: true,
  isOpeningBalance: true,
  createdAt: true,
  voucher: {
    select: {
      type: true,
      number: true,
      date: true,
      reference: true,
      description: true,
      debitAccount: { select: { name: true } },
      creditAccount: { select: { name: true } },
    },
  },
} satisfies Prisma.LedgerEntrySelect;

async function buildLedgerEntriesReport(
  accountId: number,
  financialYearId: number,
  fromDate?: string,
  toDate?: string,
  pagination?: LedgerReportPagination,
) {
  let ledger = await prisma.ledger.findFirst({
    where: { accountId },
    include: { account: { include: { category: true } } },
  });

  if (!ledger) {
    const account = await prisma.account.findFirst({
      where: { id: accountId, isActive: true },
      include: { category: true },
    });
    if (!account) throw new AppError(404, 'Ledger not found');
    await prisma.ledger.create({ data: { accountId, balance: 0 } });
    ledger = await prisma.ledger.findFirst({
      where: { accountId },
      include: { account: { include: { category: true } } },
    });
  }

  if (!ledger) throw new AppError(404, 'Ledger not found');

  const isBardanaAccount =
    ledger.account.category?.name?.trim().toLowerCase() === 'bardana';
  const showMazduriColumn = isMaalKhataCategoryName(ledger.account.category?.name ?? '');

  const { balance: baseOpening, priorYearLabel, hasSnapshot } = await getOpeningBalanceSnapshot(
    prisma,
    accountId,
    financialYearId,
  );

  const currentYear = await prisma.financialYear.findFirst({
    where: { id: financialYearId },
    select: { startDate: true, endDate: true, status: true, label: true },
  });

  const yearStart = currentYear ? startOfDay(currentYear.startDate) : startOfDay(new Date());
  const yearEnd = currentYear?.endDate ? endOfDay(currentYear.endDate) : null;

  const yearEntries = await prisma.ledgerEntry.findMany({
    where: ledgerEntriesForYearWhere(ledger.id, financialYearId, yearStart, yearEnd),
    orderBy: [{ id: 'asc' }],
    select: ledgerEntryReportSelect,
  });

  yearEntries.sort(compareLedgerEntries);

  const from = fromDate ? parseDateStart(fromDate) : null;
  const to = toDate ? parseDateEnd(toDate) : null;

  let periodOpening = baseOpening;
  const periodEntries: typeof yearEntries = [];

  for (const e of yearEntries) {
    const { debit, credit } = entryDebitCredit(e.type, Number(e.amount));
    const at = startOfDay(entryEffectiveDate(e));

    if (from && at < from) {
      periodOpening += debit - credit;
      continue;
    }
    if (to && at > to) continue;

    periodEntries.push(e);
  }

  const purchaseRefs = periodEntries
    .map((e) => e.voucher)
    .filter((v): v is NonNullable<typeof v> => Boolean(v && isPurchaseVoucher(v) && v.reference?.trim()))
    .map((v) => v.reference!.trim());
  const saleRefs = periodEntries
    .map((e) => e.voucher)
    .filter((v): v is NonNullable<typeof v> => Boolean(v && isSaleVoucher(v) && v.reference?.trim()))
    .map((v) => v.reference!.trim());
  const [purchaseDescriptions, saleDescriptions] = await Promise.all([
    loadPurchaseDescriptionsByRef( purchaseRefs),
    loadSaleDescriptionsByRef( saleRefs),
  ]);

  type LedgerRow = {
    date: string;
    voucherNo: string;
    ref: string | null;
    type: string;
    description: string;
    debit: number;
    credit: number;
    balance: number;
    /** Mazduri portion of product debit (Products ledgers only). */
    mazduri: number | null;
    isOpeningRow?: boolean;
    isClosingRow?: boolean;
    entryId?: number;
  };

  const rows: LedgerRow[] = [];
  let running = from ? periodOpening : baseOpening;
  let totalDebit = 0;
  let totalCredit = 0;
  let totalMazduri = 0;

  const openingLabel = priorYearLabel
    ? `Closing Balance of ${priorYearLabel}`
    : 'Opening Balance';

  if ((hasSnapshot && priorYearLabel) || from) {
    rows.push({
      date: from
        ? fromDate!
        : (currentYear?.startDate.toISOString() ?? new Date().toISOString()),
      voucherNo: '0',
      ref: null,
      type: openingLabel,
      description: openingLabel,
      debit: 0,
      credit: 0,
      balance: from ? periodOpening : baseOpening,
      mazduri: showMazduriColumn ? null : null,
      isOpeningRow: true,
    });
  }

  for (const e of periodEntries) {
    const { debit, credit } = entryDebitCredit(e.type, Number(e.amount));
    running += debit - credit;
    totalDebit += debit;
    totalCredit += credit;

    const entryMazduri =
      showMazduriColumn && debit > 0 && e.mazduriAmount != null && Number(e.mazduriAmount) > 0
        ? Number(e.mazduriAmount)
        : null;
    if (entryMazduri != null) totalMazduri += entryMazduri;

    const voucher = e.voucher;
    const purchaseSummary = voucher?.reference?.trim()
      ? purchaseDescriptions.get(voucher.reference.trim())
      : undefined;
    const saleSummary = voucher?.reference?.trim()
      ? saleDescriptions.get(voucher.reference.trim())
      : undefined;
    rows.push({
      date: entryEffectiveDate(e).toISOString(),
      voucherNo: e.isOpeningBalance
        ? '0'
        : voucherDisplayNo(voucher?.type ?? null, voucher?.number),
      ref: voucher?.reference ?? null,
      type: e.isOpeningBalance
        ? 'Opening Balance'
        : isBardanaAccount || isBardanaLedgerNote(e.notes)
          ? 'Bardana'
          : voucherTypeLabel(voucher ?? null, false),
      description: buildLedgerEntryDescription(e, voucher ?? null, purchaseSummary, saleSummary),
      debit,
      credit,
      balance: running,
      mazduri: showMazduriColumn ? entryMazduri : null,
      entryId: e.id,
    });
  }

  const closingBalance = from || to
    ? running
    : baseOpening + yearEntries.reduce((sum, e) => {
        const { debit, credit } = entryDebitCredit(e.type, Number(e.amount));
        return sum + debit - credit;
      }, 0);

  if (currentYear?.status === FinancialYearStatus.CLOSED) {
    const snapshot = await prisma.financialYearClosingBalance.findUnique({
      where: {
        financialYearId_accountId: {
          financialYearId,
          accountId,
        },
      },
    });
    const snapshotBalance = snapshot ? Number(snapshot.balance) : closingBalance;
    rows.push({
      date: currentYear.endDate?.toISOString() ?? new Date().toISOString(),
      voucherNo: '0',
      ref: null,
      type: `Closing Balance — FY ${currentYear.label}`,
      description: `Closing Balance — FY ${currentYear.label}`,
      debit: 0,
      credit: 0,
      balance: snapshotBalance,
      mazduri: showMazduriColumn ? null : null,
      isClosingRow: true,
    });
  }

  const totalCount = rows.length;
  const { paginatedRows, nextCursor, hasMore } = paginateLedgerRows(rows, pagination);

  return {
    account: ledger.account,
    balance: closingBalance,
    totalCount,
    showMazduriColumn,
    rows: paginatedRows.map(({ entryId: _entryId, ...row }) => row),
    nextCursor,
    hasMore,
    summary: {
      periodOpening: from ? periodOpening : baseOpening,
      totalDebit,
      totalCredit,
      totalMazduri: showMazduriColumn ? roundMoney(totalMazduri) : 0,
      closingBalance,
    },
  };
}

function paginateLedgerRows(
  rows: Array<{
    isOpeningRow?: boolean;
    entryId?: number;
    [key: string]: unknown;
  }>,
  pagination?: LedgerReportPagination,
): {
  paginatedRows: typeof rows;
  nextCursor: string | null;
  hasMore: boolean;
} {
  if (!pagination) {
    return { paginatedRows: rows, nextCursor: null, hasMore: false };
  }

  if (pagination.mode === 'cursor') {
    let startIndex = 0;
    if (pagination.cursor != null) {
      const cursorIndex = rows.findIndex((row) => row.entryId === pagination.cursor);
      startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    }
    const slice = rows.slice(startIndex, startIndex + pagination.limit);
    const lastEntryId = [...slice].reverse().find((row) => row.entryId != null)?.entryId;
    const hasMore = startIndex + pagination.limit < rows.length;
    return {
      paginatedRows: slice,
      nextCursor: hasMore && lastEntryId != null ? String(lastEntryId) : null,
      hasMore,
    };
  }

  const slice = rows.slice(pagination.offset, pagination.offset + pagination.limit);
  const lastEntryId = [...slice].reverse().find((row) => row.entryId != null)?.entryId;
  const hasMore = pagination.offset + pagination.limit < rows.length;
  return {
    paginatedRows: slice,
    nextCursor: hasMore && lastEntryId != null ? String(lastEntryId) : null,
    hasMore,
  };
}

export async function approveTrialBalance(data: {
  period: string;
  approvedById: number;
  notes?: string;
}) {
  const snapshot = await getTrialBalance();
  return prisma.trialBalanceApproval.upsert({
    where: { period: data.period },
    create: {
      period: data.period,
      approvedById: data.approvedById,
      notes: data.notes,
      snapshot,
    },
    update: {
      approvedById: data.approvedById,
      notes: data.notes,
      snapshot,
    },
    include: { approvedBy: { select: { id: true, displayName: true, username: true } } },
  });
}

export async function listTrialBalanceApprovals() {
  return prisma.trialBalanceApproval.findMany({
    where: {},
    include: { approvedBy: { select: { id: true, displayName: true, username: true } } },
    orderBy: { period: 'desc' },
  });
}

export async function updateAccount(
  id: number,
  data: Partial<{ name: string; code: string; isActive: boolean }>
) {
  const account = await prisma.account.findFirst({ where: { id } });
  if (!account) throw new AppError(404, 'Account not found');
  return prisma.account.update({ where: { id }, data });
}

/** Soft-delete: hides account from lists; ledger entries are kept until vouchers are cancelled. */
export async function softDeleteAccount(id: number) {
  const account = await prisma.account.findFirst({ where: { id, isActive: true } });
  if (!account) throw new AppError(404, 'Account not found');
  if (isInventoryAccountName(account.name)) {
    throw new AppError(400, 'The Inventory account cannot be deleted');
  }
  await assertNotMaalKhataLinkedAccount(id);
  return prisma.account.update({
    where: { id },
    data: { isActive: false },
    include: { category: true, ledger: true },
  });
}
