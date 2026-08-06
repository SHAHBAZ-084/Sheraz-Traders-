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
