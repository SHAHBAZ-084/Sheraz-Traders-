import { FinancialYearStatus } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { fiscalYearLabelForDate } from '../src/modules/accounting/accounting.service';

function startOfDay(d: Date) {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

async function main() {
  const today = startOfDay(new Date());
  let active = await prisma.financialYear.findFirst({
    where: { status: FinancialYearStatus.ACTIVE },
  });

  if (!active) {
    const { label, startDate } = fiscalYearLabelForDate(today);
    active = await prisma.financialYear.create({
      data: { label, startDate, status: FinancialYearStatus.ACTIVE },
    });
    console.log(`Created active financial year "${label}".`);
    return;
  }

  if (today < startOfDay(active.startDate)) {
    await prisma.financialYear.update({
      where: { id: active.id },
      data: { startDate: today },
    });
    console.log(`Adjusted active FY #${active.id} startDate to today.`);
  } else {
    console.log(`Active FY #${active.id} already includes today.`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
