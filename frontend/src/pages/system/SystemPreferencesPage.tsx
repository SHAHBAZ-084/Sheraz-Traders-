import { FormEvent, useEffect, useState } from 'react';
import { PageShell, Panel, PrimaryButton, Tile, FieldLabel, TextInput, SecondaryButton } from '../../components/ui/PageShell';
import { useTheme } from '../../contexts/ThemeContext';
import { api, SystemPreferences, type Store } from '../../lib/api';

type PrefForm = Omit<SystemPreferences, 'updatedAt'>;

type NumericPrefKey = Exclude<keyof PrefForm, 'closingDate'>;

const PREF_FIELDS: { key: NumericPrefKey; label: string; hint?: string }[] = [
  { key: 'daamiPercent', label: 'Daami (%)', hint: 'Kachi Maal profit / Purchase & Commission Dammi' },
  { key: 'paleDariPercent', label: 'Pale Dari (%)', hint: 'Labour rate — Kachi Maal' },
  { key: 'brokeryPercent', label: 'Brokery (%)', hint: 'Broker rate — Kachi Maal' },
  { key: 'marketFeeRate', label: 'Market Fee (per bag)', hint: 'Kachi Maal (calc bags) / Sale Commission (bag count)' },
  { key: 'bardanaRate', label: 'Bardana Rate', hint: 'Default bardana rate reference' },
  { key: 'taxPercent', label: 'Tax (%)' },
  { key: 'kaatPercent', label: 'Kaat (%)' },
  { key: 'mazduriPercent', label: 'Mazduri (%)', hint: 'Percentage — Purchase Maal' },
  { key: 'mazduriPerBagRate', label: 'Mazduri / Labour (per bag)', hint: 'Flat Rs per bag — Sale on Commission' },
  { key: 'commissionPercent', label: 'Commission (%)', hint: 'Sale on Commission — post-dammi base' },
  { key: 'dalaliPercent', label: 'Dalali (%)', hint: 'Sale on Commission — pre-dammi goods base' },
  { key: 'sutliRate', label: 'Sutli (per bag)', hint: 'Sale on Commission' },
  { key: 'markeetFeeRate', label: 'Markeet Fee', hint: 'Legacy unused field' },
  { key: 'kantaRate', label: 'Kanta' },
];

