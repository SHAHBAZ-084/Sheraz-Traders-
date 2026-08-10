import { useEffect, useState } from 'react';
import { FieldLabel, PageShell, Panel, PrimaryButton, SecondaryButton, TextInput, Tile } from '../../components/ui/PageShell';
import { PasswordInput } from '../../components/ui/PasswordInput';
import { PageCloseBar } from '../../components/ui/PageCloseBar';
import { api, type Store } from '../../lib/api';

export function StoresPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // Delete modal state
  const [deleteStoreTarget, setDeleteStoreTarget] = useState<Store | null>(null);
  const [deletionSummary, setDeletionSummary] = useState<{
    saleInvoicesCount: number;
    purchaseInvoicesCount: number;
    stockMovementsCount: number;
    stockRemaindersCount: number;
    totalLinkedRecords: number;
  } | null>(null);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

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

  async function openDeleteModal(store: Store) {
    setDeleteStoreTarget(store);
    setConfirmPassword('');
    setDeleteError('');
    setDeletionSummary(null);
    try {
      const summary = await api.getStoreDeletionSummary(store.id);
      setDeletionSummary(summary);
    } catch {
      setDeletionSummary(null);
    }
  }

  async function confirmDeleteStore() {
    if (!deleteStoreTarget) return;
    if (!confirmPassword.trim()) {
      setDeleteError('Admin password is required to confirm deletion');
      return;
    }
    setDeleting(true);
    setDeleteError('');
    try {
      await api.deleteStore(deleteStoreTarget.id, confirmPassword.trim());
      setMessage(`Store "${deleteStoreTarget.name}" deleted and all associated data reversed.`);
      setDeleteStoreTarget(null);
      await load();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete store');
    } finally {
      setDeleting(false);
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
                  <div className="flex items-center gap-2">
                    <SecondaryButton type="button" disabled={busy} onClick={() => void onToggle(store)}>
                      {store.isActive ? 'Deactivate' : 'Activate'}
                    </SecondaryButton>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void openDeleteModal(store)}
                      className="px-3 py-1.5 text-xs font-semibold rounded bg-danger/10 text-danger hover:bg-danger/20 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
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

      {/* Delete confirmation modal */}
      {deleteStoreTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md bg-surface rounded-xl border border-border p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-danger">Confirm Hard Delete Store</h3>
            <p className="text-sm text-textPrimary">
              Are you sure you want to permanently delete store <strong>&quot;{deleteStoreTarget.name}&quot;</strong>?
            </p>
            {deletionSummary ? (
              <div className="bg-danger/10 border border-danger/20 rounded-lg p-3 text-xs text-danger space-y-1">
                <p className="font-bold">Associated Data Summary:</p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>Sale Invoices: {deletionSummary.saleInvoicesCount}</li>
                  <li>Purchase Invoices: {deletionSummary.purchaseInvoicesCount}</li>
                  <li>Stock Movements: {deletionSummary.stockMovementsCount}</li>
                  <li>Stock Remainders: {deletionSummary.stockRemaindersCount}</li>
                </ul>
                <p className="mt-2 font-medium">
                  Deleting will reverse all associated vouchers/ledger entries and stock records tied to this store.
                </p>
              </div>
            ) : null}

            <div>
              <FieldLabel>Admin Password Confirmation</FieldLabel>
              <PasswordInput
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Enter your password"
              />
            </div>

            {deleteError ? <p className="text-xs text-danger font-medium">{deleteError}</p> : null}

            <div className="flex items-center justify-end gap-3 pt-2">
              <SecondaryButton type="button" onClick={() => setDeleteStoreTarget(null)}>
                Cancel
              </SecondaryButton>
              <button
                type="button"
                disabled={deleting || !confirmPassword.trim()}
                onClick={() => void confirmDeleteStore()}
                className="px-4 py-2 bg-danger hover:bg-danger/90 disabled:opacity-50 text-white font-semibold text-sm rounded-lg transition-colors"
              >
                {deleting ? 'Deleting Store…' : 'Delete & Reverse Data'}
              </button>
            </div>
          </div>
        </div>
      )}

      <PageCloseBar />
    </PageShell>
  );
}
