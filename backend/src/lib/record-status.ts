import { Prisma, RecordStatus } from '@prisma/client';

/** Accounts that may appear in dropdowns, vouchers, invoices, and reports. */
export const SELECTABLE_ACCOUNT: Prisma.AccountWhereInput = {
  isActive: true,
  status: RecordStatus.ACTIVE,
};

/** Products that may appear in dropdowns, invoices, and stock reports. */
export const SELECTABLE_PRODUCT: Prisma.ProductWhereInput = {
  isActive: true,
  status: RecordStatus.ACTIVE,
};
