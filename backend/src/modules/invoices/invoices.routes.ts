import { Router } from 'express';
import { InvoiceType } from '@prisma/client';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../../middleware/auth';
import { asyncHandler, param } from '../../utils/helpers';
import { parsePagination } from '../../utils/pagination';
import * as invoicesService from './invoices.service';
import { registerKachiMaalRoutes } from './kachi-maal.routes';
import { registerPurchaseInvoiceRoutes } from './purchase-invoice.routes';
import { registerSaleInvoiceRoutes } from './sale-invoice.routes';
import { getSaleBillSummary } from './sale-bill-report.service';

export const invoicesRouter = Router();
invoicesRouter.use(requireAuth);

registerKachiMaalRoutes(invoicesRouter);
registerSaleInvoiceRoutes(invoicesRouter);
registerPurchaseInvoiceRoutes(invoicesRouter);

const saleBillQuerySchema = z.object({
  fromDate: z.string().min(1),
  toDate: z.string().min(1),
  partyAccountId: z.coerce.number().int().positive().optional(),
  financialYearId: z.coerce.number().int().positive().optional(),
});

invoicesRouter.get(
  '/reports/sale-bill',
  asyncHandler(async (req, res) => {
    const parsed = saleBillQuerySchema.parse(req.query);
    res.json(await getSaleBillSummary(parsed));
  }),
);

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
    const financialYearIdParam = req.query.financialYearId as string | undefined;
    const financialYearId =
      financialYearIdParam && financialYearIdParam.trim() !== ''
        ? parseInt(financialYearIdParam, 10)
        : undefined;
    const pagination = parsePagination(req.query);
    res.json(
      await invoicesService.listInvoices(
        {
          ...(type ? { type } : {}),
          ...(Number.isFinite(financialYearId) ? { financialYearId } : {}),
        },
        pagination,
      ),
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
