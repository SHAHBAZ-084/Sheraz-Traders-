import { FormEvent, useEffect, useState } from 'react';
import { api, type Party } from '../../lib/api';
import { formatLedgerBalance } from '../../lib/format';
import { FieldLabel, PageShell, Panel, PrimaryButton, SecondaryButton, TextInput } from '../../components/ui/PageShell';

function PartyPage({
  title,
  subtitle,
  listFn,
  createFn,
  removeFn,
}: {
  title: string;
  subtitle: string;
  listFn: () => Promise<Party[]>;
  createFn: (data: Record<string, string>) => Promise<Party>;
  removeFn: (id: number) => Promise<unknown>;
}) {
  const [parties, setParties] = useState<Party[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function refresh() {
    setParties(await listFn());
  }

  useEffect(() => {
    refresh().catch(() => setParties([]));
  }, []);

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
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  async function onRemove(id: number) {
    if (!confirm('Remove this party?')) return;
    setError('');
    try {
      await removeFn(id);
      await refresh();
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
              <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} />
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
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {parties.map((party) => (
              <tr key={party.id} className="border-b border-border">
                <td className="py-2 font-medium">{party.name}</td>
                <td className="py-2">{party.phone ?? '—'}</td>
                <td className="py-2">{formatLedgerBalance(party.balance ?? 0)}</td>
                <td className="py-2 text-right">
                  <SecondaryButton className="text-xs" onClick={() => onRemove(party.id)}>Remove</SecondaryButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {parties.length === 0 ? <p className="py-4 text-sm text-textMuted">No parties yet.</p> : null}
      </Panel>
    </PageShell>
  );
}

export function SalePartiesPage() {
  return (
    <PartyPage
      title="Sale Party"
      subtitle="Sale Party ledger accounts — each party gets an account under Sale Party"
      listFn={api.listSaleParties}
      createFn={api.createSaleParty}
      removeFn={api.removeSaleParty}
    />
  );
}

export function PurchasePartiesPage() {
  return (
    <PartyPage
      title="Purchase Party"
      subtitle="Ext. Purchase Party ledger accounts — each party gets an account under Ext. Purchase Party"
      listFn={api.listPurchaseParties}
      createFn={api.createPurchaseParty}
      removeFn={api.removePurchaseParty}
    />
  );
}
