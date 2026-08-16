import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useIsAdmin } from '../../hooks/useIsAdmin';
import { api, type Product, type ProductCategory, type Store } from '../../lib/api';
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
  const isAdmin = useIsAdmin();
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [openingStock, setOpeningStock] = useState('');
  const [openingStockRate, setOpeningStockRate] = useState('');
  const [openingStoreId, setOpeningStoreId] = useState<number | ''>('');
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');
  const [listMessage, setListMessage] = useState('');
  const [search, setSearch] = useState('');
  const [filterCategoryId, setFilterCategoryId] = useState<number | '' | 'none'>('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editUnit, setEditUnit] = useState('');
  const [editCategoryId, setEditCategoryId] = useState<number | ''>('');
  const [editBusy, setEditBusy] = useState(false);

  async function loadCategories() {
    try {
      const res = await api.listProductCategories();
      setCategories(Array.isArray(res) ? res : []);
    } catch {
      setCategories([]);
    }
  }

  async function loadStores() {
    try {
      const res = await api.listActiveStores();
      const rows = Array.isArray(res) ? res : [];
      setStores(rows);
      if (rows.length === 1) {
        setOpeningStoreId(rows[0].id);
      }
    } catch {
      setStores([]);
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
    void loadStores();
    void loadProducts();
  }, []);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (products ?? []).filter((p) => {
      if (filterCategoryId === 'none') {
        if (p.categoryId != null) return false;
      } else if (filterCategoryId !== '' && (p.categoryId ?? null) !== filterCategoryId) {
        return false;
      }
      if (!q) return true;
      const haystack = [p.name, p.unit ?? '', p.category?.name ?? '', p.account?.name ?? '', p.code]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [products, search, filterCategoryId]);

  async function onAddCategory() {
    setError('');
    setMessage('');
    setCategoryBusy(true);
    try {
      const created = await api.createProductCategory({ name: newCategoryName });
      await loadCategories();
      if (editingId != null) {
        setEditCategoryId(created.id);
      } else {
        setCategoryId(created.id);
      }
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

    const qtyBlank = openingStock.trim() === '';
    const rateBlank = openingStockRate.trim() === '';
    const parsedOpeningStock = qtyBlank ? undefined : Number(openingStock);
    const parsedOpeningRate = rateBlank ? undefined : Number(openingStockRate);

    if (parsedOpeningStock != null && (!Number.isFinite(parsedOpeningStock) || parsedOpeningStock < 0)) {
      setError('Opening stock quantity must be zero or greater');
      return;
    }
    if (parsedOpeningRate != null && (!Number.isFinite(parsedOpeningRate) || parsedOpeningRate < 0)) {
      setError('Opening stock rate must be zero or greater');
      return;
    }

    const hasQty = parsedOpeningStock != null && parsedOpeningStock > 0;
    const hasRate = parsedOpeningRate != null && parsedOpeningRate > 0;
    if (hasQty !== hasRate) {
      setError('Opening stock quantity and rate must both be provided together (or both left blank)');
      return;
    }
    if (hasQty && openingStoreId === '') {
      setError('Select a store for the opening stock quantity');
      return;
    }

    try {
      const product = await api.createProduct({
        name,
        unit: unit || undefined,
        categoryId: categoryId === '' ? undefined : categoryId,
        openingStock: hasQty ? parsedOpeningStock : undefined,
        openingStockRate: hasRate ? parsedOpeningRate : undefined,
        openingStoreId: openingStoreId === '' ? undefined : openingStoreId,
      });
      const stockNote =
        hasQty && hasRate
          ? ` Opening stock: ${parsedOpeningStock}${unit ? ` ${unit}` : ''} @ ${parsedOpeningRate} (value ${(parsedOpeningStock! * parsedOpeningRate!).toLocaleString()}).`
          : '';
      setMessage(
        `Product "${product.name}" created with ledger ${product.account?.name ?? ''}`.trim()
          + (product.category ? ` (category: ${product.category.name}).` : '.')
          + stockNote,
      );
      setName('');
      setUnit('');
      setCategoryId('');
      setOpeningStock('');
      setOpeningStockRate('');
      if (stores.length !== 1) {
        setOpeningStoreId('');
      }
      await loadProducts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  function startEdit(product: Product) {
    setListError('');
    setListMessage('');
    setEditingId(product.id);
    setEditName(product.name);
    setEditUnit(product.unit ?? '');
    setEditCategoryId(product.categoryId ?? '');
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName('');
    setEditUnit('');
    setEditCategoryId('');
    setEditBusy(false);
  }

  async function onSaveEdit(event: FormEvent) {
    event.preventDefault();
    if (editingId == null) return;
    setListError('');
    setListMessage('');
    setEditBusy(true);
    try {
      const updated = await api.updateProduct(editingId, {
        name: editName.trim(),
        unit: editUnit.trim() === '' ? null : editUnit.trim(),
        categoryId: editCategoryId === '' ? null : editCategoryId,
      });
      setListMessage(`Product "${updated.name}" updated.`);
      cancelEdit();
      await loadProducts();
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Failed to update product');
    } finally {
      setEditBusy(false);
    }
  }

  async function onDelete(product: Product) {
    if (!confirm(`Remove product "${product.name}"? Only allowed when ledger balance is zero.`)) return;
    setListError('');
    setListMessage('');
    try {
      await api.removeProduct(product.id);
      if (editingId === product.id) cancelEdit();
      setListMessage(`Product "${product.name}" removed.`);
      await loadProducts();
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Failed to remove product');
    }
  }

  const unitHint = unit.trim() || 'unit';
  const editingProduct = editingId != null ? products.find((p) => p.id === editingId) : null;
  const openingQtyEntered = openingStock.trim() !== '' && Number(openingStock) > 0;

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
            <TextInput value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. Bags, Litres, Kg" />
          </div>
          <div>
            <FieldLabel>Opening stock (optional — set once at creation)</FieldLabel>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <FieldLabel>Quantity</FieldLabel>
                <TextInput
                  type="number"
                  min={0}
                  step="any"
                  value={openingStock}
                  onChange={(e) => setOpeningStock(e.target.value)}
                  placeholder={`Qty (${unitHint})`}
                />
              </div>
              <div>
                <FieldLabel>Rate</FieldLabel>
                <TextInput
                  type="number"
                  min={0}
                  step="any"
                  value={openingStockRate}
                  onChange={(e) => setOpeningStockRate(e.target.value)}
                  placeholder={`Price per ${unitHint}`}
                />
              </div>
              <div>
                <FieldLabel>Store</FieldLabel>
                <select
                  className="w-full rounded-sm border border-border px-2.5 py-2 text-sm"
                  value={openingStoreId}
                  onChange={(e) => setOpeningStoreId(e.target.value ? Number(e.target.value) : '')}
                  required={openingQtyEntered}
                  disabled={stores.length === 0}
                >
                  <option value="">{stores.length === 0 ? 'No active stores' : 'Select store'}</option>
                  {stores.map((store) => (
                    <option key={store.id} value={store.id}>{store.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <p className="mt-1 text-xs text-textMuted">
              Quantity and rate are required together. Select the store that holds the opening stock. Value (qty × rate) debits the product ledger and credits Opening Balance Equity.
            </p>
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
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3 relative z-[1]">
          <h2 className="text-sm font-semibold text-textPrimary">Products</h2>
          <div className="flex flex-wrap gap-2">
            <div className="min-w-[12rem]">
              <FieldLabel>Search</FieldLabel>
              <TextInput
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, unit, ledger…"
              />
            </div>
            <div className="min-w-[10rem]">
              <FieldLabel>Filter category</FieldLabel>
              <select
                className="w-full rounded-sm border border-border px-2.5 py-2 text-sm"
                value={filterCategoryId === '' ? '' : String(filterCategoryId)}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') setFilterCategoryId('');
                  else if (v === 'none') setFilterCategoryId('none');
                  else setFilterCategoryId(Number(v));
                }}
              >
                <option value="">All categories</option>
                <option value="none">No category</option>
                {(Array.isArray(categories) ? categories : []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {editingProduct ? (
          <form
            className="mb-4 space-y-3 rounded-sm border border-border bg-surface3 p-3"
            onSubmit={onSaveEdit}
          >
            <h3 className="text-sm font-semibold text-textPrimary">
              Edit product — {editingProduct.name}
            </h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <FieldLabel>Name</FieldLabel>
                <TextInput value={editName} onChange={(e) => setEditName(e.target.value)} required />
              </div>
              <div>
                <FieldLabel>Unit</FieldLabel>
                <TextInput value={editUnit} onChange={(e) => setEditUnit(e.target.value)} placeholder="e.g. Bags" />
              </div>
              <div>
                <FieldLabel>Category</FieldLabel>
                <select
                  className="w-full rounded-sm border border-border px-2.5 py-2 text-sm"
                  value={editCategoryId}
                  onChange={(e) => setEditCategoryId(e.target.value ? Number(e.target.value) : '')}
                >
                  <option value="">No category</option>
                  {(Array.isArray(categories) ? categories : []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-xs text-textMuted">Opening stock cannot be changed after creation.</p>
            <div className="flex flex-wrap gap-2">
              <PrimaryButton type="submit" disabled={editBusy || !editName.trim()}>
                {editBusy ? 'Saving…' : 'Save changes'}
              </PrimaryButton>
              <SecondaryButton type="button" onClick={cancelEdit}>Cancel</SecondaryButton>
            </div>
          </form>
        ) : null}

        {listError ? <p className="mb-2 text-sm text-danger">{listError}</p> : null}
        {listMessage ? <p className="mb-2 text-sm text-success">{listMessage}</p> : null}

        <LegacyTable>
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>Unit</th>
              <th>Ledger</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredProducts.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-textMuted">
                  {(products?.length ?? 0) === 0 ? 'No products yet.' : 'No products match the search/filter.'}
                </td>
              </tr>
            ) : (
              filteredProducts.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.category?.name ?? '—'}</td>
                  <td>{p.unit ?? '—'}</td>
                  <td>{p.account?.name ?? p.code}</td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="text-xs font-medium text-textAccent underline-offset-2 hover:underline"
                        onClick={() => startEdit(p)}
                      >
                        Edit
                      </button>
                      {isAdmin ? (
                        <button
                          type="button"
                          className="text-xs font-medium text-danger underline-offset-2 hover:underline"
                          onClick={() => void onDelete(p)}
                        >
                          Delete
                        </button>
                      ) : null}
                    </div>
                  </td>
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
