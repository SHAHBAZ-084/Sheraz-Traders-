import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { createAccount, softDeleteAccount } from '../accounting/accounting.service';
import { createProduct, removeProduct } from '../products/products.service';
import { runAccountingMaintenance } from '../accounting/accounting.service';

async function withTimeout<T>(label: string, ms: number, work: () => Promise<T>): Promise<T> {
  return Promise.race([
    work(),
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

describe('delete recovery with single SQLite connection', () => {
  let categoryId = 0;

  beforeAll(async () => {
    const category = await prisma.accountCategory.findFirst({
      where: { isActive: true, NOT: { name: 'Products' } },
    });
    if (!category) throw new Error('no non-product category');
    categoryId = category.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('removes a product then serves follow-up reads without hanging', async () => {
    const product = await createProduct({ name: `DelRecoverProd ${Date.now()}`, unit: 'Kg' });
    await withTimeout('removeProduct', 10_000, () => removeProduct(product.id));

    await withTimeout('listProducts after delete', 10_000, async () => {
      const [rows, total] = await Promise.all([
        prisma.product.findMany({ where: { isActive: true }, take: 5 }),
        prisma.product.count({ where: { isActive: true } }),
      ]);
      expect(total).toBeGreaterThanOrEqual(0);
      expect(rows.every((p) => p.id !== product.id)).toBe(true);
    });
  });

  it('removes an account then serves follow-up reads without hanging', async () => {
    const account = await createAccount({
      categoryId,
      name: `DelRecoverAcct ${Date.now()}`,
    });

    await withTimeout('softDeleteAccount', 10_000, () => softDeleteAccount(account.id));

    await withTimeout('listAccounts after delete', 10_000, async () => {
      const rows = await prisma.account.findMany({ where: { isActive: true }, take: 10 });
      expect(rows.every((a) => a.id !== account.id)).toBe(true);
      expect(await prisma.account.findUnique({ where: { id: account.id } })).toBeNull();
    });
  });

  it('does not deadlock when maintenance runs around delete operations', async () => {
    const maintenance = withTimeout('runAccountingMaintenance', 15_000, () => runAccountingMaintenance());
    const product = await createProduct({ name: `DelRecoverMaint ${Date.now()}`, unit: 'Kg' });
    await withTimeout('removeProduct during maintenance', 15_000, () => removeProduct(product.id));
    const account = await createAccount({
      categoryId,
      name: `DelRecoverMaintAcct ${Date.now()}`,
    });
    await withTimeout('softDeleteAccount during maintenance', 15_000, () => softDeleteAccount(account.id));

    await maintenance;

    await withTimeout('health read after concurrent maintenance', 10_000, async () => {
      const count = await prisma.account.count();
      expect(count).toBeGreaterThan(0);
    });
  });
});
