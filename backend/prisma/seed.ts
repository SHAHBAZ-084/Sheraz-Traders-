import bcrypt from 'bcryptjs';
import { FinancialYearStatus, PrismaClient, Role } from '@prisma/client';
import {
  bootstrapChartOfAccounts,
  INITIAL_FINANCIAL_YEAR,
} from '../src/modules/accounting/accounting.service';

const prisma = new PrismaClient();

async function main() {
  const username = process.env.DEFAULT_ADMIN_USERNAME ?? 'admin';
  const password = process.env.DEFAULT_ADMIN_PASSWORD ?? 'admin123';

  const existing = await prisma.user.findUnique({ where: { username } });

  if (!existing) {
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.create({
      data: {
        username,
        passwordHash,
        displayName: 'Shop Owner',
        role: Role.ADMIN,
      },
    });
    console.log(`Created default admin "${username}". Change the password after first login.`);
  } else {
    if (existing.role !== Role.ADMIN) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { role: Role.ADMIN },
      });
      console.log(`Updated default user "${username}" role to ADMIN.`);
    } else {
      console.log(`Default admin "${username}" already exists — skipping admin seed.`);
    }
  }

  const clerkUsername = process.env.DEFAULT_USER_USERNAME ?? 'user';
  const clerkPassword = process.env.DEFAULT_USER_PASSWORD ?? 'user123';

  const existingClerk = await prisma.user.findUnique({ where: { username: clerkUsername } });

  if (!existingClerk) {
    const passwordHash = await bcrypt.hash(clerkPassword, 10);
    await prisma.user.create({
      data: {
        username: clerkUsername,
        passwordHash,
        displayName: 'Shop Clerk',
        role: Role.USER,
      },
    });
    console.log(`Created default user "${clerkUsername}". Change the password after first login.`);
  } else {
    if (existingClerk.role !== Role.USER) {
      await prisma.user.update({
        where: { id: existingClerk.id },
        data: { role: Role.USER },
      });
      console.log(`Updated default user "${clerkUsername}" role to USER.`);
    } else {
      console.log(`Default user "${clerkUsername}" already exists — skipping user seed.`);
    }
  }

  const activeYear = await prisma.financialYear.findFirst({
    where: { status: FinancialYearStatus.ACTIVE },
  });

  if (!activeYear) {
    await prisma.financialYear.create({
      data: {
        label: INITIAL_FINANCIAL_YEAR.label,
        startDate: INITIAL_FINANCIAL_YEAR.startDate,
        status: FinancialYearStatus.ACTIVE,
      },
    });
    console.log(`Created active financial year "${INITIAL_FINANCIAL_YEAR.label}".`);
  }

  await bootstrapChartOfAccounts();
  console.log('Chart of accounts bootstrapped.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
