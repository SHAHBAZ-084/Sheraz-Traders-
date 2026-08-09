import { describe, expect, it } from 'vitest';
import { verifyLedgerIntegrity } from './ledger-integrity';

describe('verifyLedgerIntegrity', () => {
  it('reports balanced trial balance and active entry totals on current database', async () => {
    const report = await verifyLedgerIntegrity();

    expect(report.trialBalance.isBalanced).toBe(true);
    expect(Math.abs(report.trialBalance.difference)).toBeLessThan(0.01);
    expect(report.globalActiveEntryTotals.isBalanced).toBe(true);
    expect(Math.abs(report.globalActiveEntryTotals.difference)).toBeLessThan(0.01);
    expect(report.ledgerDrift).toEqual([]);
    expect(report.unbalancedVouchers).toEqual([]);
    expect(report.ok).toBe(true);
  });
});
