import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler, param, validateBody } from '../../utils/helpers';
import * as productsService from './products.service';

export const productsRouter = Router();
productsRouter.use(requireAuth);

productsRouter.get(
  '/product-categories',
  asyncHandler(async (_req, res) => {
    res.json(await productsService.listProductCategories());
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
  asyncHandler(async (_req, res) => {
    res.json(await productsService.listProducts());
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
    }),
  ),
  asyncHandler(async (req, res) => {
    const product = await productsService.createProduct(req.body);
    res.status(201).json(product);
  }),
);

productsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await productsService.removeProduct(parseInt(param(req.params.id), 10)));
  }),
);
