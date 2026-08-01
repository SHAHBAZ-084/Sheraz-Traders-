import { describe, expect, it } from 'vitest';
import {
  bootstrapChartOfAccounts,
  createAccount,
  getLedgerEntries,
  getTrialBalance,
} from './accounting.service';

describe('opening balance ledger report (Part 8 regression)', () => {
  it('shows opening balance row and closing balance matches trial balance', async () => {
    await bootstrapChartOfAccounts();

    const expenseCat = await import('../../lib/prisma').then(({ prisma }) =>
      prisma.accountCategory.findFirst({ where: { name: 'Expenses' } }),
    );
    if (!expenseCat) throw new Error('Expenses category missing');

    const uniqueName = `OB Ledger Test ${Date.now()}`;
    const account = await createAccount({
      categoryId: expenseCat.id,
      name: uniqueName,
      openingBalance: 50000,
      openingBalanceSide: 'DR',
    });

    expect(account.ledger).toBeTruthy();
    expect(Number(account.ledger!.balance)).toBe(50000);

    const trialBalance = await getTrialBalance();
    const tbRow = trialBalance.accounts.find((a) => a.accountId === account.id);
    expect(tbRow).toBeTruthy();
    expect(tbRow!.balance).toBe(50000);

    const ledgerReport = await getLedgerEntries(account.id);
    const openingRow = ledgerReport.rows.find((r) => r.type === 'Opening Balance');
    expect(openingRow).toBeTruthy();
    expect(openingRow!.debit).toBe(50000);
    expect(openingRow!.voucherNo).toBe('0');
    expect(ledgerReport.rows[0]?.type).toBe('Opening Balance');

    expect(ledgerReport.balance).toBeCloseTo(tbRow!.balance, 2);
    expect(ledgerReport.summary.closingBalance).toBeCloseTo(tbRow!.balance, 2);
  });
});
