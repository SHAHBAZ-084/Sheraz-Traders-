import { describe, expect, it } from 'vitest';
import { containsUrduScript, urduLabelClassName } from './urduScript';

describe('urduScript', () => {
  it('detects Urdu script in label strings', () => {
    expect(containsUrduScript('تاریخ')).toBe(true);
    expect(containsUrduScript('بوری کی تعداد')).toBe(true);
    expect(containsUrduScript('Party')).toBe(false);
    expect(containsUrduScript('Preview Grid')).toBe(false);
  });

  it('adds field-label-urdu class when needed', () => {
    expect(urduLabelClassName('ریٹ', 'px-3')).toBe('px-3 field-label-urdu');
    expect(urduLabelClassName('Product', 'px-3')).toBe('px-3');
  });
});
