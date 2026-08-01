import { Router } from 'express';
import { BoriThelaMode } from '@prisma/client';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../utils/helpers';
import * as salePaunchService from './sale-paunch.service';

const lineSchema = z.object({
  maalKhataAccountId: z.number().int().positive(),
  jins: z.string().optional(),
  qism: z.string().optional(),
  boriOrThelaMode: z.nativeEnum(BoriThelaMode),
  bagCount: z.number().min(0),
  thelaCount: z.number().min(0).optional(),
  compWeightKg: z.number().positive(),
  kaatKg: z.number().min(0).optional(),
  lowerKaatKg: z.number().min(0).optional(),
  upperRatePerMaund: z.number().positive(),
  lowerRatePerMaund: z.number().positive(),
  kanta: z.number().min(0).optional(),
  bardanaQty: z.number().min(0).nullable().optional(),
  bardanaRate: z.number().min(0).nullable().optional(),
  dammiChecked: z.boolean().optional(),
});

const createSchema = z.object({
  invoiceDate: z.string().min(1),
  salePartyAccountId: z.number().int().positive(),
  billNo: z.string().optional(),
  gariNo: z.string().optional(),
  jins: z.string().optional(),
  qism: z.string().optional(),
  tafseel: z.string().optional(),
  taxAmount: z.number().min(0).optional(),
  biltyKirayaAmount: z.number().min(0).optional(),
  miscAmount: z.number().min(0).optional(),
  lowerBardanaMode: z.nativeEnum(BoriThelaMode).nullable().optional(),
  lowerBardanaQty: z.number().min(0).nullable().optional(),
  lowerBardanaRate: z.number().min(0).nullable().optional(),
  lines: z.array(lineSchema).min(1),
});

const previewSchema = z.object({
  lines: z.array(lineSchema),
  taxAmount: z.number().min(0).optional(),
  biltyKirayaAmount: z.number().min(0).optional(),
  miscAmount: z.number().min(0).optional(),
  kaatEnabled: z.boolean().optional(),
  lowerBardanaQty: z.number().min(0).nullable().optional(),
  lowerBardanaRate: z.number().min(0).nullable().optional(),
});

export function registerSalePaunchRoutes(router: Router) {
  router.get(
    '/sale-paunch/next-reference',
    asyncHandler(async (_req, res) => {
      res.json(await salePaunchService.getNextSalePaunchReference());
    }),
  );

  router.post(
    '/sale-paunch/preview',
    validateBody(previewSchema),
    asyncHandler(async (req, res) => {
      res.json(await salePaunchService.previewSalePaunchTotals(req.body));
    }),
  );

  router.post(
    '/sale-paunch',
    validateBody(createSchema),
    asyncHandler(async (req, res) => {
      const invoice = await salePaunchService.createSalePaunchInvoice({
        ...req.body,
        createdById: req.session.userId!,
      });
      res.status(201).json(invoice);
    }),
  );
}
