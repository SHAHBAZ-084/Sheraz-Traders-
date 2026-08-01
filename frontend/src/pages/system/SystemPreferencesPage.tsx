import { FormEvent, useEffect, useState } from 'react';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { FieldLabel, PageShell, Panel, PrimaryButton, TextInput } from '../../components/ui/PageShell';
import { PageCloseBar } from '../../components/ui/PageCloseBar';
import { api, SystemPreferences } from '../../lib/api';

type PrefForm = Omit<SystemPreferences, 'updatedAt'>;

type NumericPrefKey = Exclude<keyof PrefForm, 'closingDate'>;

type PrefTab = 'kachi' | 'purchase' | 'saleCommission' | 'general';

type PrefField = { key: NumericPrefKey; label: string; hint?: string };

const PREF_FIELDS: Record<NumericPrefKey, PrefField> = {
  daamiPercent: { key: 'daamiPercent', label: 'Daami (%)', hint: 'Profit rate (also used for Purchase & Commission Dammi)' },
  paleDariPercent: { key: 'paleDariPercent', label: 'Pale Dari (%)', hint: 'Labour rate' },
  brokeryPercent: { key: 'brokeryPercent', label: 'Brokery (%)', hint: 'Broker rate' },
  marketFeeRate: { key: 'marketFeeRate', label: 'Market Fee (per bag)', hint: 'Charged per bag' },
  bardanaRate: { key: 'bardanaRate', label: 'Bardana Rate', hint: 'Default bardana rate reference' },
  taxPercent: { key: 'taxPercent', label: 'Tax (%)' },
  kaatPercent: { key: 'kaatPercent', label: 'Kaat (%)' },
  mazduriPercent: { key: 'mazduriPercent', label: 'Mazduri (%)', hint: 'Percentage of goods value' },
  mazduriPerBagRate: { key: 'mazduriPerBagRate', label: 'Mazduri / Labour (per bag)', hint: 'Flat Rs per bag' },
  commissionPercent: { key: 'commissionPercent', label: 'Commission (%)', hint: 'Post-dammi base' },
  dalaliPercent: { key: 'dalaliPercent', label: 'Dalali (%)', hint: 'Pre-dammi goods base' },
  sutliRate: { key: 'sutliRate', label: 'Sutli (per bag)' },
  markeetFeeRate: { key: 'markeetFeeRate', label: 'Markeet Fee', hint: 'Legacy unused field' },
  kantaRate: { key: 'kantaRate', label: 'Kanta' },
};

const TAB_OPTIONS: { value: PrefTab; label: string }[] = [
  { value: 'kachi', label: 'Kachi Maal' },
  { value: 'purchase', label: 'Purchase Maal' },
  { value: 'saleCommission', label: 'Sale on Commission' },
  { value: 'general', label: 'General' },
];

const TAB_FIELDS: Record<PrefTab, NumericPrefKey[]> = {
  kachi: ['daamiPercent', 'paleDariPercent', 'brokeryPercent', 'marketFeeRate'],
  purchase: ['kaatPercent', 'mazduriPercent'],
  saleCommission: ['marketFeeRate', 'mazduriPerBagRate', 'commissionPercent', 'dalaliPercent', 'sutliRate'],
  general: ['bardanaRate', 'taxPercent', 'markeetFeeRate', 'kantaRate'],
};

const ALL_NUMERIC_KEYS = Object.keys(PREF_FIELDS) as NumericPrefKey[];

export function SystemPreferencesPage() {
  const [form, setForm] = useState<PrefForm | null>(null);
  const [closingDate, setClosingDate] = useState('');
  const [tab, setTab] = useState<PrefTab>('kachi');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.getSystemPreferences().then((prefs) => {
      const { updatedAt: _, ...rest } = prefs;
      setForm(rest);
      setClosingDate(prefs.closingDate ?? '');
    }).catch(() => setError('Failed to load preferences'));
  }, []);

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const payload = {} as Partial<PrefForm>;
      for (const key of ALL_NUMERIC_KEYS) {
        payload[key] = Number(form[key]) || 0;
      }
      payload.closingDate = closingDate.trim() || null;
      const updated = await api.updateSystemPreferences(payload);
      const { updatedAt: _, ...rest } = updated;
      setForm(rest);
      setClosingDate(updated.closingDate ?? '');
      setMessage('Preferences saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function updateField(key: NumericPrefKey, raw: string) {
    setForm((prev) => (prev ? { ...prev, [key]: raw === '' ? 0 : Number(raw) } : prev));
  }

  const visibleFields = TAB_FIELDS[tab].map((key) => PREF_FIELDS[key]);

  return (
    <PageShell title="System Preference" subtitle="Shop-wide rate settings by invoice type">
      <Panel className="max-w-2xl">
        {form ? (
          <form className="space-y-4" onSubmit={onSave}>
            <SegmentedControl
              value={tab}
              onChange={setTab}
              options={TAB_OPTIONS}
              ariaLabel="Preference group"
            />
            <div className="grid gap-4 sm:grid-cols-2">
              {visibleFields.map((field) => (
                <div key={`${tab}-${field.key}`}>
                  <FieldLabel>{field.label}</FieldLabel>
                  <TextInput
                    type="number"
                    step="any"
                    min="0"
                    value={String(form[field.key])}
                    onChange={(e) => updateField(field.key, e.target.value)}
                  />
                  {field.hint ? <p className="mt-1 text-xs text-textMuted">{field.hint}</p> : null}
                </div>
              ))}
              {tab === 'general' ? (
                <div>
                  <FieldLabel>Closing Date</FieldLabel>
                  <TextInput
                    value={closingDate}
                    onChange={(e) => setClosingDate(e.target.value)}
                    placeholder="e.g. 2026-06-30"
                  />
                </div>
              ) : null}
            </div>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            {message ? <p className="text-sm text-success">{message}</p> : null}
            <PrimaryButton type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save preferences'}
            </PrimaryButton>
          </form>
        ) : error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : (
          <p className="text-sm text-textMuted">Loading…</p>
        )}
      </Panel>
      <PageCloseBar />
    </PageShell>
  );
}
