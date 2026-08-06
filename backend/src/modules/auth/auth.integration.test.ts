import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { createUser, deleteUser } from './auth.service';

describe('User management & hard delete integration test', () => {
  let adminId: number;

  beforeAll(async () => {
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    if (!admin) throw new Error('Admin user required');
    adminId = admin.id;
  });

  it('creates a user and hard deletes the user', async () => {
    const testUsername = `testuser_${Date.now()}`;
    const created = await createUser({
      username: testUsername,
      password: 'password123',
      displayName: 'Test Clerk',
    });

    expect(created.id).toBeDefined();

    // Verify self-delete rejection
    await expect(deleteUser(adminId, adminId)).rejects.toThrow('Cannot delete your own account');

    // Perform delete of created user
    const deleted = await deleteUser(created.id, adminId);
    expect(deleted.id).toBe(created.id);

    const check = await prisma.user.findUnique({ where: { id: created.id } });
    expect(check).toBeNull();
  });
});
