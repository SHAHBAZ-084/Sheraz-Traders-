export type Paginated<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

export type User = {
  id: number;
  username: string;
  displayName: string;
};

export type AccountCategory = {
  id: number;
  name: string;
  isActive: boolean;
};

export type Ledger = { id: number; accountId: number; balance: number };
export type Account = {
  id: number;
  categoryId: number;
  name: string;
  code: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  isActive: boolean;
  category?: AccountCategory | null;
  ledger?: Ledger | null;
};

export type ProductCategory = {
  id: number;
  name: string;
  isActive: boolean;
};

export type Store = {
  id: number;
  name: string;
  isActive: boolean;
  createdAt?: string;
};

export type Product = {
  id: number;
  name: string;
  code: string;
  unit: string | null;
  accountId: number;
  categoryId?: number | null;
  category?: ProductCategory | null;
  account?: { id: number; name: string; code: string; ledger?: { balance: number | string } | null };
};

export type Party = {
  id: number;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  accountId?: number | null;
  /** Signed ledger balance from linked Account → Ledger (positive = Dr, negative = Cr). */
  balance: number;
};

export type Invoice = {
  id: number;
  type: string;
  status: string;
  reference: string;
  total: number | string;
  createdAt: string;
  customer?: Party | null;
  supplier?: Party | null;
};

export type SystemPreferences = {
  daamiPercent: number;
  paleDariPercent: number;
  brokeryPercent: number;
  marketFeeRate: number;
  bardanaRate: number;
  taxPercent: number;
  kaatPercent: number;
  mazduriPercent: number;
  commissionPercent: number;
  dalaliPercent: number;
  sutliRate: number;
  markeetFeeRate: number;
  mazduriPerBagRate: number;
  kantaRate: number;
  closingDate: string | null;
  updatedAt: string;
};

export type KachiMaalInvoiceResult = Invoice & {
  vouchers?: { voucher: Voucher }[];
};

export type InvoiceItemDetail = {
  id: number;
  label: string;
  quantity: number | string;
  unitPrice: number | string;
  total: number | string;
  product?: Product | null;
};

export type MaalLineDetail = {
  id: number;
  jins?: string | null;
  qism?: string | null;
  boriOrThelaMode: 'BORI' | 'THELA';
  bagCount: number | string;
  bhartii: number | string;
  dharanCount: number | string;
  looseKg: number | string;
  totalWeightKg: number | string;
  ratePerMaund: number | string;
  amount: number | string;
  bardanaQty?: number | string | null;
  bardanaRate?: number | string | null;
  bardanaAmount?: number | string | null;
  netCreditToParty: number | string;
  partyAccount?: VoucherAccount | null;
  dammiChecked?: boolean;
  dammiAmount?: number | string | null;
};

export type KachiMaalLineDetail = MaalLineDetail;

export type PurchaseMaalLineDetail = MaalLineDetail;

export type SalePaunchLineDetail = {
  id: number;
  jins?: string | null;
  qism?: string | null;
  boriOrThelaMode: 'BORI' | 'THELA';
  bagCount: number | string;
  thelaCount?: number | string | null;
  totalWeightKg: number | string;
  kaatKg: number | string;
  netWeightKg: number | string;
  lowerKaatKg: number | string;
  lowerNetWeightKg: number | string;
  upperRatePerMaund: number | string;
  upperAmount: number | string;
  kanta: number | string;
  netUpperAmount: number | string;
  lowerRatePerMaund: number | string;
  lowerAmount: number | string;
  rowRevenue?: number | string;
  bardanaQty?: number | string | null;
  bardanaRate?: number | string | null;
  bardanaAmount?: number | string | null;
  dammiChecked?: boolean;
  dammiAmount?: number | string | null;
  maalKhataAccount?: VoucherAccount | null;
};

