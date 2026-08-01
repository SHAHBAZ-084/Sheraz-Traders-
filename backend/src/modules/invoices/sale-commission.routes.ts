import { Router } from 'express';
import { BoriThelaMode } from '@prisma/client';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../utils/helpers';
import * as saleCommissionService from './sale-commission.service';

const lineSchema = z.object({
  partyAccountId: z.number().int().positive(),
  jins: z.string().optional(),
  qism: z.string().optional(),
  boriOrThelaMode: z.nativeEnum(BoriThelaMode),
  bagCount: z.number().min(0),
  bhartii: z.number().min(0),
  dharanCount: z.number().min(0),
  looseKg: z.number().min(0),
  ratePerMaund: z.number().positive(),
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
  munshianaAmount: z.number().min(0).optional(),
  miscAmount: z.number().min(0).optional(),
  lowerBardanaMode: z.nativeEnum(BoriThelaMode).nullable().optional(),
  lowerBardanaQty: z.number().min(0).nullable().optional(),
  lowerBardanaRate: z.number().min(0).nullable().optional(),
  lines: z.array(lineSchema).min(1),
});

const previewSchema = z.object({
  lines: z.array(lineSchema),
  munshianaAmount: z.number().min(0).optional(),
  miscAmount: z.number().min(0).optional(),
  lowerBardanaQty: z.number().min(0).nullable().optional(),
  lowerBardanaRate: z.number().min(0).nullable().optional(),
});

export function registerSaleCommissionRoutes(router: Router) {
  router.get(
    '/sale-commission/next-reference',
    asyncHandler(async (_req, res) => {
      res.json(await saleCommissionService.getNextSaleCommissionReference());
    }),
  );

  router.post(
    '/sale-commission/preview',
    validateBody(previewSchema),
    asyncHandler(async (req, res) => {
      res.json(await saleCommissionService.previewSaleCommissionTotals(req.body));
    }),
  );

  router.post(
    '/sale-commission',
    validateBody(createSchema),
    asyncHandler(async (req, res) => {
      const invoice = await saleCommissionService.createSaleCommissionInvoice({
        ...req.body,
        createdById: req.session.userId!,
      }, { postImmediately: req.user?.role === 'ADMIN' });
      res.status(201).json(invoice);
    }),
  );
}
