import { describe, expect, it } from 'vitest';
import {
  computeStockInFromRow,
  computeStockOutBags,
} from './stock.calculations';

describe('stock.calculations', () => {
  it('adds whole bags and converts loose + remainder via bhartii', () => {
    const first = computeStockInFromRow({
      wholeBags: 10,
      dharanCount: 2, // 10 kg
      looseKg: 5,
      bhartii: 20,
      carriedRemainderKg: 0,
    });
    // loose 15 → 0 full bags, remainder 15; bagsIn = 10
    expect(first.bagsIn).toBe(10);
    expect(first.newRemainderKg).toBe(15);

    const second = computeStockInFromRow({
      wholeBags: 0,
      dharanCount: 0,
      looseKg: 6,
      bhartii: 20,
      carriedRemainderKg: first.newRemainderKg,
    });
    // 15+6=21 → 1 bag, remainder 1
    expect(second.newFullBagsFromLoose).toBe(1);
    expect(second.bagsIn).toBe(1);
    expect(second.newRemainderKg).toBe(1);
  });

  it('counts stock OUT bag count', () => {
    expect(computeStockOutBags(12)).toBe(12);
    expect(computeStockOutBags(40)).toBe(40);
  });
});
