import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler, param, validateBody } from '../../utils/helpers';
import * as partiesService from './parties.service';

export const partiesRouter = Router();
partiesRouter.use(requireAuth);

partiesRouter.get(
  '/sale-parties',
  asyncHandler(async (_req, res) => {
    res.json(await partiesService.listSaleParties());
  }),
);

partiesRouter.post(
  '/sale-parties',
  validateBody(
    z.object({
      name: z.string().min(1),
      fatherName: z.string().optional(),
      cnic: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      address: z.string().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const party = await partiesService.createSaleParty(req.body);
    res.status(201).json(party);
  }),
);

partiesRouter.patch(
  '/sale-parties/:id',
  validateBody(
    z.object({
      name: z.string().optional(),
      fatherName: z.string().optional(),
      cnic: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      address: z.string().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const party = await partiesService.updateSaleParty(parseInt(param(req.params.id), 10), req.body);
    res.json(party);
  }),
);

partiesRouter.delete(
  '/sale-parties/:id',
  asyncHandler(async (req, res) => {
    res.json(await partiesService.removeSaleParty(parseInt(param(req.params.id), 10)));
  }),
);

partiesRouter.get(
  '/purchase-parties',
  asyncHandler(async (_req, res) => {
    res.json(await partiesService.listPurchaseParties());
  }),
);

partiesRouter.post(
  '/purchase-parties',
  validateBody(
    z.object({
      name: z.string().min(1),
      contactPerson: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      address: z.string().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const party = await partiesService.createPurchaseParty(req.body);
    res.status(201).json(party);
  }),
);

partiesRouter.patch(
  '/purchase-parties/:id',
  validateBody(
    z.object({
      name: z.string().optional(),
      contactPerson: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      address: z.string().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const party = await partiesService.updatePurchaseParty(parseInt(param(req.params.id), 10), req.body);
    res.json(party);
  }),
);

partiesRouter.delete(
  '/purchase-parties/:id',
  asyncHandler(async (req, res) => {
    res.json(await partiesService.removePurchaseParty(parseInt(param(req.params.id), 10)));
  }),
);
