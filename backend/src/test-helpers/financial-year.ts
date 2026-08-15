import { FinancialYearStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';

function startOfDay(d: Date) {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function toLocalDateString(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Date string (YYYY-MM-DD) valid for posting against the active financial year. */
export async function voucherDateInActiveYear(): Promise<string> {
  const active = await prisma.financialYear.findFirst({
    where: { status: FinancialYearStatus.ACTIVE },
  });
  if (!active) throw new Error('No active financial year');
  const start = startOfDay(active.startDate);
  const today = startOfDay(new Date());
  const effective = today >= start ? today : start;
  return toLocalDateString(effective);
}

/** Earliest date in the active financial year (for backdated voucher tests). */
export async function activeFinancialYearStartDate(): Promise<string> {
  const active = await prisma.financialYear.findFirst({
    where: { status: FinancialYearStatus.ACTIVE },
  });
  if (!active) throw new Error('No active financial year');
  return toLocalDateString(startOfDay(active.startDate));
}
