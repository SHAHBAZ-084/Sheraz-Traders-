import { Router } from 'express';
import { AccountType, VoucherType } from '@prisma/client';
import { z } from 'zod';
import { requireAuth, requireAdmin, requireReportsAccess } from '../../middleware/auth';
import { asyncHandler, param, validateBody } from '../../utils/helpers';
import { parsePagination } from '../../utils/pagination';
import * as accountingService from './accounting.service';

export const accountingRouter = Router();

accountingRouter.use(requireAuth);

accountingRouter.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    const categories = await accountingService.listAccountCategories();
    res.json(categories);
  }),
);

accountingRouter.post(
  '/categories',
  validateBody(z.object({ name: z.string().min(1) })),
  asyncHandler(async (req, res) => {
    const category = await accountingService.createAccountCategory(req.body.name);
    res.status(201).json(category);
  }),
);

accountingRouter.delete(
  '/categories/:id',
  asyncHandler(async (req, res) => {
    const category = await accountingService.softDeleteAccountCategory(
      parseInt(param(req.params.id), 10),
    );
    res.json(category);
  }),
);

accountingRouter.get(
  '/accounts',
  asyncHandler(async (_req, res) => {
    const accounts = await accountingService.listAccounts();
    res.json(accounts);
  }),
);

accountingRouter.post(
  '/accounts',
  validateBody(
    z.object({
      categoryId: z.number().int(),
      name: z.string().min(1),
      code: z.string().min(1).optional(),
      type: z.nativeEnum(AccountType).optional(),
      openingBalance: z.number().min(0).optional(),
      openingBalanceSide: z.enum(['DR', 'CR']).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const account = await accountingService.createAccount({ ...req.body });
    res.status(201).json(account);
  }),
);

accountingRouter.get(
  '/dashboard-summary',
  requireReportsAccess,
  asyncHandler(async (_req, res) => {
    const summary = await accountingService.getDashboardSummary();
    res.json(summary);
  }),
);

accountingRouter.get(
  '/vouchers/next-number',
  asyncHandler(async (req, res) => {
    const typeParam = (req.query.type as string | undefined)?.toUpperCase();
    const type =
      typeParam && Object.values(VoucherType).includes(typeParam as VoucherType)
        ? (typeParam as VoucherType)
        : VoucherType.PAYMENT;
    const preview = await accountingService.previewNextVoucherNumber(type);
    res.json(preview);
  }),
);

accountingRouter.get(
  '/vouchers',
  requireReportsAccess,
  asyncHandler(async (req, res) => {
    const fromDate = req.query.fromDate as string | undefined;
    const toDate = req.query.toDate as string | undefined;
    const typeParam = req.query.type as string | undefined;
    const type =
      typeParam && Object.values(VoucherType).includes(typeParam as VoucherType)
        ? (typeParam as VoucherType)
        : undefined;

    const vouchers = await accountingService.listVouchers(
      { fromDate, toDate, type },
      parsePagination(req.query, { limit: 500, max: 500 }),
    );
    res.json(vouchers);
  }),
);

accountingRouter.get(
  '/reports/account-balance',
  requireReportsAccess,
  asyncHandler(async (req, res) => {
    const date = req.query.date as string | undefined;
    if (!date?.trim()) {
      res.status(400).json({ error: 'date is required' });
      return;
    }

    const categoryIdParam = req.query.categoryId as string | undefined;
    const categoryId =
      categoryIdParam && categoryIdParam.trim() !== ''
        ? parseInt(categoryIdParam, 10)
        : undefined;

    const sideParam = req.query.side as string | undefined;
    const side =
      sideParam === 'debit' || sideParam === 'credit' || sideParam === 'both'
        ? sideParam
        : 'both';

    const report = await accountingService.getAccountBalancesAsOf({
      date,
      categoryId: Number.isFinite(categoryId) ? categoryId : undefined,
      side,
    });
    res.json(report);
  }),
);

accountingRouter.post(
  '/vouchers',
  validateBody(
    z.object({
      type: z.nativeEnum(VoucherType),
      debitAccountId: z.number().int(),
      creditAccountId: z.number().int(),
      amount: z.number().positive(),
      date: z.union([z.string().min(1), z.coerce.date()]),
      description: z.string().optional(),
      reference: z.string().trim().min(1, 'Reference is required'),
    }),
  ),
  asyncHandler(async (req, res) => {
    const voucher = await accountingService.createVoucher({
      ...req.body,
      createdById: req.session.userId!,
      postImmediately: req.user?.role === 'ADMIN',
    });
    res.status(201).json(voucher);
  }),
);

accountingRouter.patch(
  '/vouchers/:voucherId',
  validateBody(z.object({ amount: z.number().positive() })),
  asyncHandler(async (req, res) => {
    const voucher = await accountingService.updateVoucherAmount(
      parseInt(param(req.params.voucherId), 10),
      req.body.amount,
      req.session.userId!,
    );
    res.json(voucher);
  }),
);

accountingRouter.delete(
  '/vouchers/:voucherId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const voucher = await accountingService.cancelVoucher(
      parseInt(param(req.params.voucherId), 10),
      req.session.userId!,
    );
    res.json(voucher);
  }),
);

accountingRouter.get(
  '/trial-balance',
  requireReportsAccess,
  asyncHandler(async (_req, res) => {
    const trialBalance = await accountingService.getTrialBalance();
    res.json(trialBalance);
  }),
);

accountingRouter.get(
  '/ledger/:accountId',
  requireReportsAccess,
  asyncHandler(async (req, res) => {
    const accountId = parseInt(param(req.params.accountId), 10);
    const fromDate = req.query.fromDate as string | undefined;
    const toDate = req.query.toDate as string | undefined;
    const financialYearIdParam = req.query.financialYearId as string | undefined;

    const ledger = financialYearIdParam
      ? await accountingService.getLedgerEntriesForYear(
          accountId,
          parseInt(financialYearIdParam, 10),
          fromDate,
          toDate,
        )
      : await accountingService.getLedgerEntries(accountId, fromDate, toDate);
    res.json(ledger);
  }),
);

accountingRouter.get(
  '/financial-years',
  asyncHandler(async (_req, res) => {
    const years = await accountingService.listFinancialYears();
    res.json(years);
  }),
);

accountingRouter.post(
  '/financial-year/close',
  asyncHandler(async (req, res) => {
    const result = await accountingService.closeFinancialYear(req.session.userId!);
    res.status(201).json(result);
  }),
);

accountingRouter.post(
  '/trial-balance/approve',
  validateBody(z.object({ period: z.string().min(1), notes: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const approval = await accountingService.approveTrialBalance({
      period: req.body.period,
      notes: req.body.notes,
      approvedById: req.session.userId!,
    });
    res.status(201).json(approval);
  }),
);

accountingRouter.get(
  '/trial-balance/approvals',
  asyncHandler(async (_req, res) => {
    const approvals = await accountingService.listTrialBalanceApprovals();
    res.json(approvals);
  }),
);

accountingRouter.patch(
  '/accounts/:id',
  validateBody(
    z.object({
      name: z.string().optional(),
      code: z.string().optional(),
      isActive: z.boolean().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const account = await accountingService.updateAccount(
      parseInt(param(req.params.id), 10),
      req.body,
    );
    res.json(account);
  }),
);

accountingRouter.delete(
  '/accounts/:id',
  asyncHandler(async (req, res) => {
    const account = await accountingService.softDeleteAccount(parseInt(param(req.params.id), 10));
    res.json(account);
  }),
);