export type InvoiceDetail = Invoice & {
  invoiceDate?: string | null;
  billNo?: string | null;
  gariNo?: string | null;
  jins?: string | null;
  qism?: string | null;
  tafseel?: string | null;
  notes?: string | null;
  miscAmount?: number | string | null;
  munshianaAmount?: number | string | null;
  taxAmount?: number | string | null;
  biltyKirayaAmount?: number | string | null;
  lowerBardanaMode?: 'BORI' | 'THELA' | null;
  lowerBardanaQty?: number | string | null;
  lowerBardanaRate?: number | string | null;
  lowerBardanaAmount?: number | string | null;
  marketFeeEnabled?: boolean;
  mazduriEnabled?: boolean;
  debitAccount?: VoucherAccount | null;
  items?: InvoiceItemDetail[];
  kachiMaalLines?: KachiMaalLineDetail[];
  purchaseMaalLines?: PurchaseMaalLineDetail[];
  salePaunchLines?: SalePaunchLineDetail[];
  saleCommissionLines?: MaalLineDetail[];
  vouchers?: { voucher: Voucher }[];
  createdBy?: VoucherUser | null;
};

export type VoucherAccount = { id: number; name: string; code: string };
export type VoucherUser = { id: number; displayName: string; username: string };

export type VoucherLedgerEntry = {
  id: number;
  type: string;
  amount: number | string;
  notes?: string | null;
  ledger?: {
    account?: VoucherAccount | null;
  } | null;
};

export type Voucher = {
  id: number;
  type: string;
  number: number;
  date: string;
  amount: number | string;
  description?: string | null;
  reference?: string | null;
  status: string;
  createdAt: string;
  updatedAt?: string;
  deletedAt?: string | null;
  debitAccount?: VoucherAccount | null;
  creditAccount?: VoucherAccount | null;
  ledgerEntries?: VoucherLedgerEntry[];
  createdBy?: VoucherUser | null;
  modifiedBy?: VoucherUser | null;
  deletedBy?: VoucherUser | null;
};

type ApiError = { error: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    credentials: 'include',
  });
  const data = (await response.json().catch(() => ({}))) as T & ApiError;
  if (!response.ok) throw new Error(data.error ?? 'Request failed');
  return data;
}

