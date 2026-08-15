import { describe, expect, it } from 'vitest';
import { filterOptions, resolveSelection } from './searchSelectUtils';

const options = [
  { value: '1', label: 'Cash in Hand' },
  { value: '2', label: 'Petty Cash' },
  { value: '3', label: 'Bank Account' },
];

describe('filterOptions', () => {
  it('returns all options when query is empty', () => {
    expect(filterOptions(options, '')).toHaveLength(3);
  });

  it('filters by label substring', () => {
    expect(filterOptions(options, 'cas').map((o) => o.label)).toEqual([
      'Cash in Hand',
      'Petty Cash',
    ]);
  });
});

describe('resolveSelection', () => {
  const two = [
    { value: '1', label: 'Cash in Hand' },
    { value: '2', label: 'Petty Cash' },
  ];

  it('returns null when no matches', () => {
    expect(resolveSelection([], 0, false, 'enter')).toBeNull();
    expect(resolveSelection([], 0, false, 'tab')).toBeNull();
  });

  it('returns sole match for enter and tab without arrows', () => {
    const one = [{ value: '1', label: 'Cash' }];
    expect(resolveSelection(one, 0, false, 'enter')).toEqual(one[0]);
    expect(resolveSelection(one, 0, false, 'tab')).toEqual(one[0]);
  });

  it('enter selects highlighted option when multiple match', () => {
    expect(resolveSelection(two, 1, false, 'enter')).toEqual(two[1]);
    expect(resolveSelection(two, 0, false, 'enter')).toEqual(two[0]);
  });

  it('tab does not select first of multiple without arrow navigation', () => {
    expect(resolveSelection(two, 0, false, 'tab')).toBeNull();
  });

  it('tab selects highlighted option after arrow navigation', () => {
    expect(resolveSelection(two, 1, true, 'tab')).toEqual(two[1]);
  });
});
