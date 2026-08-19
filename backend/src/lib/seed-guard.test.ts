import { describe, expect, it } from 'vitest';
import path from 'path';
import { isProductionDatabasePath } from './seed-guard';

describe('isProductionDatabasePath', () => {
  it('detects AppData install databases', () => {
    const prod = path.join('C:', 'Users', 'shop', 'AppData', 'Roaming', 'Sheraz Traders', 'data', 'sheraztrader.db');
    expect(isProductionDatabasePath(prod)).toBe(true);

    const legacy = path.join('C:', 'Users', 'shop', 'AppData', 'Roaming', 'grain-market-pos', 'data', 'sheraztrader.db');
    expect(isProductionDatabasePath(legacy)).toBe(true);
  });

  it('allows dev workspace databases', () => {
    const dev = path.join('C:', 'Users', 'dev', 'Desktop', 'Sheraz Traders', 'backend', 'prisma', 'data', 'sheraztrader.db');
    expect(isProductionDatabasePath(dev)).toBe(false);
  });
});
