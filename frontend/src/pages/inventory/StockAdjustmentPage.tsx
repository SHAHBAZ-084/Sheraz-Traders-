import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FieldLabel, PageShell, Panel, PrimaryButton, SecondaryButton, TextInput } from '../../components/ui/PageShell';
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
import { formatDate, formatLedgerAmount, formatLedgerBalance, sanitizeAmountInput } from '../../lib/format';
import { kachiUrduLabel } from '../../lib/kachiUrduLabels';

type ProductKindFilter = 'OTHER' | 'KACHI';
type AdjustmentTab = 'stock' | 'account';

const MAAL_KHATA_CATEGORY_NAME = 'Products';

function todayInputValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateToInputValue(date: string | Date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return todayInputValue();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type StockAdjustmentSearchRow = {
  id: number;
  productId: number;
  productName: string;
  storeId: number | null;
  storeName: string | null;
  adjustmentDate: string;
  description: string;
  quantity: number;
};

type AccountAdjustmentSearchRow = {
  id: number;
  accountId: number;
  accountName: string;
  adjustmentDate: string;
  description: string;
  amount: number;
  side: 'DR' | 'CR';
};

type AccountOpeningBalanceSearchRow = {
  id: number;
  accountId: number;
  accountName: string;
  openingDate: string;
  amount: number;
  side: 'DR' | 'CR';
};

type ProductOpeningStockSearchRow = {
  id: number;
  productId: number;
  productName: string;
  storeId: number | null;
  storeName: string | null;
  openingDate: string;
  quantity: number;
};

export function StockAdjustmentPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const pendingIdParam = searchParams.get('pendingId');
  const pendingId = pendingIdParam ? Number(pendingIdParam) : null;
  const isEditingPending = pendingId != null && Number.isFinite(pendingId) && pendingId > 0;
  const tabParam = searchParams.get('tab');
  const initialTab: AdjustmentTab =
    tabParam === 'account' ? 'account' : tabParam === 'stock' ? 'stock' : 'stock';

  const [tab, setTab] = useState<AdjustmentTab>(initialTab);

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
  const [stockDescription, setStockDescription] = useState('');
  const [productCategories, setProductCategories] = useState<ProductCategory[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [currentStockBalance, setCurrentStockBalance] = useState<number | null>(null);
  const [stockError, setStockError] = useState('');
  const [stockMessage, setStockMessage] = useState('');
  const [stockSaving, setStockSaving] = useState(false);
  const [stockSearchQuery, setStockSearchQuery] = useState('');
  const [stockSearchResults, setStockSearchResults] = useState<StockAdjustmentSearchRow[]>([]);
  const [stockSearchLoading, setStockSearchLoading] = useState(false);
  const [stockSearchError, setStockSearchError] = useState('');
  const [selectedStockAdjustment, setSelectedStockAdjustment] = useState<StockAdjustmentSearchRow | null>(null);
  const [stockEditDate, setStockEditDate] = useState(todayInputValue);
  const [stockEditDescription, setStockEditDescription] = useState('');
  const [stockEditSaving, setStockEditSaving] = useState(false);
  const [stockEditMessage, setStockEditMessage] = useState('');

  const [accountAdjustmentDate, setAccountAdjustmentDate] = useState(todayInputValue);
  const [accountDescription, setAccountDescription] = useState('');
  const [accountCategoryId, setAccountCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [adjustmentSide, setAdjustmentSide] = useState<'DR' | 'CR'>('DR');
  const [accountCategories, setAccountCategories] = useState<AccountCategory[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountError, setAccountError] = useState('');
  const [accountMessage, setAccountMessage] = useState('');
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountSearchQuery, setAccountSearchQuery] = useState('');
  const [accountSearchResults, setAccountSearchResults] = useState<AccountAdjustmentSearchRow[]>([]);
  const [accountSearchLoading, setAccountSearchLoading] = useState(false);
  const [accountSearchError, setAccountSearchError] = useState('');
  const [selectedAccountAdjustment, setSelectedAccountAdjustment] = useState<AccountAdjustmentSearchRow | null>(null);
  const [accountEditDate, setAccountEditDate] = useState(todayInputValue);
  const [accountEditDescription, setAccountEditDescription] = useState('');
  const [accountEditSaving, setAccountEditSaving] = useState(false);
  const [accountEditMessage, setAccountEditMessage] = useState('');

  const [obSearchQuery, setObSearchQuery] = useState('');
  const [obSearchResults, setObSearchResults] = useState<AccountOpeningBalanceSearchRow[]>([]);
  const [obSearchLoading, setObSearchLoading] = useState(false);
  const [obSearchError, setObSearchError] = useState('');
  const [selectedOpeningBalance, setSelectedOpeningBalance] = useState<AccountOpeningBalanceSearchRow | null>(null);
  const [obEditDate, setObEditDate] = useState(todayInputValue);
  const [obEditSaving, setObEditSaving] = useState(false);
  const [obEditMessage, setObEditMessage] = useState('');
  const [obEditWarning, setObEditWarning] = useState('');

  const [osSearchQuery, setOsSearchQuery] = useState('');
  const [osSearchResults, setOsSearchResults] = useState<ProductOpeningStockSearchRow[]>([]);
  const [osSearchLoading, setOsSearchLoading] = useState(false);
  const [osSearchError, setOsSearchError] = useState('');
  const [selectedOpeningStock, setSelectedOpeningStock] = useState<ProductOpeningStockSearchRow | null>(null);
  const [osEditDate, setOsEditDate] = useState(todayInputValue);
  const [osEditSaving, setOsEditSaving] = useState(false);
  const [osEditMessage, setOsEditMessage] = useState('');
  const [osEditWarning, setOsEditWarning] = useState('');

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
    if (!isEditingPending || pendingId == null) return;
    let cancelled = false;
    const loadPending = async () => {
      try {
        if (tabParam === 'account' || initialTab === 'account') {
          setTab('account');
          const row = await api.getPendingAccountAdjustment(pendingId);
          if (cancelled) return;
          setAccountAdjustmentDate(dateToInputValue(row.adjustmentDate));
          setAccountDescription(row.description ?? '');
          setAdjustmentAmount(row.amount > 0 ? String(row.amount) : '');
          setAdjustmentSide(row.side === 'CR' ? 'CR' : 'DR');
          if (row.account) {
            setAccountCategoryId(String(row.account.categoryId));
            setAccountId(String(row.account.id));
          } else if (row.accountId != null) {
            setAccountId(String(row.accountId));
          }
        } else {
          setTab('stock');
          const row = await api.getPendingStockAdjustment(pendingId);
          if (cancelled) return;
          setAdjustmentDate(dateToInputValue(row.adjustmentDate));
          setStockDescription(row.description ?? '');
          if (row.storeId != null) setStoreId(row.storeId);
          if (row.product) {
            const isKachi = row.product.kind === 'KACHI';
            setProductKind(isKachi ? 'KACHI' : 'OTHER');
            setCategoryId(row.product.categoryId != null ? String(row.product.categoryId) : '');
            setProductId(String(row.product.id));
            if (isKachi && row.kachiOpening && typeof row.kachiOpening === 'object') {
              const k = row.kachiOpening as Record<string, unknown>;
              setKachiBagMode(k.bagMode === 'BORI' ? 'BORI' : 'THELA');
              setKachiBagCount(k.bagCount != null ? String(k.bagCount) : '');
              setKachiDharan(k.dharanCount != null ? String(k.dharanCount) : '');
              setKachiLooseKg(k.looseKg != null ? String(k.looseKg) : '');
              setKachiBhartii(k.bhartii != null ? String(k.bhartii) : '');
              setKachiRatePerMaund(k.ratePerMaund != null ? String(k.ratePerMaund) : '');
            } else {
              setQuantity(row.quantity != null ? String(row.quantity) : '');
              setRate(row.rate != null ? String(row.rate) : '');
            }
          } else if (row.productId != null) {
            setProductId(String(row.productId));
          }
        }
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Failed to load pending adjustment';
        if (tabParam === 'account' || initialTab === 'account') setAccountError(msg);
        else setStockError(msg);
      }
    };
    void loadPending();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per pendingId
  }, [isEditingPending, pendingId]);

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

        const kachiOpening = {
          bagMode: kachiBagMode,
          bagCount,
          dharanCount,
          looseKg,
          bhartii,
          ratePerMaund,
        };

        if (isEditingPending && pendingId != null) {
          await api.updatePendingStockAdjustment(pendingId, {
            adjustmentDate,
            productId: Number(productId),
            storeId: Number(storeId),
            description: stockDescription.trim() || null,
            kachiOpening,
          });
          navigate('/system/approvals');
          return;
        }

        const result = await api.createStockAdjustment({
          adjustmentDate,
          productId: Number(productId),
          storeId: Number(storeId),
          description: stockDescription.trim() || undefined,
          kachiOpening,
        });
        setStockMessage(
          result.pendingApproval
            ? `Stock adjustment #${result.id} submitted for ${result.productName}. Stock and cost are NOT updated until an Admin approves it in Pending Approvals.`
            : `Stock adjustment posted for ${result.productName}. New balance at store: ${result.balance}.`,
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

        if (isEditingPending && pendingId != null) {
          await api.updatePendingStockAdjustment(pendingId, {
            adjustmentDate,
            productId: Number(productId),
            storeId: Number(storeId),
            quantity: qty,
            rate: unitRate,
            description: stockDescription.trim() || null,
          });
          navigate('/system/approvals');
          return;
        }

        const result = await api.createStockAdjustment({
          adjustmentDate,
          productId: Number(productId),
          storeId: Number(storeId),
          quantity: qty,
          rate: unitRate,
          description: stockDescription.trim() || undefined,
        });
        setStockMessage(
          result.pendingApproval
            ? `Stock adjustment #${result.id} submitted for ${result.productName}. Stock and cost are NOT updated until an Admin approves it in Pending Approvals.`
            : `Stock adjustment posted for ${result.productName}. New balance at store: ${result.balance}.`,
        );
      }

      resetStockFields();
      setStockDescription('');
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
      if (isEditingPending && pendingId != null) {
        await api.updatePendingAccountAdjustment(pendingId, {
          adjustmentDate: accountAdjustmentDate,
          accountId: Number(accountId),
          amount,
          side: adjustmentSide,
          description: accountDescription.trim() || null,
        });
        navigate('/system/approvals');
        return;
      }

      const result = await api.createAccountAdjustment({
        adjustmentDate: accountAdjustmentDate,
        accountId: Number(accountId),
        amount,
        side: adjustmentSide,
        description: accountDescription.trim() || undefined,
      });
      setAccountMessage(
        `Account adjustment posted for ${result.accountName}. New balance: ${formatLedgerBalance(result.balance)}.`,
      );
      setAdjustmentAmount('');
      setAccountDescription('');

      const refreshed = await api.listAccounts();
      setAccounts(Array.isArray(refreshed) ? refreshed : []);
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : 'Failed to post account adjustment');
    } finally {
      setAccountSaving(false);
    }
  }

  async function runStockSearch(e?: FormEvent) {
    e?.preventDefault();
    setStockSearchError('');
    setStockSearchLoading(true);
    setSelectedStockAdjustment(null);
    try {
      const { items } = await api.searchStockAdjustments(stockSearchQuery.trim());
      setStockSearchResults(items);
      if (items.length === 0) setStockSearchError('No matching stock adjustments found.');
    } catch (err) {
      setStockSearchError(err instanceof Error ? err.message : 'Search failed');
      setStockSearchResults([]);
    } finally {
      setStockSearchLoading(false);
    }
  }

  function selectStockAdjustment(row: StockAdjustmentSearchRow) {
    setSelectedStockAdjustment(row);
    setStockEditDate(dateToInputValue(row.adjustmentDate));
    setStockEditDescription(row.description);
    setStockEditMessage('');
  }

  async function saveStockAdjustmentEdit(e: FormEvent) {
    e.preventDefault();
    if (!selectedStockAdjustment) return;
    setStockEditSaving(true);
    setStockEditMessage('');
    try {
      const updated = await api.updateStockAdjustment(selectedStockAdjustment.id, {
        adjustmentDate: stockEditDate,
        description: stockEditDescription,
      });
      setStockEditMessage(`Updated adjustment for ${updated.productName}.`);
      setSelectedStockAdjustment({
        ...selectedStockAdjustment,
        adjustmentDate: updated.adjustmentDate,
        description: updated.description,
      });
      void runStockSearch();
    } catch (err) {
      setStockEditMessage(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setStockEditSaving(false);
    }
  }

  async function runAccountSearch(e?: FormEvent) {
    e?.preventDefault();
    setAccountSearchError('');
    setAccountSearchLoading(true);
    setSelectedAccountAdjustment(null);
    try {
      const { items } = await api.searchAccountAdjustments(accountSearchQuery.trim());
      setAccountSearchResults(items);
      if (items.length === 0) setAccountSearchError('No matching account adjustments found.');
    } catch (err) {
      setAccountSearchError(err instanceof Error ? err.message : 'Search failed');
      setAccountSearchResults([]);
    } finally {
      setAccountSearchLoading(false);
    }
  }

  function selectAccountAdjustment(row: AccountAdjustmentSearchRow) {
    setSelectedAccountAdjustment(row);
    setAccountEditDate(dateToInputValue(row.adjustmentDate));
    setAccountEditDescription(row.description);
    setAccountEditMessage('');
  }

  async function saveAccountAdjustmentEdit(e: FormEvent) {
    e.preventDefault();
    if (!selectedAccountAdjustment) return;
    setAccountEditSaving(true);
    setAccountEditMessage('');
    try {
      const updated = await api.updateAccountAdjustment(selectedAccountAdjustment.id, {
        adjustmentDate: accountEditDate,
        description: accountEditDescription,
      });
      setAccountEditMessage(`Updated adjustment for ${updated.accountName}.`);
      setSelectedAccountAdjustment({
        ...selectedAccountAdjustment,
        adjustmentDate: updated.adjustmentDate,
        description: updated.description,
      });
      void runAccountSearch();
    } catch (err) {
      setAccountEditMessage(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setAccountEditSaving(false);
    }
  }

  async function runObSearch(e?: FormEvent) {
    e?.preventDefault();
    setObSearchError('');
    setObSearchLoading(true);
    setSelectedOpeningBalance(null);
    setObEditWarning('');
    try {
      const { items } = await api.searchAccountOpeningBalances(obSearchQuery.trim());
      setObSearchResults(items);
      if (items.length === 0) setObSearchError('No matching opening balances found.');
    } catch (err) {
      setObSearchError(err instanceof Error ? err.message : 'Search failed');
      setObSearchResults([]);
    } finally {
      setObSearchLoading(false);
    }
  }

  function selectOpeningBalance(row: AccountOpeningBalanceSearchRow) {
    setSelectedOpeningBalance(row);
    setObEditDate(dateToInputValue(row.openingDate));
    setObEditMessage('');
    setObEditWarning('');
  }

  async function saveOpeningBalanceEdit(e: FormEvent) {
    e.preventDefault();
    if (!selectedOpeningBalance) return;
    setObEditSaving(true);
    setObEditMessage('');
    setObEditWarning('');
    try {
      const updated = await api.updateAccountOpeningBalanceDate(selectedOpeningBalance.id, {
        adjustmentDate: obEditDate,
      });
      setObEditMessage(`Updated opening balance date for ${updated.accountName}.`);
      if (updated.warning) setObEditWarning(updated.warning);
      setSelectedOpeningBalance({
        ...selectedOpeningBalance,
        openingDate: updated.openingDate,
      });
      void runObSearch();
    } catch (err) {
      setObEditMessage(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setObEditSaving(false);
    }
  }

  async function runOsSearch(e?: FormEvent) {
    e?.preventDefault();
    setOsSearchError('');
    setOsSearchLoading(true);
    setSelectedOpeningStock(null);
    setOsEditWarning('');
    try {
      const { items } = await api.searchProductOpeningStock(osSearchQuery.trim());
      setOsSearchResults(items);
      if (items.length === 0) setOsSearchError('No matching opening stock entries found.');
    } catch (err) {
      setOsSearchError(err instanceof Error ? err.message : 'Search failed');
      setOsSearchResults([]);
    } finally {
      setOsSearchLoading(false);
    }
  }

  function selectOpeningStock(row: ProductOpeningStockSearchRow) {
    setSelectedOpeningStock(row);
    setOsEditDate(dateToInputValue(row.openingDate));
    setOsEditMessage('');
    setOsEditWarning('');
  }

  async function saveOpeningStockEdit(e: FormEvent) {
    e.preventDefault();
    if (!selectedOpeningStock) return;
    setOsEditSaving(true);
    setOsEditMessage('');
    setOsEditWarning('');
    try {
      const updated = await api.updateProductOpeningStockDate(selectedOpeningStock.id, {
        adjustmentDate: osEditDate,
      });
      setOsEditMessage(`Updated opening stock date for ${updated.productName}.`);
      if (updated.warning) setOsEditWarning(updated.warning);
      setSelectedOpeningStock({
        ...selectedOpeningStock,
        openingDate: updated.openingDate,
      });
      void runOsSearch();
    } catch (err) {
      setOsEditMessage(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setOsEditSaving(false);
    }
  }

  const unitHint = selectedProduct?.unit?.trim() || 'unit';

  return (
      <PageShell
      title={
        isEditingPending
          ? tab === 'account'
            ? 'Edit Pending Account Adjustment'
            : 'Edit Pending Stock Adjustment'
          : 'Stock Adjustment'
      }
      subtitle={
        isEditingPending
          ? 'Update this pending adjustment. It stays awaiting Admin approval after save.'
          : 'Post stock or account adjustments against Opening Balance Equity'
      }
    >
      <p className="mb-4 max-w-2xl rounded border border-amber-600/40 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        Stock adjustments require Admin approval. Until approved in Pending Approvals, they do not
        change store stock or the product&apos;s average cost — so sales of adjustment-only products
        stay blocked until approval (or use a provisional pending rate).
      </p>
      <div className="mb-4 max-w-lg print:hidden">
        <SegmentedControl
          ariaLabel="Adjustment type"
          value={tab}
          onChange={(next) => {
            if (isEditingPending) return;
            setTab(next);
          }}
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
                    disabled={isEditingPending}
                  />
                  Other
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="productKind"
                    checked={productKind === 'KACHI'}
                    onChange={() => onProductKindChange('KACHI')}
                    disabled={isEditingPending}
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

            <div>
              <FieldLabel>Description (optional)</FieldLabel>
              <TextInput
                value={stockDescription}
                onChange={(e) => setStockDescription(e.target.value)}
                placeholder="Defaults to Stock Adjustment — product name"
              />
            </div>

            {stockError ? <p className="text-sm text-danger">{stockError}</p> : null}
            {stockMessage ? <p className="text-sm text-accent">{stockMessage}</p> : null}

            <div className="flex flex-wrap gap-2">
              <PrimaryButton type="submit" disabled={stockSaving}>
                {stockSaving
                  ? isEditingPending
                    ? 'Updating…'
                    : 'Posting…'
                  : isEditingPending
                    ? 'Update pending'
                    : 'Post Stock Adjustment'}
              </PrimaryButton>
              {isEditingPending ? (
                <SecondaryButton type="button" onClick={() => navigate('/system/approvals')}>
                  Back to approvals
                </SecondaryButton>
              ) : null}
            </div>
          </form>

          {!isEditingPending ? (
          <>
          <div className="mt-8 border-t border-border pt-6">
            <h3 className="text-sm font-semibold text-textPrimary">Find previous stock adjustment</h3>
            <p className="mt-1 text-xs text-textMuted">
              Search by product name, description text, or date (YYYY-MM-DD).
            </p>
            <form className="mt-3 flex flex-wrap gap-2" onSubmit={runStockSearch}>
              <TextInput
                value={stockSearchQuery}
                onChange={(e) => setStockSearchQuery(e.target.value)}
                placeholder="Product name, description, or date…"
                className="min-w-[220px] flex-1"
              />
              <SecondaryButton type="submit" disabled={stockSearchLoading || !stockSearchQuery.trim()}>
                {stockSearchLoading ? 'Searching…' : 'Search'}
              </SecondaryButton>
            </form>
            {stockSearchError ? <p className="mt-2 text-sm text-danger">{stockSearchError}</p> : null}
            {stockSearchResults.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {stockSearchResults.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className={`w-full rounded-sm border px-3 py-2 text-left text-sm ${
                        selectedStockAdjustment?.id === row.id
                          ? 'border-accent bg-bgAccent'
                          : 'border-border bg-surface1 hover:bg-surface2'
                      }`}
                      onClick={() => selectStockAdjustment(row)}
                    >
                      <span className="font-medium">{row.productName}</span>
                      <span className="text-textMuted"> · {formatDate(row.adjustmentDate)}</span>
                      <span className="block text-xs text-textSecondary">{row.description}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {selectedStockAdjustment ? (
              <form className="mt-4 space-y-3 rounded-sm border border-border bg-surface2 p-3" onSubmit={saveStockAdjustmentEdit}>
                <p className="text-sm font-medium text-textPrimary">
                  Update: {selectedStockAdjustment.productName}
                </p>
                <div>
                  <FieldLabel>Date</FieldLabel>
                  <TextInput type="date" value={stockEditDate} onChange={(e) => setStockEditDate(e.target.value)} required />
                </div>
                <div>
                  <FieldLabel>Description</FieldLabel>
                  <TextInput value={stockEditDescription} onChange={(e) => setStockEditDescription(e.target.value)} />
                </div>
                {stockEditMessage ? (
                  <p className={`text-sm ${stockEditMessage.startsWith('Updated') ? 'text-accent' : 'text-danger'}`}>
                    {stockEditMessage}
                  </p>
                ) : null}
                <PrimaryButton type="submit" disabled={stockEditSaving}>
                  {stockEditSaving ? 'Saving…' : 'Save changes'}
                </PrimaryButton>
              </form>
            ) : null}
          </div>

          <div className="mt-8 border-t border-border pt-6">
            <h3 className="text-sm font-semibold text-textPrimary">Correct opening stock date</h3>
            <p className="mt-1 text-xs text-textMuted">
              Search by product name or date (YYYY-MM-DD), then set the date recorded for original opening stock.
            </p>
            <form className="mt-3 flex flex-wrap gap-2" onSubmit={runOsSearch}>
              <TextInput
                value={osSearchQuery}
                onChange={(e) => setOsSearchQuery(e.target.value)}
                placeholder="Product name or date…"
                className="min-w-[220px] flex-1"
              />
              <SecondaryButton type="submit" disabled={osSearchLoading || !osSearchQuery.trim()}>
                {osSearchLoading ? 'Searching…' : 'Search'}
              </SecondaryButton>
            </form>
            {osSearchError ? <p className="mt-2 text-sm text-danger">{osSearchError}</p> : null}
            {osSearchResults.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {osSearchResults.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className={`w-full rounded-sm border px-3 py-2 text-left text-sm ${
                        selectedOpeningStock?.id === row.id
                          ? 'border-accent bg-bgAccent'
                          : 'border-border bg-surface1 hover:bg-surface2'
                      }`}
                      onClick={() => selectOpeningStock(row)}
                    >
                      <span className="font-medium">{row.productName}</span>
                      {row.storeName ? <span className="text-textMuted"> · {row.storeName}</span> : null}
                      <span className="text-textMuted"> · {formatDate(row.openingDate)}</span>
                      <span className="text-textMuted"> · qty {row.quantity}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {selectedOpeningStock ? (
              <form className="mt-4 space-y-3 rounded-sm border border-border bg-surface2 p-3" onSubmit={saveOpeningStockEdit}>
                <p className="text-sm font-medium text-textPrimary">
                  Opening stock: {selectedOpeningStock.productName}
                </p>
                <div>
                  <FieldLabel>Date</FieldLabel>
                  <TextInput type="date" value={osEditDate} onChange={(e) => setOsEditDate(e.target.value)} required />
                </div>
                {osEditWarning ? <p className="text-sm text-amber-700">{osEditWarning}</p> : null}
                {osEditMessage ? (
                  <p className={`text-sm ${osEditMessage.startsWith('Updated') ? 'text-accent' : 'text-danger'}`}>
                    {osEditMessage}
                  </p>
                ) : null}
                <PrimaryButton type="submit" disabled={osEditSaving}>
                  {osEditSaving ? 'Saving…' : 'Save date'}
                </PrimaryButton>
              </form>
            ) : null}
          </div>
          </>
          ) : null}
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

            <div>
              <FieldLabel>Description (optional)</FieldLabel>
              <TextInput
                value={accountDescription}
                onChange={(e) => setAccountDescription(e.target.value)}
                placeholder="Defaults to Account Adjustment"
              />
            </div>

            {accountError ? <p className="text-sm text-danger">{accountError}</p> : null}
            {accountMessage ? <p className="text-sm text-accent">{accountMessage}</p> : null}

            <div className="flex flex-wrap gap-2">
              <PrimaryButton type="submit" disabled={accountSaving}>
                {accountSaving
                  ? isEditingPending
                    ? 'Updating…'
                    : 'Posting…'
                  : isEditingPending
                    ? 'Update pending'
                    : 'Post Account Adjustment'}
              </PrimaryButton>
              {isEditingPending ? (
                <SecondaryButton type="button" onClick={() => navigate('/system/approvals')}>
                  Back to approvals
                </SecondaryButton>
              ) : null}
            </div>
          </form>

          {!isEditingPending ? (
          <>
          <div className="mt-8 border-t border-border pt-6">
            <h3 className="text-sm font-semibold text-textPrimary">Find previous account adjustment</h3>
            <p className="mt-1 text-xs text-textMuted">
              Search by account name, description text, or date (YYYY-MM-DD).
            </p>
            <form className="mt-3 flex flex-wrap gap-2" onSubmit={runAccountSearch}>
              <TextInput
                value={accountSearchQuery}
                onChange={(e) => setAccountSearchQuery(e.target.value)}
                placeholder="Account name, description, or date…"
                className="min-w-[220px] flex-1"
              />
              <SecondaryButton type="submit" disabled={accountSearchLoading || !accountSearchQuery.trim()}>
                {accountSearchLoading ? 'Searching…' : 'Search'}
              </SecondaryButton>
            </form>
            {accountSearchError ? <p className="mt-2 text-sm text-danger">{accountSearchError}</p> : null}
            {accountSearchResults.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {accountSearchResults.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className={`w-full rounded-sm border px-3 py-2 text-left text-sm ${
                        selectedAccountAdjustment?.id === row.id
                          ? 'border-accent bg-bgAccent'
                          : 'border-border bg-surface1 hover:bg-surface2'
                      }`}
                      onClick={() => selectAccountAdjustment(row)}
                    >
                      <span className="font-medium">{row.accountName}</span>
                      <span className="text-textMuted"> · {formatDate(row.adjustmentDate)}</span>
                      <span className="text-textMuted"> · {row.side} {formatLedgerAmount(row.amount)}</span>
                      <span className="block text-xs text-textSecondary">{row.description}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {selectedAccountAdjustment ? (
              <form className="mt-4 space-y-3 rounded-sm border border-border bg-surface2 p-3" onSubmit={saveAccountAdjustmentEdit}>
                <p className="text-sm font-medium text-textPrimary">
                  Update: {selectedAccountAdjustment.accountName}
                </p>
                <div>
                  <FieldLabel>Date</FieldLabel>
                  <TextInput type="date" value={accountEditDate} onChange={(e) => setAccountEditDate(e.target.value)} required />
                </div>
                <div>
                  <FieldLabel>Description</FieldLabel>
                  <TextInput value={accountEditDescription} onChange={(e) => setAccountEditDescription(e.target.value)} />
                </div>
                {accountEditMessage ? (
                  <p className={`text-sm ${accountEditMessage.startsWith('Updated') ? 'text-accent' : 'text-danger'}`}>
                    {accountEditMessage}
                  </p>
                ) : null}
                <PrimaryButton type="submit" disabled={accountEditSaving}>
                  {accountEditSaving ? 'Saving…' : 'Save changes'}
                </PrimaryButton>
              </form>
            ) : null}
          </div>

          <div className="mt-8 border-t border-border pt-6">
            <h3 className="text-sm font-semibold text-textPrimary">Correct opening balance date</h3>
            <p className="mt-1 text-xs text-textMuted">
              Search by account name or date (YYYY-MM-DD), then set the date recorded for the original opening balance.
            </p>
            <form className="mt-3 flex flex-wrap gap-2" onSubmit={runObSearch}>
              <TextInput
                value={obSearchQuery}
                onChange={(e) => setObSearchQuery(e.target.value)}
                placeholder="Account name or date…"
                className="min-w-[220px] flex-1"
              />
              <SecondaryButton type="submit" disabled={obSearchLoading || !obSearchQuery.trim()}>
                {obSearchLoading ? 'Searching…' : 'Search'}
              </SecondaryButton>
            </form>
            {obSearchError ? <p className="mt-2 text-sm text-danger">{obSearchError}</p> : null}
            {obSearchResults.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {obSearchResults.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className={`w-full rounded-sm border px-3 py-2 text-left text-sm ${
                        selectedOpeningBalance?.id === row.id
                          ? 'border-accent bg-bgAccent'
                          : 'border-border bg-surface1 hover:bg-surface2'
                      }`}
                      onClick={() => selectOpeningBalance(row)}
                    >
                      <span className="font-medium">{row.accountName}</span>
                      <span className="text-textMuted"> · {formatDate(row.openingDate)}</span>
                      <span className="text-textMuted"> · {row.side} {formatLedgerAmount(row.amount)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {selectedOpeningBalance ? (
              <form className="mt-4 space-y-3 rounded-sm border border-border bg-surface2 p-3" onSubmit={saveOpeningBalanceEdit}>
                <p className="text-sm font-medium text-textPrimary">
                  Opening balance: {selectedOpeningBalance.accountName}
                </p>
                <div>
                  <FieldLabel>Date</FieldLabel>
                  <TextInput type="date" value={obEditDate} onChange={(e) => setObEditDate(e.target.value)} required />
                </div>
                {obEditWarning ? <p className="text-sm text-amber-700">{obEditWarning}</p> : null}
                {obEditMessage ? (
                  <p className={`text-sm ${obEditMessage.startsWith('Updated') ? 'text-accent' : 'text-danger'}`}>
                    {obEditMessage}
                  </p>
                ) : null}
                <PrimaryButton type="submit" disabled={obEditSaving}>
                  {obEditSaving ? 'Saving…' : 'Save date'}
                </PrimaryButton>
              </form>
            ) : null}
          </div>
          </>
          ) : null}
        </Panel>
      )}

      <PageCloseBar />
    </PageShell>
  );
}
