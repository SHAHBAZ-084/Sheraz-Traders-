import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin, requireReportsAccess } from '../../middleware/auth';
import { asyncHandler, param } from '../../utils/helpers';
import * as stockService from './stock.service';
import { parsePagination, paginateArray, STANDARD_PAGINATION } from '../../utils/pagination';
import { createStockAdjustment } from '../products/products.service';

export const stockRouter = Router();
stockRouter.use(requireAuth);

stockRouter.get(
  '/report',
  requireReportsAccess,
  asyncHandler(async (req, res) => {
    const productId = Number(req.query.productId);
    const storeIdRaw = req.query.storeId;
    const storeId =
      storeIdRaw != null && String(storeIdRaw).trim() !== ''
        ? Number(storeIdRaw)
        : undefined;
    if (storeId != null && (!Number.isFinite(storeId) || storeId < 1)) {
      res.status(400).json({ error: 'storeId must be a positive integer' });
      return;
    }
    const { limit, offset } = parsePagination(req.query, STANDARD_PAGINATION);
    const report = await stockService.getStockReport({ productId, storeId, limit, offset });
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

stockRouter.get(
  '/value-report',
  requireReportsAccess,
  asyncHandler(async (req, res) => {
    const date = String(req.query.date ?? '').trim();
    if (!date) {
      res.status(400).json({ error: 'date is required' });
      return;
    }
    const storeIdRaw = req.query.storeId;
    const storeId =
      storeIdRaw != null && String(storeIdRaw).trim() !== ''
        ? Number(storeIdRaw)
        : undefined;
    if (storeId != null && (!Number.isFinite(storeId) || storeId < 1)) {
      res.status(400).json({ error: 'storeId must be a positive integer' });
      return;
    }
    const categoryIdRaw = req.query.categoryId;
    const categoryId =
      categoryIdRaw != null && String(categoryIdRaw).trim() !== ''
        ? Number(categoryIdRaw)
        : undefined;
    if (categoryId != null && (!Number.isFinite(categoryId) || categoryId < 1)) {
      res.status(400).json({ error: 'categoryId must be a positive integer' });
      return;
    }
    const { limit, offset } = parsePagination(req.query, STANDARD_PAGINATION);
    res.json(await stockService.getStockValueReport({ date, storeId, categoryId, limit, offset }));
  }),
);

stockRouter.get(
  '/quantity-report',
  requireReportsAccess,
  asyncHandler(async (req, res) => {
    const storeIdRaw = req.query.storeId;
    const storeId =
      storeIdRaw != null && String(storeIdRaw).trim() !== ''
        ? Number(storeIdRaw)
        : undefined;
    if (storeId != null && (!Number.isFinite(storeId) || storeId < 1)) {
      res.status(400).json({ error: 'storeId must be a positive integer' });
      return;
    }
    const categoryIdRaw = req.query.categoryId;
    const categoryId =
      categoryIdRaw != null && String(categoryIdRaw).trim() !== ''
        ? Number(categoryIdRaw)
        : undefined;
    if (categoryId != null && (!Number.isFinite(categoryId) || categoryId < 1)) {
      res.status(400).json({ error: 'categoryId must be a positive integer' });
      return;
    }
    const { limit, offset } = parsePagination(req.query, STANDARD_PAGINATION);
    res.json(await stockService.getStockQuantityReport({ storeId, categoryId, limit, offset }));
  }),
);

stockRouter.get(
  '/products-by-store',
  asyncHandler(async (req, res) => {
    const storeId = Number(req.query.storeId);
    if (!Number.isFinite(storeId) || storeId < 1) {
      res.status(400).json({ error: 'storeId is required' });
      return;
    }
    res.json(await stockService.listProductsByStore(storeId));
  }),
);

stockRouter.get(
  '/by-store/:storeId',
  asyncHandler(async (req, res) => {
    const storeId = Number(req.params.storeId);
    if (!Number.isFinite(storeId) || storeId < 1) {
      res.status(400).json({ error: 'storeId is required' });
      return;
    }
    res.json(await stockService.getStockByStore(storeId));
  }),
);

stockRouter.get(
  '/balance',
  asyncHandler(async (req, res) => {
    const productId = Number(req.query.productId);
    if (!Number.isFinite(productId) || productId < 1) {
      res.status(400).json({ error: 'productId is required' });
      return;
    }
    const storeIdRaw = req.query.storeId;
    const storeId =
      storeIdRaw != null && String(storeIdRaw).trim() !== ''
        ? Number(storeIdRaw)
        : undefined;
    if (storeId != null && (!Number.isFinite(storeId) || storeId < 1)) {
      res.status(400).json({ error: 'storeId must be a positive integer' });
      return;
    }
    const balance = await stockService.getCurrentStockBalance(productId, storeId);
    res.json({ productId, storeId: storeId ?? null, balance });
  }),
);

stockRouter.post(
  '/transfer',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      transferDate: z.string().min(1),
      fromStoreId: z.number().int().positive(),
      toStoreId: z.number().int().positive(),
      productId: z.number().int().positive(),
      quantity: z.number().positive(),
    });
    const body = schema.parse(req.body);
    const invoice = await stockService.createStockTransfer({
      ...body,
      createdById: req.session.userId!,
    });
    res.status(201).json(invoice);
  }),
);

