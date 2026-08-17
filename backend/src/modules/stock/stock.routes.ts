import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireReportsAccess } from '../../middleware/auth';
import { asyncHandler } from '../../utils/helpers';
import * as stockService from './stock.service';
import { createStockAdjustment } from '../products/products.service';

import { parsePagination, paginateArray } from '../../utils/pagination';

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
    const { limit, offset } = parsePagination(req.query, { limit: 200, max: 1000 });
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
    res.json(await stockService.getStockValueReport({ date, storeId, categoryId }));
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
    res.json(await stockService.getStockQuantityReport({ storeId, categoryId }));
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
