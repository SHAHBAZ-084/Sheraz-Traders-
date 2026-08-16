import { AccountType } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAccount } from '../modules/accounting/accounting.service';
import { prisma } from './prisma';
import { generateNextAccountCode, maxNumericAccountCode } from './account-code';

describe('account code generation', () => {
  let categoryId: number;
  const createdCodes: string[] = [];

  beforeAll(async () => {
    const category = await prisma.accountCategory.findFirst({
      where: { isActive: true, name: 'Expenses' },
    });
    if (!category) throw new Error('Expenses category missing');
    categoryId = category.id;
  });

  afterAll(async () => {
    if (createdCodes.length === 0) return;
    await prisma.account.deleteMany({ where: { code: { in: createdCodes } } });
  });

  it('ignores non-numeric codes and uses parseInt semantics for digits', async () => {
    const stamp = Date.now();
    const beforeMax = await maxNumericAccountCode(prisma);
    const sevenCode = String(beforeMax + 7).padStart(3, '0');
    const nineCode = String(beforeMax + 9);
    const tenCode = String(beforeMax + 10);
    const alphaCode = `ACC-CODE-TEST-A-${stamp}`;

    createdCodes.push(alphaCode, sevenCode, nineCode, tenCode);

    await prisma.account.createMany({
      data: [
        { categoryId, name: `Alpha ${stamp}`, code: alphaCode, type: AccountType.EXPENSE },
        { categoryId, name: `Seven ${stamp}`, code: sevenCode, type: AccountType.EXPENSE },
        { categoryId, name: `Nine ${stamp}`, code: nineCode, type: AccountType.EXPENSE },
        { categoryId, name: `Ten ${stamp}`, code: tenCode, type: AccountType.EXPENSE },
      ],
    });

    const max = await maxNumericAccountCode(prisma);
    expect(max).toBeGreaterThanOrEqual(beforeMax + 10);

    const next = await generateNextAccountCode(prisma);
    expect(/^\d+$/.test(next)).toBe(true);
    expect(parseInt(next, 10)).toBe(max + 1);
  });

  it('allocates distinct auto codes under parallel account creates', async () => {
    const stamp = Date.now();
    const created = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        createAccount({
          categoryId,
          name: `Parallel code test ${stamp}-${i}`,
        }),
      ),
    );
    createdCodes.push(...created.map((a) => a.code));
    const codes = created.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
