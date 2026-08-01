import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler, param, validateBody } from '../../utils/helpers';
import * as storesService from './stores.service';

export const storesRouter = Router();
storesRouter.use(requireAuth);

storesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(await storesService.listStores());
  }),
);

storesRouter.get(
  '/active',
  asyncHandler(async (_req, res) => {
    res.json(await storesService.listActiveStores());
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
