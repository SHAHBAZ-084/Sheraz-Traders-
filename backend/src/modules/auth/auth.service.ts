import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma';

export async function login(username: string, password: string) {
  const user = await prisma.user.findUnique({ where: { username } });

  if (!user) {
    return null;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return null;
  }

  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName ?? user.username,
  };
}

export async function getUserById(id: number) {
  const user = await prisma.user.findUnique({ where: { id } });

  if (!user) {
    return null;
  }

  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName ?? user.username,
  };
}
