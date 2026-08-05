import { FormEvent, useEffect, useState } from 'react';
import { api, type Product, type ProductCategory } from '../../lib/api';
import {
  FieldLabel,
  LegacyTable,
  PageShell,
  Panel,
  PrimaryButton,
  SecondaryButton,
  TextInput,
} from '../../components/ui/PageShell';
import { PageCloseBar } from '../../components/ui/PageCloseBar';

/** Dedicated Add Product screen (product + optional business category + Products ledger). */
export function AddProductPage() {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function loadCategories() {
    try {
      const res = await api.listProductCategories();
      setCategories(Array.isArray(res) ? res : []);
    } catch {
      setCategories([]);
    }
  }

  async function loadProducts() {
    try {
      const res = await api.listProducts();
      setProducts(Array.isArray(res) ? res : []);
    } catch {
      setProducts([]);
    }
  }

  useEffect(() => {
    void loadCategories();
    void loadProducts();
  }, []);

  async function onAddCategory() {
    setError('');
    setMessage('');
    setCategoryBusy(true);
    try {
      const created = await api.createProductCategory({ name: newCategoryName });
      await loadCategories();
      setCategoryId(created.id);
      setNewCategoryName('');
      setAddingCategory(false);
      setMessage(`Category "${created.name}" added.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add category');
    } finally {
      setCategoryBusy(false);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      const product = await api.createProduct({
        name,
        unit: unit || undefined,
        categoryId: categoryId === '' ? undefined : categoryId,
      });
      setMessage(
        `Product "${product.name}" created with ledger ${product.account?.name ?? ''}`.trim()
          + (product.category ? ` (category: ${product.category.name}).` : '.'),
      );
      setName('');
      setUnit('');
      setCategoryId('');
      await loadProducts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  return (
    <PageShell title="Add Product" subtitle="Creates the product and its inventory ledger automatically">
      <Panel className="max-w-lg">
        <form className="space-y-4" onSubmit={onSubmit}>
          <div>
            <FieldLabel>Product name</FieldLabel>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <FieldLabel>Unit (optional)</FieldLabel>
            <TextInput value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. maund, kg" />
          </div>
          <div>
            <FieldLabel>Category (optional)</FieldLabel>
            <select
              className="w-full rounded-sm border border-border px-2.5 py-2 text-sm"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">No category</option>
              {(Array.isArray(categories) ? categories : []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {!addingCategory ? (
              <button
                type="button"
                className="mt-1.5 text-xs font-medium text-textAccent underline-offset-2 hover:underline"
                onClick={() => setAddingCategory(true)}
              >
                + Add new category
              </button>
            ) : (
              <div className="mt-2 space-y-2 rounded-sm border border-border bg-surface3 p-3">
                <FieldLabel>New category name</FieldLabel>
                <TextInput
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="e.g. Fertilizer, Pesticide, Seed"
                  autoFocus
                />
                <div className="flex flex-wrap gap-2">
                  <PrimaryButton type="button" disabled={categoryBusy || !newCategoryName.trim()} onClick={() => void onAddCategory()}>
                    {categoryBusy ? 'Saving…' : 'Save category'}
                  </PrimaryButton>
                  <SecondaryButton
                    type="button"
                    onClick={() => {
                      setAddingCategory(false);
                      setNewCategoryName('');
                    }}
                  >
                    Cancel
                  </SecondaryButton>
                </div>
              </div>
            )}
          </div>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          {message ? <p className="text-sm text-success">{message}</p> : null}
          <PrimaryButton type="submit">Add Product</PrimaryButton>
        </form>
      </Panel>

      <Panel className="mt-4">
        <h2 className="mb-3 text-sm font-semibold text-textPrimary">Products</h2>
        <LegacyTable>
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>Unit</th>
              <th>Ledger</th>
            </tr>
          </thead>
          <tbody>
            {(products?.length ?? 0) === 0 ? (
              <tr>
                <td colSpan={4} className="text-textMuted">No products yet.</td>
              </tr>
            ) : (
              (products ?? []).map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.category?.name ?? '—'}</td>
                  <td>{p.unit ?? '—'}</td>
                  <td>{p.account?.name ?? p.code}</td>
                </tr>
              ))
            )}
          </tbody>
        </LegacyTable>
      </Panel>
      <PageCloseBar />
    </PageShell>
  );
}
