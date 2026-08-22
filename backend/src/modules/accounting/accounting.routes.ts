import { Router } from 'express';
import { AccountType, VoucherType } from '@prisma/client';
import { z } from 'zod';
import { requireAuth, requireAdmin, requireReportsAccess } from '../../middleware/auth';
import { asyncHandler, param, validateBody } from '../../utils/helpers';
import { parsePagination, parseCursorPagination, SELECTOR_PAGINATION, STANDARD_PAGINATION, LEDGER_PAGINATION } from '../../utils/pagination';
import * as accountingService from './accounting.service';
import { getProfitLossReport } from './profit-loss-report.service';

export const accountingRouter = Router();

accountingRouter.use(requireAuth);

accountingRouter.get(
  '/categories',
  asyncHandler(async (req, res) => {
    const categories = await accountingService.listAccountCategories(
      parsePagination(req.query, SELECTOR_PAGINATION),
    );
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
  requireAdmin,
  asyncHandler(async (req, res) => {
    const category = await accountingService.softDeleteAccountCategory(
      parseInt(param(req.params.id), 10),
    );
    res.json(category);
  }),
);

accountingRouter.get(
  '/accounts',
  asyncHandler(async (req, res) => {
    const lite = req.query.lite === '1' || req.query.lite === 'true';
    const forSelectors = req.query.forSelectors !== '0' && req.query.forSelectors !== 'false';
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : undefined;
    const categoryIdRaw = req.query.categoryId;
    let categoryId: number | undefined;
    if (typeof categoryIdRaw === 'string' && categoryIdRaw.trim() !== '') {
      const parsed = parseInt(categoryIdRaw, 10);
      categoryId = Number.isFinite(parsed) ? parsed : undefined;
    }
    const accounts = await accountingService.listAccounts(
      {
        includeLedger: !lite,
        forSelectors,
        search: search || undefined,
        categoryId,
      },
      parsePagination(req.query, SELECTOR_PAGINATION),
    );
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
    const account = await accountingService.createAccount({
      ...req.body,
      createdById: req.session.userId!,
    });
    res.status(201).json(account);
  }),
);

accountingRouter.post(
  '/account-adjustment',
  validateBody(
    z.object({
      adjustmentDate: z.string().min(1),
      accountId: z.number().int().positive(),
      amount: z.number().positive(),
      side: z.enum(['DR', 'CR']),
    }),
  ),
  asyncHandler(async (req, res) => {
    const result = await accountingService.createAccountAdjustment({
      ...req.body,
      createdById: req.session.userId!,
      postImmediately: false,
    });
    res.status(201).json(result);
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
  asyncHandler(async (req, res) => {
    const fromDate = req.query.fromDate as string | undefined;
    const toDate = req.query.toDate as string | undefined;
    const typeParam = req.query.type as string | undefined;
    const financialYearIdParam = req.query.financialYearId as string | undefined;
    const type =
      typeParam && Object.values(VoucherType).includes(typeParam as VoucherType)
        ? (typeParam as VoucherType)
        : undefined;
    const financialYearId =
      financialYearIdParam && financialYearIdParam.trim() !== ''
        ? parseInt(financialYearIdParam, 10)
        : undefined;

    const vouchers = await accountingService.listVouchers(
      {
        fromDate,
        toDate,
        type,
        financialYearId: Number.isFinite(financialYearId) ? financialYearId : undefined,
      },
      parsePagination(req.query, STANDARD_PAGINATION),
    );
    res.json(vouchers);
  }),
);

accountingRouter.get(
  '/reports/profit-loss',
  requireReportsAccess,
  asyncHandler(async (req, res) => {
    const financialYearIdParam = req.query.financialYearId as string | undefined;
    const financialYearId =
      financialYearIdParam && financialYearIdParam.trim() !== ''
        ? parseInt(financialYearIdParam, 10)
        : NaN;
    if (!Number.isFinite(financialYearId)) {
      res.status(400).json({ error: 'financialYearId is required' });
      return;
    }

    const fromDate = req.query.fromDate as string | undefined;
    const toDate = req.query.toDate as string | undefined;
    const productIdParam = req.query.productId as string | undefined;
    const categoryIdParam = req.query.categoryId as string | undefined;
    const productId =
      productIdParam && productIdParam.trim() !== ''
        ? parseInt(productIdParam, 10)
        : undefined;
    const categoryId =
      categoryIdParam && categoryIdParam.trim() !== ''
        ? parseInt(categoryIdParam, 10)
        : undefined;

    const report = await getProfitLossReport({
      financialYearId,
      fromDate: fromDate?.trim() || undefined,
      toDate: toDate?.trim() || undefined,
      productId: Number.isFinite(productId) ? productId : undefined,
      categoryId: Number.isFinite(categoryId) ? categoryId : undefined,
    });
    res.json(report);
  }),
);

accountingRouter.get(
  '/reports/account-balance',
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

    const productCategoryIdParam = req.query.productCategoryId as string | undefined;
    const productCategoryId =
      productCategoryIdParam && productCategoryIdParam.trim() !== ''
        ? parseInt(productCategoryIdParam, 10)
        : undefined;

    if (Number.isFinite(categoryId) && Number.isFinite(productCategoryId)) {
      res.status(400).json({ error: 'Use either categoryId or productCategoryId, not both' });
      return;
    }

    const sideParam = req.query.side as string | undefined;
    const side =
      sideParam === 'debit' || sideParam === 'credit' || sideParam === 'both'
        ? sideParam
        : 'both';

    const { limit, offset } = parsePagination(req.query, STANDARD_PAGINATION);
    const financialYearIdParam = req.query.financialYearId as string | undefined;
    const financialYearId =
      financialYearIdParam && financialYearIdParam.trim() !== ''
        ? parseInt(financialYearIdParam, 10)
        : undefined;
    const report = await accountingService.getAccountBalancesAsOf({
      date,
      categoryId: Number.isFinite(categoryId) ? categoryId : undefined,
      productCategoryId: Number.isFinite(productCategoryId) ? productCategoryId : undefined,
      side,
      limit,
      offset,
      financialYearId: Number.isFinite(financialYearId) ? financialYearId : undefined,
    });
    res.json({
      ...report,
      pagination: {
        total: report.totalCount,
        limit,
        offset,
      },
    });
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
      postImmediately: false,
    });
    res.status(201).json(voucher);
  }),
);

