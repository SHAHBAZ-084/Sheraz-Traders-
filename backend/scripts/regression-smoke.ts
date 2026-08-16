/**
 * Regression smoke: party opening balances + concurrent writes under connection_limit=5 + retry.
 * Usage: npx tsx scripts/regression-smoke.ts
 */
import { AccountType, Role } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { initializeDatabase, shutdownDatabase } from '../src/lib/startup';
import { verifyLedgerIntegrity } from '../src/modules/accounting/ledger-integrity';
import {
  createAccount,
  getTrialBalance,
} from '../src/modules/accounting/accounting.service';
import { createSaleParty, createPurchaseParty } from '../src/modules/parties/parties.service';
import { createPurchaseInvoice } from '../src/modules/invoices/purchase-invoice.service';
import { createSaleInvoice } from '../src/modules/invoices/sale-invoice.service';
import { createProduct } from '../src/modules/products/products.service';
import { createStore } from '../src/modules/stores/stores.service';
import { voucherDateInActiveYear } from '../src/test-helpers/financial-year';

async function main() {
  const started = Date.now();
  console.log('Initializing database…');
  const startup = await initializeDatabase(prisma);
  if (!startup.ok) {
    console.error('Database not ready', startup);
    process.exit(1);
  }

  const stamp = Date.now();
  const invoiceDate = await voucherDateInActiveYear();
  const admin = await prisma.user.findFirst({ where: { role: Role.ADMIN } });
  if (!admin) throw new Error('Admin user required — run db:seed first');

  // --- Party opening balances ---
  console.log('Creating Sale Party with OB 15000 Dr…');
  const saleParty = await createSaleParty({
    name: `Regress Sale OB ${stamp}`,
    openingBalance: 15000,
    openingBalanceSide: 'DR',
  });
  if (Math.abs(saleParty.balance - 15000) > 0.01) {
    throw new Error(`Sale party OB mismatch: expected 15000, got ${saleParty.balance}`);
  }

  console.log('Creating Purchase Party with OB 8000 Cr…');
  const purchaseParty = await createPurchaseParty({
    name: `Regress Purchase OB ${stamp}`,
    openingBalance: 8000,
    openingBalanceSide: 'CR',
  });
  if (Math.abs(purchaseParty.balance - -8000) > 0.01) {
    throw new Error(`Purchase party OB mismatch: expected -8000, got ${purchaseParty.balance}`);
  }

  const blankParty = await createSaleParty({ name: `Regress Sale Blank ${stamp}` });
  if (Math.abs(blankParty.balance) > 0.01) {
    throw new Error(`Blank OB party should be 0, got ${blankParty.balance}`);
  }

  const trial = await getTrialBalance();
  const saleTb = trial.accounts.find((a) => a.accountId === saleParty.id);
  const purchaseTb = trial.accounts.find((a) => a.accountId === purchaseParty.id);
  if (!saleTb || saleTb.balance !== 15000) {
    throw new Error(`Trial balance missing sale party OB (${saleTb?.balance})`);
  }
  if (!purchaseTb || purchaseTb.balance !== -8000) {
    throw new Error(`Trial balance missing purchase party OB (${purchaseTb?.balance})`);
  }
  const equity = trial.accounts.find((a) => a.accountName === 'Opening Balance Equity');
  if (!equity) throw new Error('Opening Balance Equity missing from trial balance');

  // --- Concurrent writes ---
  const store = await createStore(`Regress Store ${stamp}`);
  const product = await createProduct({
    name: `Regress Product ${stamp}`,
    unit: 'Bags',
    openingStock: 100,
    openingStockRate: 500,
    openingStoreId: store.id,
  });

  const bankCat = await prisma.accountCategory.findFirst({ where: { name: 'Bank', isActive: true } });
  if (!bankCat) throw new Error('Bank category missing');

  console.log('Concurrent writes (parallel account creates)…');
  const concurrentCreates = await Promise.allSettled(
    Array.from({ length: 5 }, (_, i) =>
      createAccount({
        categoryId: bankCat.id,
        name: `Regress Bank Parallel ${stamp}-${i}`,
        openingBalance: 2000 + i,
        openingBalanceSide: 'DR',
      }),
    ),
  );
  const parallelFailed = concurrentCreates.filter((r) => r.status === 'rejected');
  if (parallelFailed.length > 0) {
    console.error(
      'Parallel account create failures:',
      parallelFailed.map((f) => (f as PromiseRejectedResult).reason),
    );
    throw new Error(`${parallelFailed.length} parallel account create(s) failed`);
  }

  console.log('Rapid-fire sequential creates (accounts + invoices)…');
  const results: PromiseSettledResult<unknown>[] = [];
  for (let i = 0; i < 5; i += 1) {
    results.push(
      await Promise.allSettled([
        createAccount({
          categoryId: bankCat.id,
          name: `Regress Bank ${stamp}-${i}`,
          openingBalance: 1000 + i,
          openingBalanceSide: 'DR',
        }),
      ]).then((r) => r[0]!),
    );
  }
  for (let i = 0; i < 3; i += 1) {
    results.push(
      await Promise.allSettled([
        createSaleInvoice(
          {
            customerAccountId: saleParty.id,
            storeId: store.id,
            invoiceDate,
            createdById: admin.id,
            lines: [{ productId: product.id, quantity: 1, rate: 600 + i }],
          },
          { postImmediately: true },
        ),
      ]).then((r) => r[0]!),
    );
  }
  for (let i = 0; i < 3; i += 1) {
    results.push(
      await Promise.allSettled([
        createPurchaseInvoice(
          {
            supplierAccountId: purchaseParty.id,
            storeId: store.id,
            invoiceDate,
            createdById: admin.id,
            lines: [
              {
                productId: product.id,
                quantity: 1,
                rate: 400 + i,
                mazduriAmount: i === 0 ? 50 : 0,
              },
            ],
          },
          { postImmediately: true },
        ),
      ]).then((r) => r[0]!),
    );
  }
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length > 0) {
    console.error(
      'Concurrent failures:',
      failed.map((f) => (f as PromiseRejectedResult).reason),
    );
    throw new Error(`${failed.length} concurrent write(s) failed`);
  }

  console.log('Running verifyLedgerIntegrity…');
  const integrity = await verifyLedgerIntegrity();
  if (!integrity.ok) {
    console.error(integrity);
    throw new Error('verifyLedgerIntegrity failed');
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        elapsedMs: Date.now() - started,
        integrityOk: integrity.ok,
        salePartyBalance: saleParty.balance,
        purchasePartyBalance: purchaseParty.balance,
        concurrentOps: results.length,
        trialBalanced: trial.isBalanced,
      },
      null,
      2,
    ),
  );

  await shutdownDatabase(prisma);
}

main().catch(async (err) => {
  console.error(err);
  try {
    await shutdownDatabase(prisma);
  } catch {
    // ignore
  }
  process.exit(1);
});
