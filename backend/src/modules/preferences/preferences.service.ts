import { prisma } from '../../lib/prisma';

const DEFAULTS = {
  daamiPercent: 0,
  paleDariPercent: 0,
  brokeryPercent: 0,
  marketFeeRate: 0,
  marketFeeEnabled: true,
  bardanaRate: 0,
  taxPercent: 0,
  markeetFeeRate: 0,
  kantaRate: 0,
  closingDate: null as string | null,
};

function toNumber(value: unknown) {
  return Number(value);
}

function mapPreferences(row: {
  daamiPercent: unknown;
  paleDariPercent: unknown;
  brokeryPercent: unknown;
  marketFeeRate: unknown;
  marketFeeEnabled: boolean;
  bardanaRate: unknown;
  taxPercent: unknown;
  markeetFeeRate: unknown;
  kantaRate: unknown;
  closingDate: string | null;
  updatedAt: Date;
}) {
  return {
    daamiPercent: toNumber(row.daamiPercent),
    paleDariPercent: toNumber(row.paleDariPercent),
    brokeryPercent: toNumber(row.brokeryPercent),
    marketFeeRate: toNumber(row.marketFeeRate),
    marketFeeEnabled: Boolean(row.marketFeeEnabled ?? true),
    bardanaRate: toNumber(row.bardanaRate),
    taxPercent: toNumber(row.taxPercent),
    markeetFeeRate: toNumber(row.markeetFeeRate),
    kantaRate: toNumber(row.kantaRate),
    closingDate: row.closingDate,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getSystemPreferences() {
  let row = await prisma.systemPreference.findUnique({ where: { id: 1 } });
  if (!row) {
    row = await prisma.systemPreference.create({ data: { id: 1 } });
  }
  return mapPreferences(row);
}

export async function updateSystemPreferences(data: Partial<typeof DEFAULTS>) {
  const row = await prisma.systemPreference.upsert({
    where: { id: 1 },
    create: { id: 1, ...DEFAULTS, ...data },
    update: data,
  });
  return mapPreferences(row);
}

export type SystemPreferences = Awaited<ReturnType<typeof getSystemPreferences>>;
