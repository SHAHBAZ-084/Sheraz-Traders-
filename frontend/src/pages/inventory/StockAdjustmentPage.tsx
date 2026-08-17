import { FormEvent, useEffect, useMemo, useState } from 'react';
import { FieldLabel, PageShell, Panel, PrimaryButton, TextInput } from '../../components/ui/PageShell';
import { DecimalInput } from '../../components/ui/DecimalInput';
import { AmountInput } from '../../components/ui/AmountInput';
import { PageCloseBar } from '../../components/ui/PageCloseBar';
import { SearchSelect } from '../../components/ui/SearchSelect';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import {
  api,
  type Account,
  type AccountCategory,
  type Product,
  type ProductCategory,
  type Store,
} from '../../lib/api';
import {
  computeKachiOpeningStockValue,
  formatWeightMaundKg,
  parseNum,
  type KachiBagMode,
} from '../../lib/kachiMaalCalculations';
import { formatLedgerAmount, formatLedgerBalance, sanitizeAmountInput } from '../../lib/format';
import { kachiUrduLabel } from '../../lib/kachiUrduLabels';

type ProductKindFilter = 'OTHER' | 'KACHI';
type AdjustmentTab = 'stock' | 'account';

const MAAL_KHATA_CATEGORY_NAME = 'Products';

function todayInputValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function StockAdjustmentPage() {
  const [tab, setTab] = useState<AdjustmentTab>('stock');

  const [adjustmentDate, setAdjustmentDate] = useState(todayInputValue);
  const [productKind, setProductKind] = useState<ProductKindFilter>('OTHER');
  const [categoryId, setCategoryId] = useState('');
  const [productId, setProductId] = useState('');
  const [storeId, setStoreId] = useState<number | ''>('');
  const [quantity, setQuantity] = useState('');
  const [rate, setRate] = useState('');
  const [kachiBagMode, setKachiBagMode] = useState<KachiBagMode>('THELA');
  const [kachiBagCount, setKachiBagCount] = useState('');
  const [kachiDharan, setKachiDharan] = useState('');
  const [kachiLooseKg, setKachiLooseKg] = useState('');
  const [kachiBhartii, setKachiBhartii] = useState('');
  const [kachiRatePerMaund, setKachiRatePerMaund] = useState('');
  const [productCategories, setProductCategories] = useState<ProductCategory[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [currentStockBalance, setCurrentStockBalance] = useState<number | null>(null);
  const [stockError, setStockError] = useState('');
  const [stockMessage, setStockMessage] = useState('');
  const [stockSaving, setStockSaving] = useState(false);

  const [accountAdjustmentDate, setAccountAdjustmentDate] = useState(todayInputValue);
  const [accountCategoryId, setAccountCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [adjustmentSide, setAdjustmentSide] = useState<'DR' | 'CR'>('DR');
  const [accountCategories, setAccountCategories] = useState<AccountCategory[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountError, setAccountError] = useState('');
  const [accountMessage, setAccountMessage] = useState('');
  const [accountSaving, setAccountSaving] = useState(false);

  useEffect(() => {
    Promise.all([api.listProducts(), api.listProductCategories(), api.listActiveStores()])
      .then(([prods, cats, activeStores]) => {
        setProducts(Array.isArray(prods) ? prods : []);
        setProductCategories(Array.isArray(cats) ? cats : []);
        const rows = Array.isArray(activeStores) ? activeStores : [];
        setStores(rows);
        if (rows.length === 1) {
          setStoreId(rows[0].id);
        }
      })
      .catch(() => setStockError('Failed to load stock form data'));
  }, []);

  useEffect(() => {
    Promise.all([api.listCategories(), api.listAccounts()])
      .then(([cats, accts]) => {
        setAccountCategories(Array.isArray(cats) ? cats : []);
        setAccounts(Array.isArray(accts) ? accts : []);
      })
      .catch(() => setAccountError('Failed to load account form data'));
  }, []);

  useEffect(() => {
    setCurrentStockBalance(null);
    if (!productId || storeId === '') return;
    let cancelled = false;
    api
      .getStockBalance({ productId: Number(productId), storeId: Number(storeId) })
      .then((result) => {
        if (!cancelled) setCurrentStockBalance(result.balance);
      })
      .catch(() => {
        if (!cancelled) setCurrentStockBalance(null);
      });
    return () => {
      cancelled = true;
    };
  }, [productId, storeId]);

  const productCategoryOptions = useMemo(
    () => productCategories.map((c) => ({ value: String(c.id), label: c.name })),
    [productCategories],
  );

  const productOptions = useMemo(() => {
    const kindFilter = productKind === 'KACHI' ? 'KACHI' : 'STANDARD';
    return products
      .filter((p) => (p.kind ?? 'STANDARD') === kindFilter)
      .filter((p) => !categoryId || String(p.categoryId ?? '') === categoryId)
      .map((p) => ({ value: String(p.id), label: p.name }));
  }, [products, productKind, categoryId]);

  const selectedProduct = useMemo(
    () => products.find((p) => String(p.id) === productId) ?? null,
    [products, productId],
  );

  const accountCategoryOptions = useMemo(
    () =>
      accountCategories
        .filter((c) => c.name !== MAAL_KHATA_CATEGORY_NAME)
        .map((c) => ({ value: String(c.id), label: c.name })),
    [accountCategories],
  );

  const accountOptions = useMemo(
    () =>
      accounts
        .filter((a) => a.isActive)
        .filter((a) => accountCategoryId && String(a.categoryId) === accountCategoryId)
        .map((a) => ({ value: String(a.id), label: a.name })),
    [accounts, accountCategoryId],
  );

  const selectedAccount = useMemo(
    () => accounts.find((a) => String(a.id) === accountId) ?? null,
    [accounts, accountId],
  );

  const kachiPreview = useMemo(() => {
    if (productKind !== 'KACHI') return null;
    const bagCount = parseNum(kachiBagCount);
    const dharanCount = parseNum(kachiDharan);
    const looseKg = parseNum(kachiLooseKg);
    const ratePerMaund = parseNum(kachiRatePerMaund);
    const bhartii = parseNum(kachiBhartii);
    if (bagCount === 0 && dharanCount === 0 && looseKg === 0 && ratePerMaund === 0) return null;
    return computeKachiOpeningStockValue({
      bagMode: kachiBagMode,
      bagCount,
      dharanCount,
      looseKg,
      bhartii,
      ratePerMaund,
    });
  }, [productKind, kachiBagMode, kachiBagCount, kachiDharan, kachiLooseKg, kachiBhartii, kachiRatePerMaund]);

  function onProductKindChange(next: ProductKindFilter) {
    setProductKind(next);
    setCategoryId('');
    setProductId('');
    setQuantity('');
    setRate('');
    setKachiBagCount('');
    setKachiDharan('');
    setKachiLooseKg('');
    setKachiBhartii('');
    setKachiRatePerMaund('');
  }

  function onProductCategoryChange(value: string) {
    setCategoryId(value);
    setProductId('');
  }

  function onAccountCategoryChange(value: string) {
    setAccountCategoryId(value);
    setAccountId('');
  }

  function resetStockFields() {
    setQuantity('');
    setRate('');
    setKachiBagCount('');
    setKachiDharan('');
    setKachiLooseKg('');
    setKachiBhartii('');
    setKachiRatePerMaund('');
  }

  async function onSubmitStock(event: FormEvent) {
    event.preventDefault();
    setStockError('');
    setStockMessage('');

    if (!productId) {
      setStockError('Select a product');
      return;
    }
    if (storeId === '') {
      setStockError('Select a store');
      return;
    }

    setStockSaving(true);
    try {
      if (productKind === 'KACHI') {
        const bagCount = parseNum(kachiBagCount);
        const dharanCount = parseNum(kachiDharan);
        const looseKg = parseNum(kachiLooseKg);
        const bhartii = parseNum(kachiBhartii);
        const ratePerMaund = parseNum(kachiRatePerMaund);
        const hasWeight = bagCount > 0 || dharanCount > 0 || looseKg > 0;
        const hasRate = ratePerMaund > 0;

        if (hasWeight !== hasRate) {
          setStockError('Enter purchase rate together with weight (Thela/Bori, Dharan, or Kg), or leave all blank');
          return;
        }
        if (bagCount > 0 && !(bhartii > 0)) {
          setStockError('Bhartii must be greater than zero');
          return;
        }
        if (!hasWeight) {
          setStockError('Enter kachi weight and rate for the adjustment');
          return;
        }

        const result = await api.createStockAdjustment({
          adjustmentDate,
          productId: Number(productId),
          storeId: Number(storeId),
          kachiOpening: {
            bagMode: kachiBagMode,
            bagCount,
            dharanCount,
            looseKg,
            bhartii,
            ratePerMaund,
          },
        });
        setStockMessage(
          `Stock adjustment posted for ${result.productName}. New balance at store: ${result.balance}.`,
        );
      } else {
        const qty = parseNum(quantity);
        const unitRate = parseNum(rate);
        const hasQty = qty > 0;
        const hasRate = unitRate > 0;

        if (hasQty !== hasRate) {
          setStockError('Quantity and rate must both be provided together');
          return;
        }
        if (!hasQty) {
          setStockError('Enter quantity and rate for the adjustment');
          return;
        }

        const result = await api.createStockAdjustment({
          adjustmentDate,
          productId: Number(productId),
          storeId: Number(storeId),
          quantity: qty,
          rate: unitRate,
        });
        setStockMessage(
          `Stock adjustment posted for ${result.productName}. New balance at store: ${result.balance}.`,
        );
      }

      resetStockFields();
      if (productId && typeof storeId === 'number') {
        const balance = await api.getStockBalance({
          productId: Number(productId),
          storeId,
        });
        setCurrentStockBalance(balance.balance);
      }
    } catch (err) {
      setStockError(err instanceof Error ? err.message : 'Failed to post stock adjustment');
    } finally {
      setStockSaving(false);
    }
  }

  async function onSubmitAccount(event: FormEvent) {
    event.preventDefault();
    setAccountError('');
    setAccountMessage('');

    if (!accountCategoryId) {
      setAccountError('Select a category');
      return;
    }
    if (!accountId) {
      setAccountError('Select an account');
      return;
    }

    const amount = Number(sanitizeAmountInput(adjustmentAmount));
    if (!(amount > 0) || !Number.isFinite(amount)) {
      setAccountError('Enter an adjustment amount greater than zero');
      return;
    }

    setAccountSaving(true);
    try {
      const result = await api.createAccountAdjustment({
        adjustmentDate: accountAdjustmentDate,
        accountId: Number(accountId),
        amount,
        side: adjustmentSide,
      });
      setAccountMessage(
        `Account adjustment posted for ${result.accountName}. New balance: ${formatLedgerBalance(result.balance)}.`,
      );
      setAdjustmentAmount('');

      const refreshed = await api.listAccounts();
      setAccounts(Array.isArray(refreshed) ? refreshed : []);
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : 'Failed to post account adjustment');
    } finally {
      setAccountSaving(false);
    }
  }

  const unitHint = selectedProduct?.unit?.trim() || 'unit';

  return (
    <PageShell
      title="Stock Adjustment"
      subtitle="Post stock or account adjustments against Opening Balance Equity"
    >
      <div className="mb-4 max-w-lg print:hidden">
        <SegmentedControl
          ariaLabel="Adjustment type"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'stock', label: 'Stock Adjustment' },
            { value: 'account', label: 'Account Adjustment' },
          ]}
        />
      </div>

      {tab === 'stock' ? (
        <Panel className="max-w-lg">
          <form className="space-y-4" onSubmit={onSubmitStock}>
            <div>
              <FieldLabel>Date</FieldLabel>
              <TextInput
                type="date"
                value={adjustmentDate}
                onChange={(e) => setAdjustmentDate(e.target.value)}
                required
              />
            </div>

            <div>
              <FieldLabel>Product type</FieldLabel>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="productKind"
                    checked={productKind === 'OTHER'}
                    onChange={() => onProductKindChange('OTHER')}
                  />
                  Other
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="productKind"
                    checked={productKind === 'KACHI'}
                    onChange={() => onProductKindChange('KACHI')}
                  />
                  Kachi Product
                </label>
              </div>
            </div>

            <div>
              <FieldLabel>Product category</FieldLabel>
              <SearchSelect
                value={categoryId}
                onChange={onProductCategoryChange}
                options={productCategoryOptions}
                placeholder="All categories"
              />
            </div>

            <div>
              <FieldLabel>Product</FieldLabel>
              <SearchSelect
                value={productId}
                onChange={setProductId}
                options={productOptions}
                placeholder={categoryId ? 'Search product…' : 'Select a category or search product…'}
                disabled={productOptions.length === 0}
              />
            </div>

            <div>
              <FieldLabel>Store</FieldLabel>
              <select
                className="w-full rounded-sm border border-border px-2.5 py-2 text-sm"
                value={storeId}
                onChange={(e) => setStoreId(e.target.value ? Number(e.target.value) : '')}
                required
                disabled={stores.length === 0}
              >
                <option value="">{stores.length === 0 ? 'No active stores' : 'Select store'}</option>
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </select>
              {productId && storeId !== '' && currentStockBalance != null ? (
                <p className="mt-1 text-xs text-textMuted">
                  Current stock at this store:{' '}
                  <span className="font-medium tabular-nums">{currentStockBalance}</span>
                </p>
              ) : null}
            </div>

            {productKind === 'OTHER' ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <FieldLabel>Quantity</FieldLabel>
                  <DecimalInput
                    value={quantity}
                    onChange={setQuantity}
                    inputMode="decimal"
                    placeholder={`Qty (${unitHint})`}
                  />
                </div>
                <div>
                  <FieldLabel>Rate</FieldLabel>
                  <DecimalInput value={rate} onChange={setRate} inputMode="decimal" />
                </div>
                <p className="sm:col-span-2 text-xs text-textMuted">
                  Quantity and rate are required together. Value (qty × rate) debits the product ledger and credits
                  Opening Balance Equity.
                </p>
              </div>
            ) : (
              <div className="space-y-3 rounded-sm border border-border bg-surface3 p-3">
                <FieldLabel>{kachiUrduLabel('pricing')}</FieldLabel>
                <div>
                  <FieldLabel>{kachiUrduLabel('boriThela')}</FieldLabel>
                  <div className="flex flex-wrap gap-4 text-sm">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="kachiBagMode"
                        checked={kachiBagMode === 'THELA'}
                        onChange={() => setKachiBagMode('THELA')}
                      />
                      {kachiUrduLabel('thela')}
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="kachiBagMode"
                        checked={kachiBagMode === 'BORI'}
                        onChange={() => setKachiBagMode('BORI')}
                      />
                      {kachiUrduLabel('bori')}
                    </label>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div>
                    <FieldLabel>{kachiUrduLabel('boriCount')}</FieldLabel>
                    <DecimalInput value={kachiBagCount} onChange={setKachiBagCount} inputMode="decimal" />
                  </div>
                  <div>
                    <FieldLabel>{kachiUrduLabel('dharan')}</FieldLabel>
                    <DecimalInput value={kachiDharan} onChange={setKachiDharan} inputMode="decimal" />
                  </div>
                  <div>
                    <FieldLabel>{kachiUrduLabel('kilo')}</FieldLabel>
                    <DecimalInput value={kachiLooseKg} onChange={setKachiLooseKg} inputMode="decimal" />
                  </div>
                  <div>
                    <FieldLabel>{kachiUrduLabel('bhartii')}</FieldLabel>
                    <DecimalInput value={kachiBhartii} onChange={setKachiBhartii} inputMode="decimal" />
                  </div>
                </div>
                <div>
                  <FieldLabel>{kachiUrduLabel('ratePerMaund')}</FieldLabel>
                  <DecimalInput value={kachiRatePerMaund} onChange={setKachiRatePerMaund} />
                </div>
                {kachiPreview ? (
                  <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                    <p>
                      <span className="text-textMuted">{kachiUrduLabel('totalWeight')}: </span>
                      <span className="font-medium tabular-nums">{formatWeightMaundKg(kachiPreview.totalWeightKg)}</span>
                    </p>
                    <p>
                      <span className="text-textMuted">{kachiUrduLabel('amount')}: </span>
                      <span className="font-medium tabular-nums">{formatLedgerAmount(kachiPreview.amount)}</span>
                    </p>
                  </div>
                ) : null}
              </div>
            )}

            {stockError ? <p className="text-sm text-danger">{stockError}</p> : null}
            {stockMessage ? <p className="text-sm text-accent">{stockMessage}</p> : null}

            <PrimaryButton type="submit" disabled={stockSaving}>
              {stockSaving ? 'Posting…' : 'Post Stock Adjustment'}
            </PrimaryButton>
          </form>
        </Panel>
      ) : (
        <Panel className="max-w-lg">
          <form className="space-y-4" onSubmit={onSubmitAccount}>
            <div>
              <FieldLabel>Date</FieldLabel>
              <TextInput
                type="date"
                value={accountAdjustmentDate}
                onChange={(e) => setAccountAdjustmentDate(e.target.value)}
                required
              />
            </div>

            <div>
              <FieldLabel>Category</FieldLabel>
              <SearchSelect
                value={accountCategoryId}
                onChange={onAccountCategoryChange}
                options={accountCategoryOptions}
                placeholder="Search category…"
              />
            </div>

            <div>
              <FieldLabel>Account</FieldLabel>
              <SearchSelect
                value={accountId}
                onChange={setAccountId}
                options={accountOptions}
                placeholder={accountCategoryId ? 'Search account…' : 'Select a category first'}
                disabled={!accountCategoryId}
              />
            </div>

            <p className="jv-account-balance min-h-[1.125rem] text-xs text-textSecondary">
              {selectedAccount?.ledger
                ? `Current balance: ${formatLedgerBalance(selectedAccount.ledger.balance)}`
                : '\u00A0'}
            </p>

            <div>
              <FieldLabel>Adjustment amount</FieldLabel>
              <AmountInput value={adjustmentAmount} onChange={setAdjustmentAmount} placeholder="0.00" />
            </div>

            <div>
              <FieldLabel>Side</FieldLabel>
              <select
                className="w-full rounded-sm border border-border px-2.5 py-2 text-sm"
                value={adjustmentSide}
                onChange={(e) => setAdjustmentSide(e.target.value as 'DR' | 'CR')}
              >
                <option value="DR">Dr</option>
                <option value="CR">Cr</option>
              </select>
              <p className="mt-1 text-xs text-textMuted">
                Debits the selected account and credits Opening Balance Equity (or the reverse for Cr).
              </p>
            </div>

            {accountError ? <p className="text-sm text-danger">{accountError}</p> : null}
            {accountMessage ? <p className="text-sm text-accent">{accountMessage}</p> : null}

            <PrimaryButton type="submit" disabled={accountSaving}>
              {accountSaving ? 'Posting…' : 'Post Account Adjustment'}
            </PrimaryButton>
          </form>
        </Panel>
      )}

      <PageCloseBar />
    </PageShell>
  );
}