export const api = {
  login(username: string, password: string) {
    return request<{ user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },
  logout() {
    return request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
  },
  me() {
    return request<{ user: User }>('/api/auth/me');
  },

  listCategories() {
    return request<AccountCategory[]>('/api/accounting/categories');
  },
  createCategory(name: string) {
    return request<AccountCategory>('/api/accounting/categories', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  },
  deleteCategory(id: number) {
    return request<AccountCategory>(`/api/accounting/categories/${id}`, { method: 'DELETE' });
  },

  listProducts() {
    return request<Product[]>('/api/products');
  },
  listProductCategories() {
    return request<ProductCategory[]>('/api/products/product-categories');
  },
  createProductCategory(data: { name: string }) {
    return request<ProductCategory>('/api/products/product-categories', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  createProduct(data: { name: string; unit?: string; code?: string; categoryId?: number | null }) {
    return request<Product>('/api/products', { method: 'POST', body: JSON.stringify(data) });
  },
  removeProduct(id: number) {
    return request<{ ok: boolean }>(`/api/products/${id}`, { method: 'DELETE' });
  },

  listStores() {
    return request<Store[]>('/api/stores');
  },
  listActiveStores() {
    return request<Store[]>('/api/stores/active');
  },
  createStore(data: { name: string }) {
    return request<Store>('/api/stores', { method: 'POST', body: JSON.stringify(data) });
  },
  setStoreActive(id: number, isActive: boolean) {
    return request<Store>(`/api/stores/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    });
  },
  getStockByStore(storeId: number) {
    return request<{
      store: { id: number; name: string };
      products: Array<{
        productId: number;
        name: string;
        code: string;
        bori: number;
        thela: number;
        saleInvoiceQty: number;
        purchaseInvoiceQty: number;
      }>;
    }>(`/api/stock/by-store/${storeId}`);
  },
  getProductsByStore(storeId: number) {
    return request<Array<{ id: number; name: string; code: string }>>(
      `/api/stock/products-by-store?storeId=${storeId}`,
    );
  },

  listSaleParties() {
    return request<Party[]>('/api/parties/sale-parties');
  },
  createSaleParty(data: Record<string, string | undefined>) {
    return request<Party>('/api/parties/sale-parties', { method: 'POST', body: JSON.stringify(data) });
  },
  removeSaleParty(id: number) {
    return request<Party>(`/api/parties/sale-parties/${id}`, { method: 'DELETE' });
  },

  listPurchaseParties() {
    return request<Party[]>('/api/parties/purchase-parties');
  },
  createPurchaseParty(data: Record<string, string | undefined>) {
    return request<Party>('/api/parties/purchase-parties', { method: 'POST', body: JSON.stringify(data) });
  },
  removePurchaseParty(id: number) {
    return request<Party>(`/api/parties/purchase-parties/${id}`, { method: 'DELETE' });
  },

  listInvoices(type?: string, pagination?: { limit?: number; offset?: number }) {
    const query = new URLSearchParams();
    if (type) query.set('type', type);
    if (pagination?.limit != null) query.set('limit', String(pagination.limit));
    if (pagination?.offset != null) query.set('offset', String(pagination.offset));
    const suffix = query.toString() ? `?${query}` : '';
    return request<Paginated<Invoice>>(`/api/invoices${suffix}`);
  },

  getInvoiceByReference(reference: string) {
    const query = new URLSearchParams({ reference });
    return request<InvoiceDetail>(`/api/invoices/by-reference?${query.toString()}`);
  },

  getNextKachiMaalReference() {
    return request<{ reference: string }>('/api/invoices/kachi-maal/next-reference');
  },

  createKachiMaalInvoice(data: {
    invoiceDate: string;
    billNo?: string;
    gariNo?: string;
    jins?: string;
    qism?: string;
    tafseel?: string;
    debitAccountId: number;
    miscAmount?: number;
    lowerBardanaMode?: 'BORI' | 'THELA' | null;
    lowerBardanaQty?: number | null;
    lowerBardanaRate?: number | null;
    lines: {
      partyAccountId: number;
      jins?: string;
      qism?: string;
      boriOrThelaMode: 'BORI' | 'THELA';
      bagCount: number;
      bhartii: number;
      dharanCount: number;
      looseKg: number;
      ratePerMaund: number;
      bardanaQty?: number | null;
      bardanaRate?: number | null;
    }[];
  }) {
    return request<KachiMaalInvoiceResult>('/api/invoices/kachi-maal', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  getNextPurchaseMaalReference() {
    return request<{ reference: string }>('/api/invoices/purchase-maal/next-reference');
  },

  createPurchaseMaalInvoice(data: {
    invoiceDate: string;
    productId: number;
    billNo?: string;
    gariNo?: string;
    jins?: string;
    qism?: string;
    tafseel?: string;
    marketFeeEnabled?: boolean;
    mazduriEnabled?: boolean;
    lowerBardanaMode?: 'BORI' | 'THELA' | null;
    lowerBardanaQty?: number | null;
    lowerBardanaRate?: number | null;
    lines: {
      partyAccountId: number;
      jins?: string;
      qism?: string;
      boriOrThelaMode: 'BORI' | 'THELA';
      bagCount: number;
      bhartii: number;
      dharanCount: number;
      looseKg: number;
      ratePerMaund: number;
      bardanaQty?: number | null;
      bardanaRate?: number | null;
      dammiChecked?: boolean;
    }[];
  }) {
    return request<KachiMaalInvoiceResult>('/api/invoices/purchase-maal', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  getNextSalePaunchReference() {
    return request<{ reference: string }>('/api/invoices/sale-paunch/next-reference');
  },

  getNextSaleInvoiceReference() {
    return request<{ reference: string }>('/api/invoices/sale-invoice/next-reference');
  },

  createSaleInvoice(data: {
    invoiceDate: string;
    storeId: number;
    customerAccountId: number;
    billNo?: string;
    notes?: string;
    lines: Array<{ productId: number; quantity: number; rate: number }>;
  }) {
    return request('/api/invoices/sale-invoice', { method: 'POST', body: JSON.stringify(data) });
  },

  getNextPurchaseInvoiceReference() {
    return request<{ reference: string }>('/api/invoices/purchase-invoice/next-reference');
  },

  createPurchaseInvoice(data: {
    invoiceDate: string;
    storeId: number;
    supplierAccountId: number;
    billNo?: string;
    notes?: string;
    lines: Array<{ productId: number; quantity: number; rate: number }>;
  }) {
    return request('/api/invoices/purchase-invoice', { method: 'POST', body: JSON.stringify(data) });
  },

  createSalePaunchInvoice(data: {
    invoiceDate: string;
    salePartyAccountId: number;
    billNo?: string;
    gariNo?: string;
    jins?: string;
    qism?: string;
    tafseel?: string;
    taxAmount?: number;
    biltyKirayaAmount?: number;
    miscAmount?: number;
    lowerBardanaMode?: 'BORI' | 'THELA' | null;
    lowerBardanaQty?: number | null;
    lowerBardanaRate?: number | null;
    lines: {
      maalKhataAccountId: number;
      jins?: string;
      qism?: string;
      boriOrThelaMode: 'BORI' | 'THELA';
      bagCount: number;
      thelaCount?: number;
      compWeightKg: number;
      kaatKg?: number;
      lowerKaatKg?: number;
      upperRatePerMaund: number;
      lowerRatePerMaund: number;
      kanta?: number;
      bardanaQty?: number | null;
      bardanaRate?: number | null;
      dammiChecked?: boolean;
    }[];
  }) {
    return request<KachiMaalInvoiceResult>('/api/invoices/sale-paunch', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  getNextSaleCommissionReference() {
    return request<{ reference: string }>('/api/invoices/sale-commission/next-reference');
  },

  createSaleCommissionInvoice(data: {
    invoiceDate: string;
    salePartyAccountId: number;
    billNo?: string;
    gariNo?: string;
    jins?: string;
    qism?: string;
    tafseel?: string;
    munshianaAmount?: number;
    miscAmount?: number;
    lowerBardanaMode?: 'BORI' | 'THELA' | null;
    lowerBardanaQty?: number | null;
    lowerBardanaRate?: number | null;
    lines: {
      partyAccountId: number;
      jins?: string;
      qism?: string;
      boriOrThelaMode: 'BORI' | 'THELA';
      bagCount: number;
      bhartii: number;
      dharanCount: number;
      looseKg: number;
      ratePerMaund: number;
      bardanaQty?: number | null;
      bardanaRate?: number | null;
      dammiChecked?: boolean;
    }[];
  }) {
    return request<KachiMaalInvoiceResult>('/api/invoices/sale-commission', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  getSystemPreferences() {
    return request<SystemPreferences>('/api/preferences');
  },

  updateSystemPreferences(data: Partial<Omit<SystemPreferences, 'updatedAt'>>) {
    return request<SystemPreferences>('/api/preferences', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  listVouchers(params?: {
    fromDate?: string;
    toDate?: string;
    type?: string;
    limit?: number;
    offset?: number;
  }) {
    const query = new URLSearchParams();
    if (params?.fromDate) query.set('fromDate', params.fromDate);
    if (params?.toDate) query.set('toDate', params.toDate);
    if (params?.type) query.set('type', params.type);
    if (params?.limit != null) query.set('limit', String(params.limit));
    if (params?.offset != null) query.set('offset', String(params.offset));
    const suffix = query.toString() ? `?${query}` : '';
    return request<Paginated<Voucher>>(`/api/accounting/vouchers${suffix}`);
  },

  verifyDatabaseIntegrity() {
    return request<{ ok: boolean; results: string[] }>('/api/system/verify-database', {
      method: 'POST',
    });
  },

  backupDatabase() {
    return request<{ ok: boolean; path: string | null }>('/api/system/backup-database', {
      method: 'POST',
    });
  },

  getDashboardSummary() {
    return request<{
      cashBalance: number;
      productStock: Array<{
        productId: number;
        name: string;
        code: string;
        bori: number;
        thela: number;
        saleInvoiceQty: number;
        purchaseInvoiceQty: number;
      }>;
      vouchersToday: number;
      recentVouchers: {
        id: number;
        number: number;
        type: string;
        amount: number;
        date: string;
        status: string;
        accountLabel: string;
      }[];
    }>('/api/accounting/dashboard-summary');
  },
  getNextVoucherNumber(type: 'PAYMENT' | 'RECEIPT' | 'JOURNAL') {
    const query = new URLSearchParams({ type });
    return request<{ number: number; financialYearId: number; type: string }>(
      `/api/accounting/vouchers/next-number?${query.toString()}`,
    );
  },
  createVoucher(data: {
    type: string;
    debitAccountId: number;
    creditAccountId: number;
    amount: number;
    date: string;
    description?: string;
    reference: string;
  }) {
    return request<Voucher>('/api/accounting/vouchers', { method: 'POST', body: JSON.stringify(data) });
  },
  updateVoucherAmount(voucherId: number, amount: number) {
    return request<Voucher>(`/api/accounting/vouchers/${voucherId}`, {
      method: 'PATCH',
      body: JSON.stringify({ amount }),
    });
  },
  cancelVoucher(voucherId: number) {
    return request<Voucher>(`/api/accounting/vouchers/${voucherId}`, { method: 'DELETE' });
  },

  listAccounts() {
    return request<Account[]>('/api/accounting/accounts');
  },
  createAccount(data: {
    categoryId: number;
    name: string;
    code?: string;
    type?: Account['type'];
    openingBalance?: number;
    openingBalanceSide?: 'DR' | 'CR';
  }) {
    return request<Account>('/api/accounting/accounts', { method: 'POST', body: JSON.stringify(data) });
  },
  updateAccount(id: number, data: { name?: string; code?: string; isActive?: boolean }) {
    return request<Account>(`/api/accounting/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },
  removeAccount(id: number) {
    return request<Account>(`/api/accounting/accounts/${id}`, { method: 'DELETE' });
  },

  getLedger(accountId: number, params?: { fromDate?: string; toDate?: string }) {
    const query = params?.fromDate || params?.toDate
      ? `?${new URLSearchParams({ ...(params.fromDate ? { fromDate: params.fromDate } : {}), ...(params.toDate ? { toDate: params.toDate } : {}) })}`
      : '';
    return request<{
      account: { id: number; name: string; code: string; type: string };
      balance: number;
      rows: {
        date: string;
        voucherNo: string;
        ref: string | null;
        type: string;
        description: string;
        debit: number;
        credit: number;
        balance: number;
        isOpeningRow?: boolean;
      }[];
      summary: { periodOpening: number; totalDebit: number; totalCredit: number; closingBalance: number };
    }>(`/api/accounting/ledger/${accountId}${query}`);
  },

  getTrialBalance() {
    return request<{
      accounts: { accountName: string; debit: number; credit: number }[];
      totalDebit: number;
      totalCredit: number;
      isBalanced: boolean;
    }>('/api/accounting/trial-balance');
  },

  getAccountBalanceReport(params: { date: string; categoryId?: number; side?: 'debit' | 'credit' | 'both' }) {
    const query = new URLSearchParams({ date: params.date, side: params.side ?? 'both' });
    if (params.categoryId != null) query.set('categoryId', String(params.categoryId));
    return request<{
      date: string;
      side: 'debit' | 'credit' | 'both';
      categoryId: number | null;
      accounts: {
        accountId: number;
        accountCode: string;
        accountName: string;
        categoryId: number;
        categoryName: string;
        balance: number;
        debit: number;
        credit: number;
      }[];
      groups: {
        categoryId: number;
        categoryName: string;
        accounts: {
          accountId: number;
          accountCode: string;
          accountName: string;
          categoryId: number;
          categoryName: string;
          balance: number;
          debit: number;
          credit: number;
        }[];
      }[];
      totalDebit: number;
      totalCredit: number;
    }>(`/api/accounting/reports/account-balance?${query.toString()}`);
  },

  getEmptyBardana() {
    return request<{
      balances: Array<{ bagType: 'BORI' | 'THELA'; balance: number }>;
      movements: Array<{
        id: number;
        date: string;
        bagType: 'BORI' | 'THELA';
        direction: 'IN' | 'OUT';
        qty: number;
        source: string;
        description: string | null;
        invoiceId: number | null;
      }>;
    }>('/api/inventory/bardana');
  },
  addEmptyBardana(data: { bagType: 'BORI' | 'THELA'; quantity: number }) {
    return request<{
      balances: Array<{ bagType: 'BORI' | 'THELA'; balance: number }>;
      movements: Array<{
        id: number;
        date: string;
        bagType: 'BORI' | 'THELA';
        direction: 'IN' | 'OUT';
        qty: number;
        source: string;
        description: string | null;
        invoiceId: number | null;
      }>;
    }>('/api/inventory/bardana/add', { method: 'POST', body: JSON.stringify(data) });
  },

  getStockReport(params: { productId: number; bagType: 'BORI' | 'THELA'; storeId?: number | null }) {
    const query = new URLSearchParams({
      productId: String(params.productId),
      bagType: params.bagType,
    });
    if (params.storeId != null && params.storeId > 0) {
      query.set('storeId', String(params.storeId));
    }
    return request<{
      product: { id: number; name: string; code: string };
      bagType: 'BORI' | 'THELA';
      storeId: number | null;
      trackingStartedAt: string;
      historicalBackfill: false;
      carriedRemainderKg: number;
      rows: Array<{
        id: number;
        date: string;
        description: string;
        invoiceReference: string;
        invoiceType: string;
        status: 'IN' | 'OUT';
        bags: number;
        runningBalance: number;
      }>;
      totals: {
        totalIn: number;
        totalOut: number;
        netBalance: number;
        saleInvoiceQty: number;
        purchaseInvoiceQty: number;
      };
    }>(`/api/stock/report?${query.toString()}`);
  },

  getSalePurchaseReport(params: {
    mode: 'SALE' | 'PURCHASE';
    typeFilter: 'ALL' | 'COMMISSION' | 'PAUNCH' | 'MAAL';
    fromDate: string;
    toDate: string;
    partyAccountId?: number | null;
    productId?: number | null;
  }) {
    const query = new URLSearchParams({
      mode: params.mode,
      typeFilter: params.typeFilter,
      fromDate: params.fromDate,
      toDate: params.toDate,
    });
    if (params.partyAccountId) query.set('partyAccountId', String(params.partyAccountId));
    if (params.productId) query.set('productId', String(params.productId));
    return request<{
      mode: 'SALE' | 'PURCHASE';
      typeFilter: 'ALL' | 'COMMISSION' | 'PAUNCH' | 'MAAL';
      fromDate: string;
      toDate: string;
      title: string;
      rowCount: number;
      categories: Array<{
        category: 'COMMISSION' | 'PAUNCH' | 'MAAL';
        label: string;
        parties: Array<{
          partyAccountId: number;
          partyName: string;
          rows: Array<{
            invoiceId: number;
            invoiceReference: string;
            invoiceNumber: string;
            date: string;
            category: 'COMMISSION' | 'PAUNCH' | 'MAAL';
            partyAccountId: number;
            partyName: string;
            product: string;
            thela: number;
            bori: number;
            weight: number;
            totalPrice: number;
            netBill: number;
          }>;
          subtotal: {
            thela: number;
            bori: number;
            weight: number;
            totalPrice: number;
            netBill: number;
          };
        }>;
        subtotal: {
          thela: number;
          bori: number;
          weight: number;
          totalPrice: number;
          netBill: number;
        };
      }>;
      grandTotal: {
        thela: number;
        bori: number;
        weight: number;
        totalPrice: number;
        netBill: number;
      };
    }>(`/api/reports/sale-purchase?${query.toString()}`);
  },
};
