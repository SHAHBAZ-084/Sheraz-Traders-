import { FormEvent, useEffect, useState } from 'react';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { FieldLabel, PageShell, Panel, PrimaryButton, TextInput } from '../../components/ui/PageShell';
import { DecimalInput } from '../../components/ui/DecimalInput';
import { PageCloseBar } from '../../components/ui/PageCloseBar';
import { api, SystemPreferences } from '../../lib/api';

type NumericPrefKey = Exclude<keyof SystemPreferences, 'updatedAt' | 'closingDate' | 'marketFeeEnabled'>;

/** Draft form — numeric prefs stay as plain strings while typing (e.g. ".", "1."). */
type PrefFormDraft = Record<NumericPrefKey, string> & Pick<SystemPreferences, 'marketFeeEnabled'>;

type PrefTab = 'kachi' | 'general';

type PrefField = { key: NumericPrefKey; label: string; hint?: string };

const PREF_FIELDS: Record<NumericPrefKey, PrefField> = {
  daamiPercent: { key: 'daamiPercent', label: 'Daami (%)', hint: 'Profit rate' },
  paleDariPercent: { key: 'paleDariPercent', label: 'Pale Dari (%)', hint: 'Labour rate' },
  brokeryPercent: { key: 'brokeryPercent', label: 'Brokery (%)', hint: 'Broker rate' },
  marketFeeRate: { key: 'marketFeeRate', label: 'Market Fee (per bag)', hint: 'Charged per bag when enabled' },
  taxPercent: { key: 'taxPercent', label: 'Tax (%)' },
  markeetFeeRate: { key: 'markeetFeeRate', label: 'Markeet Fee', hint: 'Legacy unused field' },
  kantaRate: { key: 'kantaRate', label: 'Kanta' },
};

const TAB_OPTIONS: { value: PrefTab; label: string }[] = [
  { value: 'kachi', label: 'Kachi Maal' },
  { value: 'general', label: 'General' },
];

const TAB_FIELDS: Record<PrefTab, NumericPrefKey[]> = {
  kachi: ['daamiPercent', 'paleDariPercent', 'brokeryPercent', 'marketFeeRate'],
  general: ['taxPercent', 'markeetFeeRate', 'kantaRate'],
};

const ALL_NUMERIC_KEYS = Object.keys(PREF_FIELDS) as NumericPrefKey[];

function prefsToDraft(prefs: Omit<SystemPreferences, 'updatedAt'>): PrefFormDraft {
  const draft = {} as PrefFormDraft;
  for (const key of ALL_NUMERIC_KEYS) {
    draft[key] = String(prefs[key]);
  }
  draft.marketFeeEnabled = prefs.marketFeeEnabled;
  return draft;
}

export function SystemPreferencesPage() {
  const [form, setForm] = useState<PrefFormDraft | null>(null);
  const [closingDate, setClosingDate] = useState('');
  const [tab, setTab] = useState<PrefTab>('kachi');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.getSystemPreferences().then((prefs) => {
      const { updatedAt: _, ...rest } = prefs;
      setForm(prefsToDraft(rest));
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
      const payload: Partial<Omit<SystemPreferences, 'updatedAt'>> = {};
      for (const key of ALL_NUMERIC_KEYS) {
        payload[key] = Number(form[key]) || 0;
      }
      payload.marketFeeEnabled = form.marketFeeEnabled;
      payload.closingDate = closingDate.trim() || null;
      const updated = await api.updateSystemPreferences(payload);
      const { updatedAt: _, ...rest } = updated;
      setForm(prefsToDraft(rest));
      setClosingDate(updated.closingDate ?? '');
      setMessage('Preferences saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function updateField(key: NumericPrefKey, raw: string) {
    setForm((prev) => (prev ? { ...prev, [key]: raw } : prev));
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
                  <DecimalInput
                    value={form[field.key]}
                    onChange={(raw) => updateField(field.key, raw)}
                    disabled={field.key === 'marketFeeRate' && !form.marketFeeEnabled}
                  />
                  {field.key === 'marketFeeRate' ? (
                    <label className="mt-2 flex items-center gap-2 text-xs font-semibold text-textPrimary cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.marketFeeEnabled}
                        onChange={(e) =>
                          setForm((prev) => (prev ? { ...prev, marketFeeEnabled: e.target.checked } : prev))
                        }
                        className="h-4 w-4 rounded border-border text-financial"
                      />
                      Enable Market Fee on Kachi Maal
                    </label>
                  ) : null}
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
