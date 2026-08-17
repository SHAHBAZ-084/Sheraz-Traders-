import { describe, expect, it } from 'vitest';
import { KACHI_URDU_LABELS, kachiUrduLabel } from './kachiUrduLabels';

describe('kachiUrduLabels', () => {
  it('keeps specified fields in English', () => {
    expect(kachiUrduLabel('party')).toBe('Party');
    expect(kachiUrduLabel('addDheriRow')).toBe('Add Dheri Row');
    expect(kachiUrduLabel('identity')).toBe('Identity');
    expect(kachiUrduLabel('previewGrid')).toBe('Preview Grid');
    expect(kachiUrduLabel('totalDebit')).toBe('Total Debit');
    expect(kachiUrduLabel('netToParty')).toBe('Net to Party');
    expect(kachiUrduLabel('saveInvoice')).toBe('Save invoice');
    expect(kachiUrduLabel('minimize')).toBe('Minimize');
    expect(kachiUrduLabel('close')).toBe('Close');
  });

  it('uses بروکری for Brokery (not آڑھت)', () => {
    expect(KACHI_URDU_LABELS.brokery).toBe('بروکری');
    expect(KACHI_URDU_LABELS.brokery).not.toBe('آڑھت');
  });

  it('uses دھارَن for Dharan (not دھڑن)', () => {
    expect(kachiUrduLabel('dharan')).toBe('دھارَن');
    expect(kachiUrduLabel('dharan')).not.toBe('دھڑن');
  });

  it('drops Lower from Bardana display labels', () => {
    expect(KACHI_URDU_LABELS.lowerBardana).toBe('بردانہ');
    expect(KACHI_URDU_LABELS.lowerBardanaQty).toBe('بردانہ تعداد');
    expect(KACHI_URDU_LABELS.lowerBardanaRate).toBe('بردانہ ریٹ');
    expect(KACHI_URDU_LABELS.lowerBardana).not.toContain('Lower');
    expect(KACHI_URDU_LABELS.lowerBardana).not.toContain('لوئر');
  });
});
