import { FormEvent, useEffect, useMemo, useState } from 'react';
import { FieldLabel, PageShell, Panel, PrimaryButton, TextInput } from '../../components/ui/PageShell';
import { PageCloseBar } from '../../components/ui/PageCloseBar';
import { SearchSelect } from '../../components/ui/SearchSelect';
import { api, type Product, type ProductCategory, type Store } from '../../lib/api';

function todayInputValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function StockTransferPage() {
  const [transferDate, setTransferDate] = useState(todayInputValue);
  const [fromStoreId, setFromStoreId] = useState('');
  const [toStoreId, setToStoreId] = useState('');
  const [productCategoryId, setProductCategoryId] = useState('');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [stores, setStores] = useState<Store[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productCategories, setProductCategories] = useState<ProductCategory[]>([]);
  const [availableBalance, setAvailableBalance] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([api.listProducts(), api.listProductCategories(), api.listActiveStores()])
      .then(([prods, cats, activeStores]) => {
        setProducts(Array.isArray(prods) ? prods : []);
        setProductCategories(Array.isArray(cats) ? cats : []);
        setStores(Array.isArray(activeStores) ? activeStores : []);
      })
      .catch(() => setError('Failed to load form data'));
  }, []);

  useEffect(() => {
    setAvailableBalance(null);
    if (!productId || !fromStoreId) return;
    let cancelled = false;
    api
      .getStockBalance({ productId: Number(productId), storeId: Number(fromStoreId) })
      .then((result) => {
        if (!cancelled) setAvailableBalance(result.balance);
      })
      .catch(() => {
        if (!cancelled) setAvailableBalance(null);
      });
    return () => {
      cancelled = true;
    };
  }, [productId, fromStoreId]);

  const storeOptions = useMemo(
    () => (Array.isArray(stores) ? stores : []).map((s) => ({ value: String(s.id), label: s.name })),
    [stores],
  );
  const productCategoryOptions = useMemo(
    () => (Array.isArray(productCategories) ? productCategories : []).map((c) => ({ value: String(c.id), label: c.name })),
    [productCategories],
  );
  const productOptions = useMemo(() => {
    const safeProds = Array.isArray(products) ? products : [];
    const filtered = productCategoryId
      ? safeProds.filter((p) => String(p.categoryId ?? '') === productCategoryId)
      : safeProds;
    return filtered.map((p) => ({ value: String(p.id), label: p.name }));
  }, [products, productCategoryId]);

  function onProductCategoryChange(value: string) {
    setProductCategoryId(value);
    setProductId('');
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');

    if (!fromStoreId || !toStoreId) {
      setError('Select both From Store and To Store');
      return;
    }
    if (fromStoreId === toStoreId) {
      setError('From Store and To Store must be different');
      return;
    }
    if (!productId) {
      setError('Select a product');
      return;
    }
    const qty = Number(quantity);
    if (!(qty > 0) || !Number.isFinite(qty)) {
      setError('Quantity must be greater than zero');
      return;
    }

    if (availableBalance != null && qty > availableBalance) {
      setError(`Insufficient stock at From Store: available ${availableBalance}, requested ${qty}`);
      return;
    }

    setSaving(true);
    try {
      if (availableBalance == null) {
        const balance = await api.getStockBalance({
          productId: Number(productId),
          storeId: Number(fromStoreId),
        });
        if (qty > balance.balance) {
          setError(
            `Insufficient stock at From Store: available ${balance.balance}, requested ${qty}`,
          );
          return;
        }
      }

      const result = await api.createStockTransfer({
        transferDate,
        fromStoreId: Number(fromStoreId),
        toStoreId: Number(toStoreId),
        productId: Number(productId),
        quantity: qty,
      });
      setMessage(`Transfer saved as ${result.reference}.`);
      setQuantity('1');
      setProductId('');
      setAvailableBalance(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to transfer stock');
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell title="Transfer Stock" subtitle="Move product quantity between stores">
      <Panel className="max-w-2xl">
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel>Date</FieldLabel>
              <TextInput
                type="date"
                value={transferDate}
                onChange={(e) => setTransferDate(e.target.value)}
                required
              />
            </div>
            <div className="hidden sm:block" />
            <div>
              <FieldLabel>From Store</FieldLabel>
              <SearchSelect
                options={storeOptions}
                value={fromStoreId}
                onChange={setFromStoreId}
                placeholder="Select source store"
              />
            </div>
            <div>
              <FieldLabel>To Store</FieldLabel>
              <SearchSelect
                options={storeOptions}
                value={toStoreId}
                onChange={setToStoreId}
                placeholder="Select destination store"
              />
            </div>
            <div>
              <FieldLabel>Category</FieldLabel>
              <SearchSelect
                options={productCategoryOptions}
                value={productCategoryId}
                onChange={onProductCategoryChange}
                placeholder="Filter by category"
              />
            </div>
            <div>
              <FieldLabel>Product</FieldLabel>
              <SearchSelect
                options={productOptions}
                value={productId}
                onChange={setProductId}
                placeholder={productCategoryId ? 'Select product' : 'Select category first (or pick any)'}
              />
            </div>
            <div>
              <FieldLabel>Quantity</FieldLabel>
              <TextInput
                type="number"
                min="0.01"
                step="any"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                required
              />
              {availableBalance != null ? (
                <p className="mt-1 text-xs text-textMuted">
                  Available at From Store: {availableBalance}
                </p>
              ) : null}
            </div>
          </div>

          {error ? <p className="text-sm text-danger">{error}</p> : null}
          {message ? <p className="text-sm text-success">{message}</p> : null}

          <PrimaryButton type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save Transfer'}
          </PrimaryButton>
        </form>
      </Panel>
      <PageCloseBar />
    </PageShell>
  );
}
