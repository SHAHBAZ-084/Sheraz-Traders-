import { Router } from 'express';
import { InvoiceType } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler, param, validateBody } from '../../utils/helpers';
import { parsePagination } from '../../utils/pagination';
import * as invoicesService from './invoices.service';
import { registerKachiMaalRoutes } from './kachi-maal.routes';
import { registerPurchaseInvoiceRoutes } from './purchase-invoice.routes';
import { registerPurchaseMaalRoutes } from './purchase-maal.routes';
import { registerSaleCommissionRoutes } from './sale-commission.routes';
import { registerSaleInvoiceRoutes } from './sale-invoice.routes';
import { registerSalePaunchRoutes } from './sale-paunch.routes';

export const invoicesRouter = Router();
invoicesRouter.use(requireAuth);

registerKachiMaalRoutes(invoicesRouter);
registerPurchaseMaalRoutes(invoicesRouter);
registerSalePaunchRoutes(invoicesRouter);
registerSaleCommissionRoutes(invoicesRouter);
registerSaleInvoiceRoutes(invoicesRouter);
registerPurchaseInvoiceRoutes(invoicesRouter);

const itemSchema = z.object({
  productId: z.number().int().optional(),
  label: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().min(0),
});

const draftSchema = z.object({
  customerId: z.number().int().optional(),
  supplierId: z.number().int().optional(),
  notes: z.string().optional(),
  items: z.array(itemSchema).min(1),
});

invoicesRouter.get(
  '/by-reference',
  asyncHandler(async (req, res) => {
    const reference = req.query.reference as string | undefined;
    if (!reference?.trim()) {
      res.status(400).json({ error: 'reference is required' });
      return;
    }
    res.json(await invoicesService.getInvoiceByReference(reference.trim()));
  }),
);

invoicesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const type = req.query.type as InvoiceType | undefined;
    const pagination = parsePagination(req.query);
    res.json(
      await invoicesService.listInvoices(type ? { type } : undefined, pagination),
    );
  }),
);

invoicesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await invoicesService.getInvoice(parseInt(param(req.params.id), 10)));
  }),
);

function draftRoute(type: InvoiceType) {
  return asyncHandler(async (req, res) => {
    const invoice = await invoicesService.createInvoiceDraft({
      type,
      ...req.body,
      createdById: req.session.userId!,
    });
    res.status(201).json(invoice);
  });
}

invoicesRouter.post('/sale-commission-draft', validateBody(draftSchema), draftRoute(InvoiceType.SALE_COMMISSION));
