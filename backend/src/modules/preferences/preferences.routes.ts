import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler, validateBody } from '../../utils/helpers';
import * as preferencesService from './preferences.service';

export const preferencesRouter = Router();
preferencesRouter.use(requireAuth);

const percentField = z.number().min(0).optional();
const rateField = z.number().min(0).optional();

const updateSchema = z.object({
  daamiPercent: percentField,
  paleDariPercent: percentField,
  brokeryPercent: percentField,
  marketFeeRate: rateField,
  bardanaRate: rateField,
  taxPercent: percentField,
  kaatPercent: percentField,
  mazduriPercent: percentField,
  commissionPercent: percentField,
  dalaliPercent: percentField,
  sutliRate: rateField,
  markeetFeeRate: rateField,
  mazduriPerBagRate: rateField,
  kantaRate: rateField,
  closingDate: z.string().nullable().optional(),
});

preferencesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(await preferencesService.getSystemPreferences());
  }),
);

preferencesRouter.patch(
  '/',
  validateBody(updateSchema),
  asyncHandler(async (req, res) => {
    res.json(await preferencesService.updateSystemPreferences(req.body));
  }),
);
