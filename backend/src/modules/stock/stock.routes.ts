import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../utils/helpers';
import * as stockService from './stock.service';

export const stockRouter = Router();
stockRouter.use(requireAuth);

stockRouter.get(
  '/report',
  asyncHandler(async (req, res) => {
    const productId = Number(req.query.productId);
    const bagTypeRaw = String(req.query.bagType ?? '').toUpperCase();
    const bagType = z.enum(['BORI', 'THELA']).parse(bagTypeRaw);
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
    res.json(await stockService.getStockReport({ productId, bagType, storeId }));
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
