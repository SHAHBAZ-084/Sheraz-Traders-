import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ListPagination } from '../../components/ui/ListPagination';
import { useIsAdmin } from '../../hooks/useIsAdmin';
import { api, type Party } from '../../lib/api';
import { formatLedgerBalance } from '../../lib/format';
import { PhoneInput } from '../../components/ui/PhoneInput';
import { BROWSE_PAGE_SIZE } from '../../lib/pagination';
import { FieldLabel, PageShell, Panel, PrimaryButton, SecondaryButton, TextInput } from '../../components/ui/PageShell';
import { PageCloseBar } from '../../components/ui/PageCloseBar';

function PartyPage({
  title,
  subtitle,
  listFn,
  createFn,
  removeFn,
}: {
  title: string;
  subtitle: string;
  listFn: (pagination: { limit: number; offset: number }) => Promise<{ items: Party[]; total: number }>;
  createFn: (data: Record<string, string>) => Promise<Party>;
  removeFn: (id: number) => Promise<unknown>;
}) {
  const [parties, setParties] = useState<Party[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const isAdmin = useIsAdmin();

  const refresh = useCallback(async (pageOffset = offset) => {
    try {
      const res = await listFn({ limit: BROWSE_PAGE_SIZE, offset: pageOffset });
      setParties(Array.isArray(res.items) ? res.items : []);
      setTotal(res.total ?? 0);
    } catch {
      setParties([]);
      setTotal(0);
    }
  }, [listFn, offset]);

  useEffect(() => {
    void refresh(offset);
  }, [refresh, offset]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      await createFn({ name, ...(phone ? { phone } : {}) });
      setMessage('Party saved with ledger account.');
      setName('');
      setPhone('');
      setShowForm(false);
      setOffset(0);
      await refresh(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  async function onRemove(id: number) {
    if (!confirm('Remove this party?')) return;
    setError('');
    try {
      await removeFn(id);
      const nextOffset = offset >= total - 1 && offset > 0 ? Math.max(0, offset - BROWSE_PAGE_SIZE) : offset;
      setOffset(nextOffset);
      await refresh(nextOffset);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  return (
    <PageShell
      title={title}
      subtitle={subtitle}
      actions={<PrimaryButton onClick={() => setShowForm(true)}>Create new</PrimaryButton>}
    >
      {showForm ? (
        <Panel className="mb-4 max-w-lg">
          <form className="space-y-3" onSubmit={onCreate}>
            <div>
              <FieldLabel>Name</FieldLabel>
              <TextInput value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <FieldLabel>Phone</FieldLabel>
              <PhoneInput value={phone} onChange={setPhone} />
            </div>
            <div className="flex gap-2">
              <PrimaryButton type="submit">Save</PrimaryButton>
              <SecondaryButton type="button" onClick={() => setShowForm(false)}>Cancel</SecondaryButton>
            </div>
          </form>
        </Panel>
      ) : null}

      {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}
      {message ? <p className="mb-3 text-sm text-success">{message}</p> : null}

      <Panel>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-textSecondary">
              <th className="py-2">Name</th>
              <th className="py-2">Phone</th>
              <th className="py-2">Balance</th>
              {isAdmin ? <th className="py-2" /> : null}
            </tr>
          </thead>
          <tbody>
            {(Array.isArray(parties) ? parties : []).map((party) => (
              <tr key={party.id} className="border-b border-border">
                <td className="py-2 font-medium">{party.name}</td>
                <td className="py-2">{party.phone ?? '—'}</td>
                <td className="py-2">{formatLedgerBalance(party.balance ?? 0)}</td>
                {isAdmin ? (
                  <td className="py-2 text-right">
                    <SecondaryButton className="text-xs" onClick={() => onRemove(party.id)}>Remove</SecondaryButton>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
        {(parties?.length ?? 0) === 0 ? <p className="py-4 text-sm text-textMuted">No parties yet.</p> : null}
        <ListPagination total={total} offset={offset} onPageChange={setOffset} className="mt-4" />
      </Panel>
      <PageCloseBar />
    </PageShell>
  );
}

export function SalePartiesPage() {
  return (
    <PartyPage
      title="Sale Party"
      subtitle="Sale Party ledger accounts — each party gets an account under Sale Party"
      listFn={api.listSalePartiesPage}
      createFn={api.createSaleParty}
      removeFn={api.removeSaleParty}
    />
  );
}

export function PurchasePartiesPage() {
  return (
    <PartyPage
      title="Purchase Party"
      subtitle="Purchase Party ledger accounts — each party gets an account under Purchase Party"
      listFn={api.listPurchasePartiesPage}
      createFn={api.createPurchaseParty}
      removeFn={api.removePurchaseParty}
    />
  );
}
