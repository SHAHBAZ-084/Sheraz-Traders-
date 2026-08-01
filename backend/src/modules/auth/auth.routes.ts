import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../../middleware/auth';
import { asyncHandler, validateBody } from '../../utils/helpers';
import * as authService from './auth.service';

export const authRouter = Router();

authRouter.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body as { username?: string; password?: string };

    if (!username?.trim() || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    const user = await authService.login(username.trim(), password);

    if (!user) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    req.session.userId = user.id;
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/logout', requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await authService.getUserById(req.session.userId!);

    if (!user) {
      req.session.destroy(() => {
        res.status(401).json({ error: 'Not authenticated' });
      });
      return;
    }

    res.json({ user });
  } catch (error) {
    next(error);
  }
});

authRouter.get(
  '/users',
  requireAuth,
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json(await authService.listUsers());
  }),
);

authRouter.post(
  '/users',
  requireAuth,
  requireAdmin,
  validateBody(
    z.object({
      username: z.string().min(1),
      password: z.string().min(4),
      displayName: z.string().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const user = await authService.createUser(req.body);
    res.status(201).json({ user });
  }),
);
