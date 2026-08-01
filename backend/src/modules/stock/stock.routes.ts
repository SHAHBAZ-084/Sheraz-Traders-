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
    res.json(await stockService.getStockReport({ productId, bagType }));
  }),
);
