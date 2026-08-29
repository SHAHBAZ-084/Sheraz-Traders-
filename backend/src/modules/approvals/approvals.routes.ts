import { Router } from 'express';
import { requireAuth, requireAdmin } from '../../middleware/auth';
import { asyncHandler } from '../../utils/helpers';
import * as approvalsService from './approvals.service';

export const approvalsRouter = Router();
approvalsRouter.use(requireAuth);

approvalsRouter.get(
  '/pending',
  asyncHandler(async (_req, res) => {
    res.json(await approvalsService.listPendingApprovals());
  }),
);

approvalsRouter.get(
  '/vouchers/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const result = await approvalsService.getPendingVoucher(id, {
      id: req.user!.id,
      role: req.user!.role,
    });
    res.json(result);
  }),
);

approvalsRouter.patch(
  '/vouchers/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const result = await approvalsService.updatePendingVoucher(
      id,
      { id: req.user!.id, role: req.user!.role },
      {
        date: req.body.date,
        debitAccountId: Number(req.body.debitAccountId),
        creditAccountId: Number(req.body.creditAccountId),
        amount: Number(req.body.amount),
        reference: String(req.body.reference ?? ''),
        description: req.body.description ?? null,
      },
    );
    res.json(result);
  }),
);

approvalsRouter.get(
  '/invoices/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const result = await approvalsService.getPendingInvoice(id, {
      id: req.user!.id,
      role: req.user!.role,
    });
    res.json(result);
  }),
);

approvalsRouter.patch(
  '/invoices/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const result = await approvalsService.updatePendingInvoice(
      id,
      { id: req.user!.id, role: req.user!.role },
      req.body as Record<string, unknown>,
    );
    res.json(result);
  }),
);

approvalsRouter.post(
  '/vouchers/:id/approve',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const result = await approvalsService.approvePendingVoucher(id, req.user!.id);
    res.json(result);
  }),
);

approvalsRouter.post(
  '/vouchers/:id/reject',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const result = await approvalsService.rejectPendingVoucher(id);
    res.json(result);
  }),
);

approvalsRouter.post(
  '/invoices/:id/approve',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const result = await approvalsService.approvePendingInvoice(id);
    res.json(result);
  }),
);

approvalsRouter.post(
  '/invoices/:id/reject',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const result = await approvalsService.rejectPendingInvoice(id);
    res.json(result);
  }),
);

approvalsRouter.post(
  '/accounts/:id/approve',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const result = await approvalsService.approvePendingAccount(Number(req.params.id), req.user!.id);
    res.json(result);
  }),
);

approvalsRouter.get(
  '/accounts/:id',
  asyncHandler(async (req, res) => {
    res.json(
      await approvalsService.getPendingAccount(Number(req.params.id), {
        id: req.user!.id,
        role: req.user!.role,
      }),
    );
  }),
);

approvalsRouter.patch(
  '/accounts/:id',
  asyncHandler(async (req, res) => {
    res.json(
      await approvalsService.updatePendingAccount(
        Number(req.params.id),
        { id: req.user!.id, role: req.user!.role },
        {
          name: String(req.body.name ?? ''),
          categoryId: Number(req.body.categoryId),
          openingBalance: req.body.openingBalance != null ? Number(req.body.openingBalance) : undefined,
          openingBalanceSide: req.body.openingBalanceSide,
        },
      ),
    );
  }),
);

approvalsRouter.post(
  '/accounts/:id/reject',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(await approvalsService.rejectPendingAccount(Number(req.params.id)));
  }),
);

approvalsRouter.get(
  '/products/:id',
  asyncHandler(async (req, res) => {
    res.json(
      await approvalsService.getPendingProduct(Number(req.params.id), {
        id: req.user!.id,
        role: req.user!.role,
      }),
    );
  }),
);

approvalsRouter.patch(
  '/products/:id',
  asyncHandler(async (req, res) => {
    res.json(
      await approvalsService.updatePendingProduct(
        Number(req.params.id),
        { id: req.user!.id, role: req.user!.role },
        req.body as {
          name: string;
          unit?: string | null;
          categoryId?: number | null;
          openingStock?: number;
          openingStockRate?: number;
          openingStoreId?: number | null;
          kachiOpening?: Record<string, unknown> | null;
        },
      ),
    );
  }),
);

approvalsRouter.post(
  '/products/:id/approve',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const result = await approvalsService.approvePendingProduct(Number(req.params.id), req.user!.id);
    res.json(result);
  }),
);

approvalsRouter.post(
  '/products/:id/reject',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(await approvalsService.rejectPendingProduct(Number(req.params.id)));
  }),
);

approvalsRouter.get(
  '/account-adjustments/:id',
  asyncHandler(async (req, res) => {
    res.json(
      await approvalsService.getPendingAccountAdjustment(Number(req.params.id), {
        id: req.user!.id,
        role: req.user!.role,
      }),
    );
  }),
);

approvalsRouter.patch(
  '/account-adjustments/:id',
  asyncHandler(async (req, res) => {
    res.json(
      await approvalsService.updatePendingAccountAdjustment(
        Number(req.params.id),
        { id: req.user!.id, role: req.user!.role },
        {
          adjustmentDate: String(req.body.adjustmentDate),
          accountId: Number(req.body.accountId),
          amount: Number(req.body.amount),
          side: req.body.side,
          description: req.body.description ?? null,
        },
      ),
    );
  }),
);

approvalsRouter.post(
  '/account-adjustments/:id/approve',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const result = await approvalsService.approvePendingAccountAdjustment(Number(req.params.id), req.user!.id);
    res.json(result);
  }),
);

approvalsRouter.post(
  '/account-adjustments/:id/reject',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(await approvalsService.rejectPendingAccountAdjustment(Number(req.params.id)));
  }),
);

approvalsRouter.get(
  '/stock-adjustments/:id',
  asyncHandler(async (req, res) => {
    res.json(
      await approvalsService.getPendingStockAdjustment(Number(req.params.id), {
        id: req.user!.id,
        role: req.user!.role,
      }),
    );
  }),
);

approvalsRouter.patch(
  '/stock-adjustments/:id',
  asyncHandler(async (req, res) => {
    res.json(
      await approvalsService.updatePendingStockAdjustment(
        Number(req.params.id),
        { id: req.user!.id, role: req.user!.role },
        {
          adjustmentDate: String(req.body.adjustmentDate),
          productId: Number(req.body.productId),
          storeId: Number(req.body.storeId),
          quantity: req.body.quantity != null ? Number(req.body.quantity) : undefined,
          rate: req.body.rate != null ? Number(req.body.rate) : undefined,
          kachiOpening: req.body.kachiOpening ?? null,
          description: req.body.description ?? null,
        },
      ),
    );
  }),
);

approvalsRouter.post(
  '/stock-adjustments/:id/approve',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const result = await approvalsService.approvePendingStockAdjustment(Number(req.params.id), req.user!.id);
    res.json(result);
  }),
);

approvalsRouter.post(
  '/stock-adjustments/:id/reject',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(await approvalsService.rejectPendingStockAdjustment(Number(req.params.id)));
  }),
);
