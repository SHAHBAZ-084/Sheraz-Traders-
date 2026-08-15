import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { createStore, deleteStoreWithReversal, getStoreDeletionSummary } from './stores.service';

describe('Stores module integration & reversal test', () => {
  let userId: number;

  beforeAll(async () => {
    const adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    if (!adminUser) throw new Error('Admin user required for test');
    userId = adminUser.id;
  });

  it('creates and physically deletes a store with summary verification', async () => {
    const store = await createStore('Test Temporary Godown');
    expect(store.id).toBeDefined();

    const summary = await getStoreDeletionSummary(store.id);
    expect(summary.store.name).toBe('Test Temporary Godown');
    expect(summary.totalLinkedRecords).toBe(0);

    const deleted = await deleteStoreWithReversal(store.id, userId);
    expect(deleted.id).toBe(store.id);

    const found = await prisma.store.findUnique({ where: { id: store.id } });
    expect(found).toBeNull();
  });
});
