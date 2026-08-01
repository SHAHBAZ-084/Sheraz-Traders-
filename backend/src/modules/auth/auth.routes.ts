import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
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
