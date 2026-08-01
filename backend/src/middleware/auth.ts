import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';

export type AuthUser = {
  id: number;
  username: string;
  displayName: string;
  role: Role;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.session.userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: req.session.userId } });
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    req.user = {
      id: user.id,
      username: user.username,
      displayName: user.displayName ?? user.username,
      role: user.role,
    };
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'ADMIN') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

/** USER role is blocked from reports; same gate as admin for now. */
export const requireReportsAccess = requireAdmin;
