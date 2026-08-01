import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../utils/helpers';
import * as saleInvoiceService from './sale-invoice.service';

const lineSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().positive(),
  rate: z.number().min(0),
});

const createSchema = z.object({
  invoiceDate: z.string().min(1),
  billNo: z.string().optional(),
  notes: z.string().optional(),
  storeId: z.number().int().positive(),
  customerAccountId: z.number().int().positive(),
  lines: z.array(lineSchema).min(1),
});

const previewSchema = z.object({
  lines: z.array(lineSchema).min(1),
});

export function registerSaleInvoiceRoutes(router: Router) {
  router.get(
    '/sale-invoice/next-reference',
    asyncHandler(async (_req, res) => {
      res.json({ reference: await saleInvoiceService.getNextSaleInvoiceReference() });
    }),
  );

  router.post(
    '/sale-invoice/preview',
    validateBody(previewSchema),
    asyncHandler(async (req, res) => {
      res.json(saleInvoiceService.previewSaleInvoiceTotals(req.body.lines));
    }),
  );

  router.post(
    '/sale-invoice',
    validateBody(createSchema),
    asyncHandler(async (req, res) => {
      const invoice = await saleInvoiceService.createSaleInvoice(
        {
          ...req.body,
          createdById: req.session.userId!,
        },
        { postImmediately: req.user?.role === 'ADMIN' },
      );
      res.status(201).json(invoice);
    }),
  );
}
