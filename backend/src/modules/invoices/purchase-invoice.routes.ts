import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../../utils/helpers';
import * as purchaseInvoiceService from './purchase-invoice.service';

const lineSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().positive(),
  rate: z.number().min(0),
  mazduriAmount: z.number().min(0).optional(),
});

const createSchema = z.object({
  invoiceDate: z.string().min(1),
  billNo: z.string().optional(),
  notes: z.string().optional(),
  storeId: z.number().int().positive(),
  supplierAccountId: z.number().int().positive(),
  paymentAmount: z.number().min(0).optional(),
  paymentAccountId: z.number().int().positive().optional(),
  lines: z.array(lineSchema).min(1),
});

const previewSchema = z.object({
  lines: z.array(lineSchema).min(1),
});

export function registerPurchaseInvoiceRoutes(router: Router) {
  router.get(
    '/purchase-invoice/next-reference',
    asyncHandler(async (_req, res) => {
      res.json({ reference: await purchaseInvoiceService.getNextPurchaseInvoiceReference() });
    }),
  );

  router.post(
    '/purchase-invoice/preview',
    validateBody(previewSchema),
    asyncHandler(async (req, res) => {
      res.json(purchaseInvoiceService.previewPurchaseInvoiceTotals(req.body.lines));
    }),
  );

  router.post(
    '/purchase-invoice',
    validateBody(createSchema),
    asyncHandler(async (req, res) => {
      const invoice = await purchaseInvoiceService.createPurchaseInvoice(
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
