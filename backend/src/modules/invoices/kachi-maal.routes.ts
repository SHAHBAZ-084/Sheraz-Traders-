import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../utils/helpers';
import * as kachiMaalService from './kachi-maal.service';

const lineSchema = z.object({
  partyAccountId: z.number().int().positive(),
  jins: z.string().optional(),
  qism: z.string().optional(),
  bagCount: z.number().min(0),
  bhartii: z.number().positive(),
  dharanCount: z.number().min(0),
  looseKg: z.number().min(0),
  ratePerMaund: z.number().positive(),
});

const createSchema = z.object({
  invoiceDate: z.string().min(1),
  billNo: z.string().optional(),
  gariNo: z.string().optional(),
  jins: z.string().optional(),
  qism: z.string().optional(),
  tafseel: z.string().optional(),
  debitAccountId: z.number().int().positive(),
  miscAmount: z.number().min(0).optional(),
  lines: z.array(lineSchema).min(1),
});

const previewSchema = z.object({
  lines: z.array(lineSchema),
  miscAmount: z.number().min(0).optional(),
});

export function registerKachiMaalRoutes(router: Router) {
  router.get(
    '/kachi-maal/next-reference',
    asyncHandler(async (_req, res) => {
      res.json(await kachiMaalService.getNextKachiMaalReference());
    }),
  );

  router.post(
    '/kachi-maal/preview',
    validateBody(previewSchema),
    asyncHandler(async (req, res) => {
      res.json(await kachiMaalService.previewKachiMaalTotals(req.body));
    }),
  );

  router.post(
    '/kachi-maal',
    validateBody(createSchema),
    asyncHandler(async (req, res) => {
      const invoice = await kachiMaalService.createKachiMaalInvoice({
        ...req.body,
        createdById: req.session.userId!,
      }, { postImmediately: req.user?.role === 'ADMIN' });
      res.status(201).json(invoice);
    }),
  );
}
