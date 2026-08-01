import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';

export async function listStores() {
  return prisma.store.findMany({
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  });
}

export async function listActiveStores() {
  return prisma.store.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  });
}

export async function createStore(nameInput: string) {
  const name = nameInput.trim();
  if (!name) throw new AppError(400, 'Store name is required');

  const existing = await prisma.store.findFirst({
    where: { name: { equals: name } },
  });
  if (existing) {
    if (existing.isActive) throw new AppError(400, `Store "${existing.name}" already exists`);
    return prisma.store.update({
      where: { id: existing.id },
      data: { isActive: true },
    });
  }

  try {
    return await prisma.store.create({ data: { name } });
  } catch {
    throw new AppError(400, `Store "${name}" already exists`);
  }
}

export async function setStoreActive(id: number, isActive: boolean) {
  const store = await prisma.store.findUnique({ where: { id } });
  if (!store) throw new AppError(404, 'Store not found');
  return prisma.store.update({
    where: { id },
    data: { isActive },
  });
}

export async function assertActiveStore(storeId: number) {
  const store = await prisma.store.findFirst({
    where: { id: storeId, isActive: true },
  });
  if (!store) throw new AppError(400, 'Select an active store');
  return store;
}