function StoresSection() {
  const [stores, setStores] = useState<Store[]>([]);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    try {
      setStores(await api.listStores());
    } catch {
      setStores([]);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onAdd() {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      await api.createStore({ name: newName });
      setNewName('');
      setMessage('Store added.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add store');
    } finally {
      setBusy(false);
    }
  }

  async function onToggle(store: Store) {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      await api.setStoreActive(store.id, !store.isActive);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update store');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Tile className="mt-6">
      <p className="text-sm font-medium text-textPrimary">Stores</p>
      <p className="mt-1 text-xs text-textMuted">
        Used by Sale Invoice and Purchase Invoice stock only. Other invoice types are unaffected.
      </p>
      <div className="mt-4 space-y-2">
        {stores.length === 0 ? (
          <p className="text-sm text-textMuted">No stores yet.</p>
        ) : (
          stores.map((store) => (
            <div key={store.id} className="flex items-center justify-between gap-3 border-b border-border py-2">
              <div>
                <p className="text-sm font-medium text-textPrimary">{store.name}</p>
                <p className="text-xs text-textMuted">{store.isActive ? 'Active' : 'Inactive'}</p>
              </div>
              <SecondaryButton type="button" disabled={busy} onClick={() => void onToggle(store)}>
                {store.isActive ? 'Deactivate' : 'Activate'}
              </SecondaryButton>
            </div>
          ))
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <div className="min-w-[12rem] flex-1">
          <FieldLabel>New store name</FieldLabel>
          <TextInput value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Main Godown" />
        </div>
        <PrimaryButton type="button" disabled={busy || !newName.trim()} onClick={() => void onAdd()}>
          Add Store
        </PrimaryButton>
      </div>
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
      {message ? <p className="mt-2 text-sm text-success">{message}</p> : null}
    </Tile>
  );
}

export function SystemPreferencesPage() {
  const { theme, setTheme } = useTheme();
  const [form, setForm] = useState<PrefForm | null>(null);
  const [closingDate, setClosingDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [dbChecking, setDbChecking] = useState(false);
  const [dbResult, setDbResult] = useState<{ ok: boolean; results: string[] } | null>(null);
  const [backingUp, setBackingUp] = useState(false);

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
      for (const field of PREF_FIELDS) {
        payload[field.key] = Number(form[field.key]) || 0;
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

  async function onVerifyDatabase() {
    setDbChecking(true);
    setDbResult(null);
    setError('');
    try {
      const result = await api.verifyDatabaseIntegrity();
      setDbResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Integrity check failed');
    } finally {
      setDbChecking(false);
    }
  }

  async function onBackupDatabase() {
    setBackingUp(true);
    setError('');
    setMessage('');
    try {
      const result = await api.backupDatabase();
      setMessage(result.path ? `Backup saved to ${result.path}` : 'Backup skipped — no database file yet.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backup failed');
    } finally {
      setBackingUp(false);
    }
  }

  return (
    <PageShell title="System Preference" subtitle="Shop-wide settings">
      <Panel className="max-w-2xl">
        <Tile>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-textPrimary">Appearance</p>
              <p className="mt-1 text-xs text-textMuted">Choose light or dark theme for the whole app.</p>
            </div>
            <div className="flex rounded-lg border border-border bg-surface2 p-1">
              <button
                type="button"
                onClick={() => setTheme('light')}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  theme === 'light'
                    ? 'bg-accent text-onAccent'
                    : 'text-textSecondary hover:text-textPrimary'
                }`}
              >
                Light
              </button>
              <button
                type="button"
                onClick={() => setTheme('dark')}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  theme === 'dark'
                    ? 'bg-accent text-onAccent'
                    : 'text-textSecondary hover:text-textPrimary'
                }`}
              >
                Dark
              </button>
            </div>
          </div>
        </Tile>

        <Tile className="mt-6">
          <p className="text-sm font-medium text-textPrimary">Database maintenance</p>
          <p className="mt-1 text-xs text-textMuted">
            Verify local SQLite integrity or create an on-demand backup. Automatic backups run on
            app startup in production.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <SecondaryButton type="button" onClick={onVerifyDatabase} disabled={dbChecking}>
              {dbChecking ? 'Checking…' : 'Verify database integrity'}
            </SecondaryButton>
            <SecondaryButton type="button" onClick={onBackupDatabase} disabled={backingUp}>
              {backingUp ? 'Backing up…' : 'Backup database now'}
            </SecondaryButton>
          </div>
          {dbResult ? (
            <p
              className={`mt-3 text-sm ${dbResult.ok ? 'text-success' : 'text-danger'}`}
            >
              {dbResult.ok
                ? 'Integrity check passed (ok).'
                : `Integrity issues: ${dbResult.results.join('; ')}`}
            </p>
          ) : null}
        </Tile>

        <StoresSection />

        {form ? (
          <form className="mt-6 space-y-4" onSubmit={onSave}>
            <p className="text-sm text-textSecondary">
              Rates below are read live when you open Kachi Maal — change them here, not in code.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {PREF_FIELDS.map((field) => (
                <div key={field.key}>
                  <FieldLabel>{field.label}</FieldLabel>
                  <TextInput
                    type="number"
                    step="any"
                    min="0"
                    value={String(form[field.key])}
                    onChange={(e) =>
                      setForm((prev) =>
                        prev ? { ...prev, [field.key]: e.target.value === '' ? 0 : Number(e.target.value) } : prev,
                      )
                    }
                  />
                  {field.hint ? <p className="mt-1 text-xs text-textMuted">{field.hint}</p> : null}
                </div>
              ))}
              <div>
                <FieldLabel>Closing Date</FieldLabel>
                <TextInput value={closingDate} onChange={(e) => setClosingDate(e.target.value)} placeholder="e.g. 2026-06-30" />
              </div>
            </div>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            {message ? <p className="text-sm text-success">{message}</p> : null}
            <PrimaryButton type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save preferences'}
            </PrimaryButton>
          </form>
        ) : error ? (
          <p className="mt-4 text-sm text-danger">{error}</p>
        ) : (
          <p className="mt-4 text-sm text-textMuted">Loading…</p>
        )}
      </Panel>
    </PageShell>
  );
}
