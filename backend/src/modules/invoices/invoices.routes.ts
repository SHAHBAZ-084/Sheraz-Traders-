import { Router } from 'express';
import { InvoiceType } from '@prisma/client';
import { requireAuth, requireAdmin } from '../../middleware/auth';
import { asyncHandler, param } from '../../utils/helpers';
import { parsePagination } from '../../utils/pagination';
import * as invoicesService from './invoices.service';
import { registerKachiMaalRoutes } from './kachi-maal.routes';
import { registerPurchaseInvoiceRoutes } from './purchase-invoice.routes';
import { registerSaleInvoiceRoutes } from './sale-invoice.routes';

export const invoicesRouter = Router();
invoicesRouter.use(requireAuth);

registerKachiMaalRoutes(invoicesRouter);
registerSaleInvoiceRoutes(invoicesRouter);
registerPurchaseInvoiceRoutes(invoicesRouter);

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

invoicesRouter.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const invoice = await invoicesService.cancelInvoice(
      parseInt(param(req.params.id), 10),
      req.session.userId!,
    );
    res.json(invoice);
  }),
);
