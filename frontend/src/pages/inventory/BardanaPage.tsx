import { FormEvent, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { FieldLabel, PageShell, Panel, PrimaryButton, TextInput } from '../../components/ui/PageShell';
import { PageCloseBar } from '../../components/ui/PageCloseBar';

type BagType = 'BORI' | 'THELA';
type EmptyBardanaReport = Awaited<ReturnType<typeof api.getEmptyBardana>>;

function bagLabel(bagType: BagType) {
  return bagType === 'THELA' ? 'Thela' : 'Bori';
}

export function BardanaPage() {
  const [report, setReport] = useState<EmptyBardanaReport | null>(null);
  const [bagType, setBagType] = useState<BagType>('BORI');
  const [quantity, setQuantity] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function refresh() {
    setReport(await api.getEmptyBardana());
  }

  useEffect(() => {
    refresh().catch(() => setReport(null));
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Enter a quantity greater than zero');
      return;
    }
    setSaving(true);
    try {
      setReport(await api.addEmptyBardana({ bagType, quantity: qty }));
      setMessage(`Added ${qty} ${bagLabel(bagType)} bags.`);
      setQuantity('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add empty bardana');
    } finally {
      setSaving(false);
    }
  }

  const bori = report?.balances.find((b) => b.bagType === 'BORI')?.balance ?? 0;
  const thela = report?.balances.find((b) => b.bagType === 'THELA')?.balance ?? 0;

  return (
    <PageShell
      title="Empty Bardana"
      subtitle="Physical empty bag inventory — manual add, auto-reduced on Sale on Paunch"
    >
      <Panel className="mb-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm text-textSecondary">Bori count</p>
            <p className={`mt-1 text-3xl font-semibold tabular-nums ${bori < 0 ? 'text-danger' : 'text-textPrimary'}`}>
              {bori}
            </p>
          </div>
          <div>
            <p className="text-sm text-textSecondary">Thela count</p>
            <p className={`mt-1 text-3xl font-semibold tabular-nums ${thela < 0 ? 'text-danger' : 'text-textPrimary'}`}>
              {thela}
            </p>
          </div>
        </div>
      </Panel>

      <Panel className="mb-4 max-w-lg">
        <form className="grid gap-3 sm:grid-cols-3 sm:items-end" onSubmit={onSubmit}>
          <div>
            <FieldLabel>Type</FieldLabel>
            <SegmentedControl
              value={bagType}
              onChange={(v) => setBagType(v as BagType)}
              options={[
                { value: 'BORI', label: 'Bori' },
                { value: 'THELA', label: 'Thela' },
              ]}
            />
          </div>
          <div>
            <FieldLabel>Add quantity</FieldLabel>
            <TextInput
              type="number"
              min="0"
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              inputMode="decimal"
              required
            />
          </div>
          <div>
            <PrimaryButton type="submit" disabled={saving}>
              {saving ? 'Adding…' : 'Add'}
            </PrimaryButton>
          </div>
        </form>
        {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
        {message ? <p className="mt-2 text-sm text-success">{message}</p> : null}
      </Panel>

      <Panel>
        <h3 className="mb-3 text-sm font-semibold text-textPrimary">Recent movements</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-textSecondary">
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3">Source</th>
                <th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3">Direction</th>
                <th className="py-2 text-right">Qty</th>
              </tr>
            </thead>
            <tbody>
              {!report || report.movements.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-textSecondary">
                    No movements yet. Add bags manually, or save a Sale on Paunch invoice.
                  </td>
                </tr>
              ) : (
                report.movements.map((m) => (
                  <tr key={m.id} className="border-b border-border">
                    <td className="py-2 pr-3 whitespace-nowrap">{formatDate(m.date)}</td>
                    <td className="py-2 pr-3">{m.description ?? m.source}</td>
                    <td className="py-2 pr-3">{bagLabel(m.bagType)}</td>
                    <td className={`py-2 pr-3 font-medium ${m.direction === 'IN' ? 'text-success' : 'text-danger'}`}>
                      {m.direction === 'IN' ? '+' : '−'}
                    </td>
                    <td className="py-2 text-right tabular-nums">{m.qty}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
      <PageCloseBar />
    </PageShell>
  );
}
