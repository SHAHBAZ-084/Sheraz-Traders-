import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireReportsAccess } from '../../middleware/auth';
import { asyncHandler } from '../../utils/helpers';
import * as salePurchaseReport from './sale-purchase-report.service';

export const reportsRouter = Router();
reportsRouter.use(requireAuth);
reportsRouter.use(requireReportsAccess);

reportsRouter.get(
  '/sale-purchase',
  asyncHandler(async (req, res) => {
    const mode = z.enum(['SALE', 'PURCHASE']).parse(String(req.query.mode ?? 'SALE').toUpperCase());
    const typeFilter = z
      .enum(['ALL', 'COMMISSION', 'PAUNCH', 'MAAL'])
      .parse(String(req.query.typeFilter ?? 'ALL').toUpperCase());
    const fromDate = String(req.query.fromDate ?? '');
    const toDate = String(req.query.toDate ?? '');
    if (!fromDate || !toDate) {
      res.status(400).json({ error: 'fromDate and toDate are required' });
      return;
    }

    const partyRaw = req.query.partyAccountId;
    const productRaw = req.query.productId;
    const partyAccountId = partyRaw != null && String(partyRaw) !== ''
      ? Number(partyRaw)
      : null;
    const productId = productRaw != null && String(productRaw) !== ''
      ? Number(productRaw)
      : null;

    res.json(
      await salePurchaseReport.getSalePurchaseReport({
        mode,
        typeFilter,
        fromDate,
        toDate,
        partyAccountId: Number.isFinite(partyAccountId) && (partyAccountId as number) > 0
          ? partyAccountId
          : null,
        productId: Number.isFinite(productId) && (productId as number) > 0 ? productId : null,
      }),
    );
  }),
);