accountingRouter.post(
  '/vouchers/batch',
  validateBody(
    z.object({
      vouchers: z.array(
        z.object({
          type: z.nativeEnum(VoucherType),
          debitAccountId: z.number().int(),
          creditAccountId: z.number().int(),
          amount: z.number().positive(),
          date: z.union([z.string().min(1), z.coerce.date()]),
          description: z.string().optional(),
          reference: z.string().trim().min(1, 'Reference is required'),
        }),
      ).min(1, 'At least one voucher is required'),
    }),
  ),
  asyncHandler(async (req, res) => {
    const result = await accountingService.createVouchersBatch({
      vouchers: req.body.vouchers,
      createdById: req.session.userId!,
      postImmediately: false,
    });
    res.status(201).json(result);
  }),
);

accountingRouter.patch(
  '/vouchers/:voucherId',
  requireAdmin,
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
  asyncHandler(async (req, res) => {
    const { limit, offset } = parsePagination(req.query, STANDARD_PAGINATION);
    const financialYearIdParam = req.query.financialYearId as string | undefined;
    const financialYearId =
      financialYearIdParam != null && financialYearIdParam !== ''
        ? parseInt(financialYearIdParam, 10)
        : undefined;
    const trialBalance = await accountingService.getTrialBalance({
      limit,
      offset,
      ...(Number.isFinite(financialYearId) ? { financialYearId } : {}),
    });
    res.json({
      ...trialBalance,
      pagination: {
        total: trialBalance.totalCount,
        limit,
        offset,
      },
    });
  }),
);

accountingRouter.get(
  '/ledger/:accountId',
  asyncHandler(async (req, res) => {
    const accountId = parseInt(param(req.params.accountId), 10);
    const fromDate = req.query.fromDate as string | undefined;
    const toDate = req.query.toDate as string | undefined;
    const financialYearIdParam = req.query.financialYearId as string | undefined;
    const useCursor = typeof req.query.cursor === 'string';
    const cursorPagination = parseCursorPagination(req.query, LEDGER_PAGINATION);
    const offsetPagination = parsePagination(req.query, LEDGER_PAGINATION);

    const ledger = financialYearIdParam
      ? await accountingService.getLedgerEntriesForYear(
          accountId,
          parseInt(financialYearIdParam, 10),
          fromDate,
          toDate,
          useCursor
            ? { mode: 'cursor', limit: cursorPagination.limit, cursor: cursorPagination.cursor }
            : { mode: 'offset', limit: offsetPagination.limit, offset: offsetPagination.offset },
        )
      : await accountingService.getLedgerEntries(
          accountId,
          fromDate,
          toDate,
          useCursor
            ? { mode: 'cursor', limit: cursorPagination.limit, cursor: cursorPagination.cursor }
            : { mode: 'offset', limit: offsetPagination.limit, offset: offsetPagination.offset },
        );

    res.json({
      ...ledger,
      pagination: useCursor
        ? {
            limit: cursorPagination.limit,
            nextCursor: ledger.nextCursor,
            hasMore: ledger.hasMore,
            total: ledger.totalCount,
          }
        : {
            total: ledger.totalCount,
            limit: offsetPagination.limit,
            offset: offsetPagination.offset,
            nextCursor: ledger.nextCursor,
            hasMore: ledger.hasMore,
          },
    });
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
  '/financial-year/change',
  requireAdmin,
  validateBody(z.object({ password: z.string().min(1) })),
  asyncHandler(async (req, res) => {
    const result = await accountingService.changeFinancialYear(
      req.session.userId!,
      req.body.password,
    );
    if (!result.ok) {
      res.status(200).json({ ok: false });
      return;
    }
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
  requireAdmin,
  asyncHandler(async (req, res) => {
    const account = await accountingService.softDeleteAccount(parseInt(param(req.params.id), 10));
    res.json(account);
  }),
);
