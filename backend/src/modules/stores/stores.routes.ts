import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../../middleware/auth';
import { asyncHandler, AppError, param, validateBody } from '../../utils/helpers';
import { verifyUserPassword } from '../auth/auth.service';
import { parsePagination, SELECTOR_PAGINATION } from '../../utils/pagination';
import * as storesService from './stores.service';

export const storesRouter = Router();
storesRouter.use(requireAuth);

storesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await storesService.listStores(parsePagination(req.query, SELECTOR_PAGINATION)));
  }),
);

storesRouter.get(
  '/active',
  asyncHandler(async (req, res) => {
    res.json(await storesService.listActiveStores(parsePagination(req.query, SELECTOR_PAGINATION)));
  }),
);

storesRouter.get(
  '/:id/deletion-summary',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const summary = await storesService.getStoreDeletionSummary(
      parseInt(param(req.params.id), 10),
    );
    res.json(summary);
  }),
);

storesRouter.post(
  '/',
  validateBody(z.object({ name: z.string().min(1) })),
  asyncHandler(async (req, res) => {
    const store = await storesService.createStore(req.body.name);
    res.status(201).json(store);
  }),
);

storesRouter.patch(
  '/:id',
  validateBody(z.object({ isActive: z.boolean() })),
  asyncHandler(async (req, res) => {
    const store = await storesService.setStoreActive(
      parseInt(param(req.params.id), 10),
      req.body.isActive,
    );
    res.json(store);
  }),
);

storesRouter.delete(
  '/:id',
  requireAdmin,
  validateBody(z.object({ confirmPassword: z.string().min(1) })),
  asyncHandler(async (req, res) => {
    const storeId = parseInt(param(req.params.id), 10);
    const isValidPassword = await verifyUserPassword(req.session.userId!, req.body.confirmPassword);
    if (!isValidPassword) {
      throw new AppError(401, 'Invalid password. Store deletion requires valid admin password.');
    }
    const result = await storesService.deleteStoreWithReversal(storeId, req.session.userId!);
    res.json(result);
  }),
);
