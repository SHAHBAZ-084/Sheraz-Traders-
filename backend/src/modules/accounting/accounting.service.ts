import { AccountType, FinancialYearStatus, LedgerEntryType, Prisma, VoucherStatus, VoucherType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { AppError } from '../../utils/helpers';
import { PaginatedResult } from '../../utils/pagination';
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
import { isBardanaLedgerNote } from '../invoices/invoice-voucher-descriptions';
import { getProductStockBalances } from '../stock/stock.service';

type DbClient = Prisma.TransactionClient | typeof prisma;

export function fiscalYearLabelForDate(date: Date): { label: string; startDate: Date } {
  const year = date.getFullYear();
  const month = date.getMonth();
  if (month >= 6) {
    return { label: `${year}-${year + 1}`, startDate: new Date(year, 6, 1) };
  }
  return { label: `${year - 1}-${year}`, startDate: new Date(year - 1, 6, 1) };
}

function nextFiscalYearLabel(label: string): string {
  const startYear = parseInt(label.split('-')[0] ?? '', 10);
  if (!Number.isFinite(startYear)) {
    throw new AppError(500, 'Invalid financial year label');
  }
  return `${startYear + 1}-${startYear + 2}`;
}

export async function getActiveFinancialYearId(db: DbClient): Promise<number> {
  const year = await db.financialYear.findFirst({
    where: { status: FinancialYearStatus.ACTIVE },
    select: { id: true },
  });
  if (!year) throw new AppError(400, 'No active financial year');
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

/** Voucher accounting date must fall inside the active financial year (not just "a year exists"). */
export async function assertVoucherDateInActiveFinancialYear(
  db: DbClient,
  voucherDate: Date,
): Promise<number> {
  const activeYear = await db.financialYear.findFirst({
    where: { status: FinancialYearStatus.ACTIVE },
  });
  if (!activeYear) throw new AppError(400, 'No active financial year');

  const day = startOfDay(voucherDate);
  const yearStart = startOfDay(activeYear.startDate);
  if (day < yearStart) {
    throw new AppError(400, 'Voucher date is before the active financial year');
  }
  if (activeYear.endDate) {
    const yearEnd = endOfDay(activeYear.endDate);
    if (day > yearEnd) {
      throw new AppError(400, 'Voucher date is after the active financial year');
    }
  }
  return activeYear.id;
}

async function assertTrialBalanceInDev(db: DbClient) {
  if (process.env.NODE_ENV === 'production') return;
  const ledgers = await db.ledger.findMany({ select: { balance: true } });
  let totalDebit = 0;
  let totalCredit = 0;
  for (const l of ledgers) {
    const { debit, credit } = trialBalanceFromSignedBalance(Number(l.balance));
    totalDebit += debit;
    totalCredit += credit;
  }
  if (!isTrialBalanceBalanced(totalDebit, totalCredit)) {
    console.error('[accounting] Trial balance mismatch after voucher change', {
      totalDebit,
      totalCredit,
    });
  }
}

async function getOpeningBalanceSnapshot(
  db: DbClient,
  accountId: number,
  financialYearId: number,
): Promise<{ balance: number; priorYearLabel: string | null }> {
  const currentYear = await db.financialYear.findFirst({
    where: { id: financialYearId },
  });
  if (!currentYear) return { balance: 0, priorYearLabel: null };

  const priorYear = await db.financialYear.findFirst({
    where: { startDate: { lt: currentYear.startDate } },
    orderBy: { startDate: 'desc' },
    select: { id: true, label: true },
  });
  if (!priorYear) return { balance: 0, priorYearLabel: null };

  const snapshot = await db.financialYearClosingBalance.findUnique({
    where: {
      financialYearId_accountId: {
        financialYearId: priorYear.id,
        accountId,
      },
    },
  });
  return {
    balance: snapshot ? Number(snapshot.balance) : 0,
    priorYearLabel: priorYear.label,
  };
}

export async function listFinancialYears() {
  return prisma.financialYear.findMany({
    where: {},
    orderBy: { startDate: 'desc' },
    include: {
      closedBy: { select: { id: true, displayName: true, username: true } },
    },
  });
}

export async function closeFinancialYear(userId: number) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const activeYear = await tx.financialYear.findFirst({
      where: { status: FinancialYearStatus.ACTIVE },
    });
    if (!activeYear) throw new AppError(400, 'No active financial year to close');

    const accounts = await tx.account.findMany({
      where: {},
      include: { ledger: true },
    });

    for (const account of accounts) {
      const balance = account.ledger ? Number(account.ledger.balance) : 0;
      await tx.financialYearClosingBalance.create({
        data: {
          financialYearId: activeYear.id,
          accountId: account.id,
          balance,
        },
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

    const newYear = await tx.financialYear.create({
      data: {
        label: nextFiscalYearLabel(activeYear.label),
        startDate: nextStart,
        status: FinancialYearStatus.ACTIVE,
      },
    });

    return { closedYear, newYear };
  });
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

  const [debitAccount, creditAccount] = await Promise.all([
    tx.account.findFirst({
      where: { id: debitAccountId, isActive: true },
      include: { category: true },
    }),
    tx.account.findFirst({
      where: { id: creditAccountId, isActive: true },
      include: { category: true },
    }),
  ]);

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

  await tx.ledger.update({ where: { id: ledgerId }, data: { balance: running } });
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

export async function listAccountCategories() {
  await bootstrapChartOfAccounts();

  const [categories, customerCount, supplierCount, inventoryAccounts] = await Promise.all([
    prisma.accountCategory.findMany({
      where: { isActive: true },
      include: { accounts: { where: { isActive: true }, include: { ledger: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.customer.count({ where: { isActive: true } }),
    prisma.supplier.count({ where: { isActive: true } }),
    prisma.account.count({
      where: { isActive: true, name: { equals: INVENTORY_ACCOUNT_NAME },
      },
    }),
  ]);

  return categories.map((category) => {
    const isCustomers = isCustomersCategoryName(category.name);
    const isSuppliers = isSuppliersCategoryName(category.name);
    const isInventory = isInventoryCategoryName(category.name);
    return {
      ...category,
      isCustomersCategory: isCustomers,
      isSuppliersCategory: isSuppliers,
      isInventoryCategory: isInventory,
      entryCount: isCustomers
        ? customerCount
        : isSuppliers
          ? supplierCount
          : isInventory
            ? inventoryAccounts
            : category.accounts.length,
    };
  });
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

async function generateNextAccountCode(): Promise<string> {
  const accounts = await prisma.account.findMany({
    where: {},
    select: { code: true },
  });

  let max = 0;
  for (const { code } of accounts) {
    if (!/^\d+$/.test(code)) continue;
    const num = parseInt(code, 10);
    if (!Number.isNaN(num) && num > max) max = num;
  }
  return String(max + 1);
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

async function generateNextAccountCodeInTx(
  tx: Prisma.TransactionClient,
  ): Promise<string> {
  const accounts = await tx.account.findMany({ where: {}, select: { code: true } });
  let max = 0;
  for (const { code } of accounts) {
    if (!/^\d+$/.test(code)) continue;
    const num = parseInt(code, 10);
    if (!Number.isNaN(num) && num > max) max = num;
  }
  return String(max + 1);
}

async function findOrCreateOpeningBalanceEquityAccount(
  tx: Prisma.TransactionClient,
  ) {
  const existing = await tx.account.findFirst({
    where: { isActive: true,
      type: AccountType.EQUITY,
      name: { equals: 'Opening Balance Equity' },
    },
    include: { ledger: true },
  });
  if (existing?.ledger) return existing;

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
      name: 'Opening Balance Equity',
      code: await generateNextAccountCodeInTx(tx),
      type: AccountType.EQUITY,
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
  const offsetBalance = Number(equityLedger.balance) + (side === 'DR' ? -amount : amount);

  await tx.ledgerEntry.create({
    data: {
      ledgerId: equityLedger.id,
      type: offsetType,
      amount,
      balance: offsetBalance,
      notes: `Opening Balance — offset for ${accountName}`,
      isOpeningBalance: true,
    },
  });
  await tx.ledger.update({
    where: { id: equityLedger.id },
    data: { balance: offsetBalance },
  });
}

export async function createAccount(data: {
  categoryId: number;
  name: string;
  code?: string;
  type?: AccountType;
  openingBalance?: number;
  openingBalanceSide?: 'DR' | 'CR';
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
  const trimmedCode = data.code
    ? await assertUniqueAccountCode(data.code)
    : await generateNextAccountCode();

  const amount = Math.abs(data.openingBalance ?? 0);
  const side = data.openingBalanceSide ?? defaultOpeningSide(type);
  const signedBalance = amount === 0 ? 0 : side === 'DR' ? amount : -amount;

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const account = await tx.account.create({
      data: {
        categoryId: data.categoryId,
        name: trimmedName,
        code: trimmedCode,
        type,
      },
    });

    const ledger = await tx.ledger.create({
      data: { accountId: account.id, balance: signedBalance },
    });

    if (amount > 0 && trimmedName.toLowerCase() !== 'opening balance equity') {
      await tx.ledgerEntry.create({
        data: {
          ledgerId: ledger.id,
          type: side === 'DR' ? LedgerEntryType.DEBIT : LedgerEntryType.CREDIT,
          amount,
          balance: signedBalance,
          notes: 'Opening Balance',
          isOpeningBalance: true,
        },
      });
      await postOpeningBalanceOffset(tx, trimmedName, amount, side);
    }

    return tx.account.findUniqueOrThrow({
      where: { id: account.id },
      include: { category: true, ledger: true },
    });
  });
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

export async function listAccounts() {
  await prisma.$transaction(async (tx) => {
    await consolidateDuplicateInventoryAccounts(tx);
    await syncCustomerSupplierAccountsInTx(tx);
  });

  const accounts = await prisma.account.findMany({
    where: { isActive: true },
    include: { category: true, ledger: true },
    orderBy: { code: 'asc' },
  });

  return accounts.map(({ ledger, ...account }) => ({
    ...account,
    ledger: ledger
      ? { ...ledger, balance: Number(ledger.balance) }
      : null,
  }));
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
  const category = await ensureCategoryInTx(tx, 'Ext. Purchase Party');
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
  INT_PURCHASE: 'Int. Purchase Party',
  EXT_PURCHASE: 'Ext. Purchase Party',
  SALE_PARTY: 'Sale Party',
  REVENUE: 'Revenue',
  SALE_FEE: 'Sale Fee',
  BARDANA: 'Bardana',
} as const;

export type KachiMaalSystemAccounts = {
  bori: { id: number; name: string };
  thela: { id: number; name: string };
  commission: { id: number; name: string };
  mazduri: { id: number; name: string };
  broker: { id: number; name: string };
  marketFee: { id: number; name: string };
  misc: { id: number; name: string };
};

/** One-time auto-creation of Kachi Maal fee/bardana categories and accounts. */
export async function ensureKachiMaalAccounts(
  tx: Prisma.TransactionClient,
): Promise<KachiMaalSystemAccounts> {
  await ensureCategoryInTx(tx, KACHI_MAAL_CATEGORY_NAMES.INT_PURCHASE);
  await ensureCategoryInTx(tx, KACHI_MAAL_CATEGORY_NAMES.EXT_PURCHASE);
  await ensureCategoryInTx(tx, KACHI_MAAL_CATEGORY_NAMES.SALE_PARTY);
  const revenue = await ensureCategoryInTx(tx, KACHI_MAAL_CATEGORY_NAMES.REVENUE);
  const saleFee = await ensureCategoryInTx(tx, KACHI_MAAL_CATEGORY_NAMES.SALE_FEE);
  const bardana = await ensureCategoryInTx(tx, KACHI_MAAL_CATEGORY_NAMES.BARDANA);

  const bori = await ensureDefaultAccountInTx(tx, bardana.id, 'Bori', AccountType.ASSET, 'BD-BORI');
  const thela = await ensureDefaultAccountInTx(tx, bardana.id, 'Thela', AccountType.ASSET, 'BD-THELA');
  const commission = await ensureDefaultAccountInTx(tx, revenue.id, 'Commission', AccountType.REVENUE, 'REV-COMM');
  const mazduri = await ensureDefaultAccountInTx(tx, saleFee.id, 'Mazduri', AccountType.EXPENSE, 'SF-MAZ');
  const broker = await ensureDefaultAccountInTx(tx, saleFee.id, 'Broker', AccountType.EXPENSE, 'SF-BRK');
  const marketFee = await ensureDefaultAccountInTx(tx, saleFee.id, 'Market Fee', AccountType.EXPENSE, 'SF-MKT');
  const misc = await ensureDefaultAccountInTx(tx, saleFee.id, 'Misc', AccountType.EXPENSE, 'SF-MISC');

  return {
    bori: { id: bori.id, name: bori.name },
    thela: { id: thela.id, name: thela.name },
    commission: { id: commission.id, name: commission.name },
    mazduri: { id: mazduri.id, name: mazduri.name },
    broker: { id: broker.id, name: broker.name },
    marketFee: { id: marketFee.id, name: marketFee.name },
    misc: { id: misc.id, name: misc.name },
  };
}

async function syncCustomerSupplierAccountsInTx(tx: Prisma.TransactionClient) {
  const [customers, suppliers] = await Promise.all([
    tx.customer.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    }),
    tx.supplier.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    }),
  ]);

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
        for (const account of category.accounts) {
          if (account.categoryId !== target.id) {
            await tx.account.update({
              where: { id: account.id },
              data: { categoryId: target.id, type: partyTarget.type },
            });
          }
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

      for (const account of unusedAccounts) {
        await tx.account.update({
          where: { id: account.id },
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

/** Create default chart-of-accounts categories and core accounts for a branch. Idempotent. */
export async function bootstrapChartOfAccounts() {
  await prisma.$transaction(async (tx) => {
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

    // Only consolidate Inventory if it already exists — never create it.
    await consolidateDuplicateInventoryCategories(tx);
    await consolidateDuplicateInventoryAccounts(tx);

    await cleanupRemovedAutoCategories(tx);
  });
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
  });
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

    const existingEntries = await tx.ledgerEntry.count({ where: { voucherId: voucher.id } });
    if (existingEntries === 0) {
      await postVoucherLedgerEntries(
        tx,
        voucher.id,
        voucher.debitAccountId,
        voucher.creditAccountId,
        Number(voucher.amount),
        voucher.description,
        voucher.financialYearId,
      );
    } else {
      // Retry path: entries may exist from a partial prior attempt — recompute only.
      const debitLedger = await tx.ledger.findUniqueOrThrow({
        where: { accountId: voucher.debitAccountId },
      });
      const creditLedger = await tx.ledger.findUniqueOrThrow({
        where: { accountId: voucher.creditAccountId },
      });
      await recomputeLedgerRunningBalancesInTx(tx, debitLedger.id, voucher.financialYearId);
      await recomputeLedgerRunningBalancesInTx(tx, creditLedger.id, voucher.financialYearId);
    }

    await assertTrialBalanceInDev(tx);
    return tx.voucher.findUniqueOrThrow({ where: { id: voucher.id }, include: voucherInclude });
  });
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

  await tx.ledgerEntry.createMany({
    data: [
      {
        ledgerId: debitLedger.id,
        voucherId,
        type: LedgerEntryType.DEBIT,
        amount,
        balance: 0,
        notes: notes ?? undefined,
        isReversal: false,
      },
      {
        ledgerId: creditLedger.id,
        voucherId,
        type: LedgerEntryType.CREDIT,
        amount,
        balance: 0,
        notes: notes ?? undefined,
        isReversal: false,
      },
    ],
  });

  await recomputeLedgerRunningBalancesInTx(tx, debitLedger.id, financialYearId);
  await recomputeLedgerRunningBalancesInTx(tx, creditLedger.id, financialYearId);
}

export type VoucherLeg = {
  accountId: number;
  type: LedgerEntryType;
  amount: number;
  description?: string;
};

async function postMultiLegVoucherEntries(
  tx: Prisma.TransactionClient,
  voucherId: number,
  legs: VoucherLeg[],
  financialYearId: number,
) {
  const ledgerByAccountId = new Map<number, number>();

  for (const leg of legs) {
    let ledgerId = ledgerByAccountId.get(leg.accountId);
    if (ledgerId == null) {
      const ledger = await tx.ledger.findUniqueOrThrow({ where: { accountId: leg.accountId } });
      ledgerId = ledger.id;
      ledgerByAccountId.set(leg.accountId, ledgerId);
    }

    await tx.ledgerEntry.create({
      data: {
        ledgerId,
        voucherId,
        type: leg.type,
        amount: leg.amount,
        balance: 0,
        notes: leg.description ?? undefined,
        isReversal: false,
      },
    });
  }

  for (const ledgerId of ledgerByAccountId.values()) {
    await recomputeLedgerRunningBalancesInTx(tx, ledgerId, financialYearId);
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
        getProductStockBalances(),
      ])
    : [0, [], await getProductStockBalances()];

  return {
    cashBalance,
    productStock,
    vouchersToday,
    recentVouchers: recentRows.map((v) => ({
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
  },
  pagination?: { limit: number; offset: number },
): Promise<PaginatedResult<Awaited<ReturnType<typeof fetchVoucherListPage>>[number]>> {
  let financialYearId: number | undefined;
  try {
    financialYearId = await getActiveFinancialYearId(prisma);
  } catch {
    financialYearId = undefined;
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

  const limit = pagination?.limit ?? 200;
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
  });
}

export async function cancelVoucher(voucherId: number, userId: number) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    return cancelVoucherInTx(tx, voucherId, userId);
  });
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

export async function getAccountBalancesAsOf(params: {
  date: string;
  categoryId?: number;
  side?: 'debit' | 'credit' | 'both';
}) {
  const side = params.side ?? 'both';
  const asOf = parseDateEnd(params.date);
  const financialYearId = await getActiveFinancialYearId(prisma);
  const { yearStart, yearEnd } = await loadFinancialYearBounds(prisma, financialYearId);

  const accounts = await prisma.account.findMany({
    where: {
      isActive: true,
      ...(params.categoryId != null ? { categoryId: params.categoryId } : {}),
    },
    include: { category: true, ledger: true },
    orderBy: [{ category: { name: 'asc' } }, { code: 'asc' }],
  });

  const accountIds = accounts.map((a) => a.id);
  const openingByAccount = await batchOpeningBalanceSnapshots(prisma, accountIds, financialYearId);

  const ledgerIds = accounts
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

  type BalanceRow = {
    accountId: number;
    accountCode: string;
    accountName: string;
    categoryId: number;
    categoryName: string;
    balance: number;
    debit: number;
    credit: number;
  };

  const rows: BalanceRow[] = [];

  for (const account of accounts) {
    if (!account.ledger) continue;

    const baseOpening = openingByAccount.get(account.id) ?? 0;
    const entries = entriesByLedger.get(account.ledger.id) ?? [];
    entries.sort(compareLedgerEntries);

    let running = baseOpening;
    for (const entry of entries) {
      const at = startOfDay(entryEffectiveDate(entry));
      if (at > asOf) continue;
      const { debit, credit } = entryDebitCredit(entry.type, Number(entry.amount));
      running += debit - credit;
    }

    const { debit, credit } = trialBalanceFromSignedBalance(running);
    if (side === 'debit' && debit <= 0) continue;
    if (side === 'credit' && credit <= 0) continue;

    rows.push({
      accountId: account.id,
      accountCode: account.code,
      accountName: account.name,
      categoryId: account.categoryId,
      categoryName: account.category?.name ?? '',
      balance: running,
      debit,
      credit,
    });
  }

  const groupsMap = new Map<number, { categoryId: number; categoryName: string; accounts: BalanceRow[] }>();
  for (const row of rows) {
    const existing = groupsMap.get(row.categoryId);
    if (existing) {
      existing.accounts.push(row);
    } else {
      groupsMap.set(row.categoryId, {
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        accounts: [row],
      });
    }
  }

  const groups = Array.from(groupsMap.values());
  const totalDebit = rows.reduce((sum, row) => sum + row.debit, 0);
  const totalCredit = rows.reduce((sum, row) => sum + row.credit, 0);

  return {
    date: params.date,
    side,
    categoryId: params.categoryId ?? null,
    accounts: rows,
    groups,
    totalDebit,
    totalCredit,
  };
}

export async function getTrialBalance() {
  const ledgers = await prisma.ledger.findMany({
    where: {},
    include: { account: true },
    orderBy: [{ account: { type: 'asc' } }, { account: { code: 'asc' } }],
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

  const totalDebit = accounts.reduce((s, a) => s + a.debit, 0);
  const totalCredit = accounts.reduce((s, a) => s + a.credit, 0);

  return {
    accounts,
    totalDebit,
    totalCredit,
    isBalanced: isTrialBalanceBalanced(totalDebit, totalCredit),
  };
}

export async function getLedgerEntries(
  accountId: number,
  fromDate?: string,
  toDate?: string,
) {
  const financialYearId = await getActiveFinancialYearId(prisma);
  return buildLedgerEntriesReport(accountId, financialYearId, fromDate, toDate);
}

export async function getLedgerEntriesForYear(
  accountId: number,
  financialYearId: number,
  fromDate?: string,
  toDate?: string,
) {
  const year = await prisma.financialYear.findFirst({
    where: { id: financialYearId },
  });
  if (!year) throw new AppError(404, 'Financial year not found');
  return buildLedgerEntriesReport(accountId, financialYearId, fromDate, toDate);
}

async function buildLedgerEntriesReport(
  accountId: number,
  financialYearId: number,
  fromDate?: string,
  toDate?: string,
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
    ledger.account.category?.name?.trim().toLowerCase() ===
    KACHI_MAAL_CATEGORY_NAMES.BARDANA.toLowerCase();

  const { balance: baseOpening, priorYearLabel } = await getOpeningBalanceSnapshot(
    prisma,
    accountId,
    financialYearId,
  );

  const currentYear = await prisma.financialYear.findFirst({
    where: { id: financialYearId },
    select: { startDate: true, endDate: true },
  });

  const yearStart = currentYear ? startOfDay(currentYear.startDate) : startOfDay(new Date());
  const yearEnd = currentYear?.endDate ? endOfDay(currentYear.endDate) : null;

  const yearEntries = await prisma.ledgerEntry.findMany({
    where: ledgerEntriesForYearWhere(ledger.id, financialYearId, yearStart, yearEnd),
    orderBy: [{ id: 'asc' }],
    include: {
      voucher: { include: { debitAccount: true, creditAccount: true } },
    },
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
    isOpeningRow?: boolean;
  };

  const rows: LedgerRow[] = [];
  let running = from ? periodOpening : baseOpening;
  let totalDebit = 0;
  let totalCredit = 0;

  const openingLabel = priorYearLabel
    ? `Closing Balance of ${priorYearLabel}`
    : 'Opening Balance';

  if (priorYearLabel || from) {
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
      isOpeningRow: true,
    });
  }

  for (const e of periodEntries) {
    const { debit, credit } = entryDebitCredit(e.type, Number(e.amount));
    running += debit - credit;
    totalDebit += debit;
    totalCredit += credit;

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
    });
  }

  const closingBalance = from || to
    ? running
    : baseOpening + yearEntries.reduce((sum, e) => {
        const { debit, credit } = entryDebitCredit(e.type, Number(e.amount));
        return sum + debit - credit;
      }, 0);

  return {
    account: ledger.account,
    balance: closingBalance,
    rows,
    summary: {
      periodOpening: from ? periodOpening : baseOpening,
      totalDebit,
      totalCredit,
      closingBalance,
    },
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