stockRouter.post(
  '/adjustment',
  asyncHandler(async (req, res) => {
    const kachiOpeningSchema = z.object({
      bagMode: z.enum(['BORI', 'THELA']),
      bagCount: z.number().min(0),
      dharanCount: z.number().min(0),
      looseKg: z.number().min(0),
      bhartii: z.number().min(0),
      ratePerMaund: z.number().positive(),
    });

    const schema = z
      .object({
        adjustmentDate: z.string().min(1),
        productId: z.number().int().positive(),
        storeId: z.number().int().positive(),
        quantity: z.number().positive().optional(),
        rate: z.number().positive().optional(),
        kachiOpening: kachiOpeningSchema.optional(),
        description: z.string().max(500).optional(),
      })
      .superRefine((body, ctx) => {
        const hasStandard = body.quantity != null || body.rate != null;
        const hasKachi = body.kachiOpening != null;
        if (hasStandard && hasKachi) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Provide either standard quantity/rate or kachi weight fields, not both',
          });
        }
        if (hasStandard && (body.quantity == null || body.rate == null)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Quantity and rate must both be provided together',
          });
        }
      });

    const body = schema.parse(req.body);
    const result = await createStockAdjustment({
      ...body,
      createdById: req.session.userId!,
      postImmediately: false,
    });
    res.status(201).json(result);
  }),
);

stockRouter.get(
  '/adjustments/search',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { searchStockAdjustments } = await import('../accounting/accounting.service');
    const query = (req.query.q as string | undefined) ?? '';
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 20;
    const items = await searchStockAdjustments(query, limit);
    res.json({ items });
  }),
);

stockRouter.patch(
  '/adjustments/:movementId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { updateStockAdjustment } = await import('../accounting/accounting.service');
    const schema = z
      .object({
        adjustmentDate: z.string().min(1).optional(),
        description: z.string().max(500).optional(),
      })
      .refine((body) => body.adjustmentDate != null || body.description != null, {
        message: 'Provide adjustmentDate and/or description',
      });
    const body = schema.parse(req.body);
    const result = await updateStockAdjustment(parseInt(param(req.params.movementId), 10), body);
    res.json(result);
  }),
);

stockRouter.get(
  '/opening-stock/search',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { searchProductOpeningStock } = await import('../accounting/accounting.service');
    const query = (req.query.q as string | undefined) ?? '';
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 20;
    const items = await searchProductOpeningStock(query, limit);
    res.json({ items });
  }),
);

stockRouter.patch(
  '/opening-stock/:movementId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { updateProductOpeningStockDate } = await import('../accounting/accounting.service');
    const body = z
      .object({
        adjustmentDate: z.string().min(1),
      })
      .parse(req.body);
    const result = await updateProductOpeningStockDate(
      parseInt(param(req.params.movementId), 10),
      body.adjustmentDate,
    );
    res.json(result);
  }),
);
