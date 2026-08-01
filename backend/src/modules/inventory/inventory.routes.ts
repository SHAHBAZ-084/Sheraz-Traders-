import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireReportsAccess } from '../../middleware/auth';
import { asyncHandler, validateBody } from '../../utils/helpers';
import * as bardanaService from './bardana.service';

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth);

inventoryRouter.get(
  '/bardana',
  requireReportsAccess,
  asyncHandler(async (_req, res) => {
    res.json(await bardanaService.getEmptyBardanaReport());
  }),
);

inventoryRouter.post(
  '/bardana/add',
  validateBody(
    z.object({
      bagType: z.enum(['BORI', 'THELA']),
      quantity: z.number().positive(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.status(201).json(await bardanaService.addEmptyBardana(req.body));
  }),
);
