import { LedgerEntryType, Prisma, VoucherStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import {
  computeLedgerBalance,
  isTrialBalanceBalanced,
  trialBalanceFromSignedBalance,
} from './ledger-utils';

type DbClient = Prisma.TransactionClient | typeof prisma;

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export type LedgerIntegrityReport = {
  ok: boolean;
  trialBalance: {
    totalDebit: number;
    totalCredit: number;
    isBalanced: boolean;
    difference: number;
  };
  /** Non-reversal entries on ACTIVE vouchers plus opening-balance entries (no voucher). */
  globalActiveEntryTotals: {
    totalDebit: number;
    totalCredit: number;
    isBalanced: boolean;
    difference: number;
  };
  ledgerDrift: Array<{
    accountId: number;
    accountName: string;
    storedBalance: number;
    computedBalance: number;
  }>;
  unbalancedVouchers: Array<{
    voucherId: number;
    totalDebit: number;
    totalCredit: number;
  }>;
  /** Closed FY snapshots that do not tie out — informational; live books may still balance. */
  closingSnapshotTrialBalance: Array<{
    financialYearId: number;
    label: string;
    totalDebit: number;
    totalCredit: number;
    isBalanced: boolean;
  }>;
  closingSnapshotIssues: Array<{
    financialYearId: number;
    label: string;
    totalDebit: number;
    totalCredit: number;
    difference: number;
  }>;
};

async function sumActiveEntryTotals(db: DbClient) {
  const rows = await db.ledgerEntry.findMany({
    where: {
      isReversal: false,
      OR: [
        { voucher: { status: VoucherStatus.ACTIVE } },
        { isOpeningBalance: true, voucherId: null },
      ],
    },
    select: { type: true, amount: true },
  });

  let totalDebit = 0;
  let totalCredit = 0;
  for (const row of rows) {
    const amount = Number(row.amount);
    if (row.type === LedgerEntryType.DEBIT) totalDebit += amount;
    else totalCredit += amount;
  }
  return { totalDebit: roundMoney(totalDebit), totalCredit: roundMoney(totalCredit) };
}

async function findUnbalancedActiveVouchers(db: DbClient) {
  const vouchers = await db.voucher.findMany({
    where: { status: VoucherStatus.ACTIVE },
    select: { id: true },
  });

  const unbalanced: LedgerIntegrityReport['unbalancedVouchers'] = [];
  for (const voucher of vouchers) {
    const entries = await db.ledgerEntry.findMany({
      where: { voucherId: voucher.id, isReversal: false },
      select: { type: true, amount: true },
    });
    let totalDebit = 0;
    let totalCredit = 0;
    for (const entry of entries) {
      const amount = Number(entry.amount);
      if (entry.type === LedgerEntryType.DEBIT) totalDebit += amount;
      else totalCredit += amount;
    }
    if (!isTrialBalanceBalanced(totalDebit, totalCredit)) {
      unbalanced.push({
        voucherId: voucher.id,
        totalDebit: roundMoney(totalDebit),
        totalCredit: roundMoney(totalCredit),
      });
    }
  }
  return unbalanced;
}

async function findLedgerBalanceDrift(db: DbClient) {
  const ledgers = await db.ledger.findMany({ include: { account: { select: { name: true } } } });
  const drift: LedgerIntegrityReport['ledgerDrift'] = [];

  for (const ledger of ledgers) {
    const entries = await db.ledgerEntry.findMany({
      where: { ledgerId: ledger.id },
      orderBy: { id: 'asc' },
      select: { type: true, amount: true },
    });

    let computed = 0;
    for (const entry of entries) {
      const debit = entry.type === LedgerEntryType.DEBIT ? Number(entry.amount) : 0;
      const credit = entry.type === LedgerEntryType.CREDIT ? Number(entry.amount) : 0;
      computed = computeLedgerBalance(computed, debit, credit);
    }

    const stored = Number(ledger.balance);
    if (Math.abs(stored - computed) >= 0.01) {
      drift.push({
        accountId: ledger.accountId,
        accountName: ledger.account.name,
        storedBalance: roundMoney(stored),
        computedBalance: roundMoney(computed),
      });
    }
  }

  return drift;
}

async function verifyClosingSnapshotTrialBalances(db: DbClient) {
  const closedYears = await db.financialYear.findMany({
    where: { status: 'CLOSED' },
    select: { id: true, label: true },
    orderBy: { startDate: 'asc' },
  });

  const results: LedgerIntegrityReport['closingSnapshotTrialBalance'] = [];
  for (const year of closedYears) {
    const snapshots = await db.financialYearClosingBalance.findMany({
      where: { financialYearId: year.id },
      select: { balance: true },
    });
    let totalDebit = 0;
    let totalCredit = 0;
    for (const snap of snapshots) {
      const { debit, credit } = trialBalanceFromSignedBalance(Number(snap.balance));
      totalDebit += debit;
      totalCredit += credit;
    }
    results.push({
      financialYearId: year.id,
      label: year.label,
      totalDebit: roundMoney(totalDebit),
      totalCredit: roundMoney(totalCredit),
      isBalanced: isTrialBalanceBalanced(totalDebit, totalCredit),
    });
  }
  return results;
}

/** Full debit/credit integrity audit — safe to run after FY changes or bulk posting. */
export async function verifyLedgerIntegrity(db: DbClient = prisma): Promise<LedgerIntegrityReport> {
  const ledgers = await db.ledger.findMany({ select: { balance: true } });
  let totalDebit = 0;
  let totalCredit = 0;
  for (const ledger of ledgers) {
    const { debit, credit } = trialBalanceFromSignedBalance(Number(ledger.balance));
    totalDebit += debit;
    totalCredit += credit;
  }
  totalDebit = roundMoney(totalDebit);
  totalCredit = roundMoney(totalCredit);

  const globalActiveEntryTotals = await sumActiveEntryTotals(db);
  const ledgerDrift = await findLedgerBalanceDrift(db);
  const unbalancedVouchers = await findUnbalancedActiveVouchers(db);
  const closingSnapshotTrialBalance = await verifyClosingSnapshotTrialBalances(db);

  const trialBalanced = isTrialBalanceBalanced(totalDebit, totalCredit);
  const entriesBalanced = isTrialBalanceBalanced(
    globalActiveEntryTotals.totalDebit,
    globalActiveEntryTotals.totalCredit,
  );
  const closingSnapshotIssues = closingSnapshotTrialBalance
    .filter((row) => !row.isBalanced)
    .map((row) => ({
      financialYearId: row.financialYearId,
      label: row.label,
      totalDebit: row.totalDebit,
      totalCredit: row.totalCredit,
      difference: roundMoney(row.totalDebit - row.totalCredit),
    }));

  return {
    ok:
      trialBalanced &&
      entriesBalanced &&
      ledgerDrift.length === 0 &&
      unbalancedVouchers.length === 0,
    trialBalance: {
      totalDebit,
      totalCredit,
      isBalanced: trialBalanced,
      difference: roundMoney(totalDebit - totalCredit),
    },
    globalActiveEntryTotals: {
      ...globalActiveEntryTotals,
      isBalanced: entriesBalanced,
      difference: roundMoney(globalActiveEntryTotals.totalDebit - globalActiveEntryTotals.totalCredit),
    },
    ledgerDrift,
    unbalancedVouchers,
    closingSnapshotTrialBalance,
    closingSnapshotIssues,
  };
}

/** SQL equivalent for manual DB inspection (SQLite). */
export const LEDGER_INTEGRITY_SQL = `
-- Trial balance from live ledger balances (debit column vs credit column)
SELECT
  SUM(CASE WHEN balance > 0 THEN balance ELSE 0 END) AS total_debit,
  SUM(CASE WHEN balance < 0 THEN ABS(balance) ELSE 0 END) AS total_credit,
  SUM(CASE WHEN balance > 0 THEN balance ELSE 0 END)
    - SUM(CASE WHEN balance < 0 THEN ABS(balance) ELSE 0 END) AS difference
FROM Ledger;

-- Active voucher + opening-balance entry totals (must also tie out)
SELECT
  SUM(CASE WHEN le.type = 'DEBIT' THEN le.amount ELSE 0 END) AS total_debit,
  SUM(CASE WHEN le.type = 'CREDIT' THEN le.amount ELSE 0 END) AS total_credit
FROM LedgerEntry le
LEFT JOIN Voucher v ON v.id = le.voucherId
WHERE le.isReversal = 0
  AND (
    (le.isOpeningBalance = 1 AND le.voucherId IS NULL)
    OR (v.status = 'ACTIVE')
  );
`;
