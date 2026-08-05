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
  const cleanUsername = username.trim().toLowerCase();
  const users = await prisma.user.findMany();
  const user = users.find((u) => u.username.trim().toLowerCase() === cleanUsername);

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
