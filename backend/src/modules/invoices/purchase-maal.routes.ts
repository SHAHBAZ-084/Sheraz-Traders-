import { Router } from 'express';
import { BoriThelaMode } from '@prisma/client';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../utils/helpers';
import * as purchaseMaalService from './purchase-maal.service';

const lineSchema = z.object({
  partyAccountId: z.number().int().positive(),
  jins: z.string().optional(),
  qism: z.string().optional(),
  boriOrThelaMode: z.nativeEnum(BoriThelaMode),
  bagCount: z.number().min(0),
  bhartii: z.number().positive(),
  dharanCount: z.number().min(0),
  looseKg: z.number().min(0),
  ratePerMaund: z.number().positive(),
  bardanaQty: z.number().min(0).nullable().optional(),
  bardanaRate: z.number().min(0).nullable().optional(),
  dammiChecked: z.boolean().optional(),
});

const createSchema = z.object({
  invoiceDate: z.string().min(1),
  productId: z.number().int().positive(),
  billNo: z.string().optional(),
  gariNo: z.string().optional(),
  jins: z.string().optional(),
  qism: z.string().optional(),
  tafseel: z.string().optional(),
  marketFeeEnabled: z.boolean().optional(),
  mazduriEnabled: z.boolean().optional(),
  lowerBardanaMode: z.nativeEnum(BoriThelaMode).nullable().optional(),
  lowerBardanaQty: z.number().min(0).nullable().optional(),
  lowerBardanaRate: z.number().min(0).nullable().optional(),
  lines: z.array(lineSchema).min(1),
});

const previewSchema = z.object({
  lines: z.array(lineSchema),
  marketFeeEnabled: z.boolean().optional(),
  mazduriEnabled: z.boolean().optional(),
  lowerBardanaQty: z.number().min(0).nullable().optional(),
  lowerBardanaRate: z.number().min(0).nullable().optional(),
});

export function registerPurchaseMaalRoutes(router: Router) {
  router.get(
    '/purchase-maal/next-reference',
    asyncHandler(async (_req, res) => {
      res.json(await purchaseMaalService.getNextPurchaseMaalReference());
    }),
  );

  router.post(
    '/purchase-maal/preview',
    validateBody(previewSchema),
    asyncHandler(async (req, res) => {
      res.json(await purchaseMaalService.previewPurchaseMaalTotals(req.body));
    }),
  );

  router.post(
    '/purchase-maal',
    validateBody(createSchema),
    asyncHandler(async (req, res) => {
      const invoice = await purchaseMaalService.createPurchaseMaalInvoice({
        ...req.body,
        createdById: req.session.userId!,
      }, { postImmediately: req.user?.role === 'ADMIN' });
      res.status(201).json(invoice);
    }),
  );
}
