import { JamaNaamDirection } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../../middleware/auth';
import { asyncHandler, param } from '../../utils/helpers';
import * as jamaNaamService from './jama-naam.service';

export const jamaNaamRouter = Router();
jamaNaamRouter.use(requireAuth);

jamaNaamRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(await jamaNaamService.listJamaNaamEntries());
  }),
);

jamaNaamRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        partyId: z.number().int().positive(),
        productId: z.number().int().positive().optional().nullable(),
        quantity: z.number().positive().optional().nullable(),
        amount: z.number().positive().optional().nullable(),
        direction: z.nativeEnum(JamaNaamDirection),
        date: z.string().min(1),
        notes: z.string().optional().nullable(),
      })
      .parse(req.body);

    const entry = await jamaNaamService.createJamaNaamEntry(body);
    res.status(201).json(entry);
  }),
);

jamaNaamRouter.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await jamaNaamService.settleJamaNaamEntry(parseInt(param(req.params.id), 10));
    res.json({ ok: true });
  }),
);
