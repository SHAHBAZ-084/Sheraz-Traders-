import { useEffect, useState } from 'react';
import { api, type Product } from '../../lib/api';
import {
  FieldLabel,
  PageShell,
  Panel,
  SecondaryButton,
} from '../../components/ui/PageShell';

/**
 * Legacy products page — currently hosts Remove Product only.
 * Add Product moved to `/products/add` (AddProductPage).
 * Confirm later whether this file should become a full Manage Products screen or be deleted.
 */
export function ProductRemovePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedId, setSelectedId] = useState<number | ''>('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.listProducts().then(setProducts).catch(() => setProducts([]));
  }, []);

  async function onRemove() {
    setError('');
    setMessage('');
    try {
      if (!selectedId) throw new Error('Select a product');
      await api.removeProduct(Number(selectedId));
      setMessage('Product removed.');
      setSelectedId('');
      setProducts(await api.listProducts());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  return (
    <PageShell title="Remove Product" subtitle="Only products with zero ledger balance can be removed">
      <Panel className="max-w-lg space-y-4">
        <div>
          <FieldLabel>Product</FieldLabel>
          <select
            className="w-full rounded-lg border border-border px-3 py-2 text-sm"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">Select product</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.category ? ` (${p.category.name})` : ''}
              </option>
            ))}
          </select>
        </div>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        {message ? <p className="text-sm text-success">{message}</p> : null}
        <SecondaryButton onClick={onRemove}>Remove Product</SecondaryButton>
      </Panel>
    </PageShell>
  );
}
