import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireReportsAccess } from '../../middleware/auth';
import { asyncHandler } from '../../utils/helpers';
import * as stockService from './stock.service';

import { parsePagination, paginateArray } from '../../utils/pagination';

export const stockRouter = Router();
stockRouter.use(requireAuth);

stockRouter.get(
  '/report',
  requireReportsAccess,
  asyncHandler(async (req, res) => {
    const productId = Number(req.query.productId);
    const bagTypeRaw = req.query.bagType ? String(req.query.bagType).toUpperCase() : undefined;
    const bagType = bagTypeRaw === 'BORI' || bagTypeRaw === 'THELA' ? bagTypeRaw : undefined;
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
    const { limit, offset } = parsePagination(req.query, { limit: 200, max: 1000 });
    const report = await stockService.getStockReport({ productId, bagType, storeId });
    const paginatedRows = paginateArray(report.rows, limit, offset);
    res.json({
      ...report,
      rows: paginatedRows.items,
      pagination: {
        total: paginatedRows.total,
        limit: paginatedRows.limit,
        offset: paginatedRows.offset,
      },
    });
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
