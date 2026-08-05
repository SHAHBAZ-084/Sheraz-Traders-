import { useEffect, useState } from 'react';
import { FieldLabel, PageShell, Panel, PrimaryButton, SecondaryButton, TextInput, Tile } from '../../components/ui/PageShell';
import { PageCloseBar } from '../../components/ui/PageCloseBar';
import { api, type Store } from '../../lib/api';

export function StoresPage() {
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
    <PageShell title="Stores" subtitle="Sale Invoice / Purchase Invoice stock locations">
      <Panel className="max-w-2xl">
        <Tile>
          <p className="text-sm font-medium text-textPrimary">Stores</p>
          <p className="mt-1 text-xs text-textMuted">
            Used by Sale Invoice and Purchase Invoice stock only. Other invoice types are unaffected.
          </p>
          <div className="mt-4 space-y-2">
            {(stores?.length ?? 0) === 0 ? (
              <p className="text-sm text-textMuted">No stores yet.</p>
            ) : (
              (stores ?? []).map((store) => (
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
      </Panel>
      <PageCloseBar />
    </PageShell>
  );
}
