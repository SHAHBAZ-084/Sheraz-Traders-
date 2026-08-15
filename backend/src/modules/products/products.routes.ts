import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../../middleware/auth';
import { AppError, asyncHandler, param, validateBody } from '../../utils/helpers';
import { parsePagination, SELECTOR_PAGINATION } from '../../utils/pagination';
import * as productsService from './products.service';

export const productsRouter = Router();
productsRouter.use(requireAuth);

productsRouter.get(
  '/product-categories',
  asyncHandler(async (req, res) => {
    res.json(await productsService.listProductCategories(parsePagination(req.query, SELECTOR_PAGINATION)));
  }),
);

productsRouter.post(
  '/product-categories',
  validateBody(
    z.object({
      name: z.string().min(1),
    }),
  ),
  asyncHandler(async (req, res) => {
    const category = await productsService.createProductCategory(req.body.name);
    res.status(201).json(category);
  }),
);

productsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const lite = req.query.lite === '1' || req.query.lite === 'true';
    res.json(
      await productsService.listProducts(
        { includeLedger: !lite },
        parsePagination(req.query, SELECTOR_PAGINATION),
      ),
    );
  }),
);

productsRouter.post(
  '/',
  validateBody(
    z.object({
      name: z.string().min(1),
      unit: z.string().optional(),
      code: z.string().optional(),
      categoryId: z.number().int().positive().nullable().optional(),
      openingStock: z.number().min(0).optional(),
      openingStockRate: z.number().min(0).optional(),
      openingStoreId: z.number().int().positive().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const product = await productsService.createProduct(req.body);
    res.status(201).json(product);
  }),
);

productsRouter.patch(
  '/:id',
  validateBody(
    z.object({
      name: z.string().min(1).optional(),
      unit: z.string().nullable().optional(),
      categoryId: z.number().int().positive().nullable().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const product = await productsService.updateProduct(parseInt(param(req.params.id), 10), req.body);
    res.json(product);
  }),
);

productsRouter.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(await productsService.removeProduct(parseInt(param(req.params.id), 10)));
  }),
);

productsRouter.get(
  '/:id/insight',
  asyncHandler(async (req, res) => {
    const productId = parseInt(param(req.params.id), 10);
    const storeIdRaw = req.query.storeId;
    if (storeIdRaw === undefined || storeIdRaw === '') {
      throw new AppError(400, 'storeId query parameter is required');
    }
    const storeId = parseInt(param(storeIdRaw as string | string[]), 10);
    if (!Number.isFinite(productId) || !Number.isFinite(storeId)) {
      throw new AppError(400, 'Invalid productId or storeId');
    }
    res.json(await productsService.getProductInsight(productId, storeId));
  }),
);
