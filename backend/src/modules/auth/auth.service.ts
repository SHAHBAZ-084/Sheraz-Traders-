import bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';

function toAuthUser(user: {
  id: number;
  username: string;
  displayName: string | null;
  role: Role;
}) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName ?? user.username,
    role: user.role,
  };
}

export async function login(username: string, password: string) {
  const cleanUsername = username.trim();
  let user = await prisma.user.findUnique({ where: { username: cleanUsername } });

  if (!user) {
    const cleanLower = cleanUsername.toLowerCase();
    const candidates = await prisma.user.findMany({ take: 100 });
    user = candidates.find((u) => u.username.trim().toLowerCase() === cleanLower) ?? null;
  }

  if (!user) {
    return null;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return null;
  }

  return toAuthUser(user);
}

export async function getUserById(id: number) {
  const user = await prisma.user.findUnique({ where: { id } });

  if (!user) {
    return null;
  }

  return toAuthUser(user);
}

export async function verifyUserPassword(id: number, password: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return false;
  return bcrypt.compare(password, user.passwordHash);
}

export async function changeOwnPassword(userId: number, currentPassword: string, newPassword: string) {
  if (!currentPassword) {
    throw new AppError(400, 'Current password is required');
  }
  if (!newPassword || newPassword.length < 4) {
    throw new AppError(400, 'Password must be at least 4 characters');
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new AppError(404, 'User not found');
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    throw new AppError(400, 'Current password is incorrect');
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });
}

export async function listUsers() {
  const users = await prisma.user.findMany({
    orderBy: { username: 'asc' },
    select: {
      id: true,
      username: true,
      displayName: true,
      role: true,
      createdAt: true,
    },
  });

  return users.map((user) => ({
    id: user.id,
    username: user.username,
    displayName: user.displayName ?? user.username,
    role: user.role,
    createdAt: user.createdAt,
  }));
}

export async function createUser(data: {
  username: string;
  password: string;
  displayName?: string;
}) {
  const username = data.username.trim();
  if (!username) {
    throw new AppError(400, 'Username is required');
  }
  if (!data.password || data.password.length < 4) {
    throw new AppError(400, 'Password must be at least 4 characters');
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    throw new AppError(400, 'Username already exists');
  }

  const passwordHash = await bcrypt.hash(data.password, 10);
  const user = await prisma.user.create({
    data: {
      username,
      passwordHash,
      displayName: data.displayName?.trim() || username,
      role: Role.USER,
    },
  });

  return toAuthUser(user);
}

export async function deleteUser(userIdToDelete: number, requestingAdminId: number) {
  if (userIdToDelete === requestingAdminId) {
    throw new AppError(400, 'Cannot delete your own account');
  }

  const userToDelete = await prisma.user.findUnique({ where: { id: userIdToDelete } });
  if (!userToDelete) {
    throw new AppError(404, 'User not found');
  }

  if (userToDelete.role === Role.ADMIN) {
    const adminCount = await prisma.user.count({ where: { role: Role.ADMIN } });
    if (adminCount <= 1) {
      throw new AppError(400, 'Cannot delete the last remaining ADMIN account');
    }
  }

  return prisma.$transaction(async (tx) => {
    await tx.voucher.updateMany({
      where: { createdById: userIdToDelete },
      data: { createdById: requestingAdminId },
    });
    await tx.voucher.updateMany({
      where: { modifiedById: userIdToDelete },
      data: { modifiedById: null },
    });
    await tx.voucher.updateMany({
      where: { deletedById: userIdToDelete },
      data: { deletedById: null },
    });

    await tx.invoice.updateMany({
      where: { createdById: userIdToDelete },
      data: { createdById: requestingAdminId },
    });

    await tx.financialYear.updateMany({
      where: { closedById: userIdToDelete },
      data: { closedById: null },
    });

    await tx.trialBalanceApproval.deleteMany({
      where: { approvedById: userIdToDelete },
    });

    return tx.user.delete({ where: { id: userIdToDelete } });
  });
}
