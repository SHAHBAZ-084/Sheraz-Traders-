/**
 * Run ledger debit/credit integrity verification against the configured database.
 *
 * Usage (from repo root):
 *   npx tsx backend/scripts/verify-ledger-integrity.ts
 */
import { verifyLedgerIntegrity, LEDGER_INTEGRITY_SQL } from '../src/modules/accounting/ledger-integrity';

async function main() {
  const report = await verifyLedgerIntegrity();

  console.log('=== Ledger Integrity Report ===');
  console.log(JSON.stringify(report, null, 2));
  console.log('\n=== Manual SQL (SQLite) ===');
  console.log(LEDGER_INTEGRITY_SQL);

  if (!report.ok) {
    process.exitCode = 1;
    console.error('\nFAILED: ledger debit/credit integrity check');
  } else {
    console.log('\nOK: total debits equal total credits');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
