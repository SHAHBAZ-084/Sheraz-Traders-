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

approvalsRouter.post(
  '/accounts/:id/reject',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(await approvalsService.rejectPendingAccount(Number(req.params.id)));
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
