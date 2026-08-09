export type Paginated<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

const SELECTOR_LIST_QUERY = 'limit=2000';

async function fetchListItems<T>(path: string): Promise<T[]> {
  const page = await request<Paginated<T>>(path);
  return page.items;
}

export type BackupStatus = {
  connected: boolean;
  needsReconnect: boolean;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  overdue: boolean;
};

export type User = {
  id: number;
  username: string;
  displayName: string;
  role: 'ADMIN' | 'USER';
};

export type FinancialYear = {
  id: number;
  label: string;
  startDate: string;
  endDate: string | null;
  status: 'ACTIVE' | 'CLOSED';
  isActive: boolean;
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
  marketFeeEnabled?: boolean;
  taxPercent: number;
  markeetFeeRate: number;
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
  bagCount: number | string;
  bhartii: number | string;
  dharanCount: number | string;
  looseKg: number | string;
  totalWeightKg: number | string;
  ratePerMaund: number | string;
  amount: number | string;
  netCreditToParty: number | string;
  partyAccount?: VoucherAccount | null;
  dammiChecked?: boolean;
  dammiAmount?: number | string | null;
};

export type KachiMaalLineDetail = MaalLineDetail;

export type InvoiceDetail = Invoice & {
  invoiceDate?: string | null;
  billNo?: string | null;
  gariNo?: string | null;
  jins?: string | null;
  qism?: string | null;
  tafseel?: string | null;
  notes?: string | null;
  miscAmount?: number | string | null;
  debitAccount?: VoucherAccount | null;
  items?: InvoiceItemDetail[];
  kachiMaalLines?: KachiMaalLineDetail[];
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

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status} ${response.statusText}`.trim();
    try {
      const data = (await response.json()) as ApiError;
      if (data && typeof data.error === 'string' && data.error.trim()) {
        errorMessage = data.error;
      }
    } catch {
      // Non-JSON error payload
    }
    throw new Error(errorMessage);
  }

  return response.json();
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
  listUsers() {
    return request<User[]>('/api/auth/users');
  },
  createUser(data: { username: string; password: string; displayName?: string }) {
    return request<{ user: User }>('/api/auth/users', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  deleteUser(id: number) {
    return request<{ id: number }>(`/api/auth/users/${id}`, {
      method: 'DELETE',
    });
  },

  listPendingApprovals() {
    return request<
      Array<{
        kind: 'voucher' | 'invoice';
        id: number;
        type: string;
        reference: string | null;
        date: string | null;
        debitAccountName?: string | null;
        creditAccountName?: string | null;
        amount: number;
        description: string | null;
        createdBy: { id: number; displayName: string; username: string } | null;
      }>
    >('/api/approvals/pending');
  },
  approvePendingVoucher(id: number) {
    return request(`/api/approvals/vouchers/${id}/approve`, { method: 'POST', body: '{}' });
  },
  rejectPendingVoucher(id: number) {
    return request(`/api/approvals/vouchers/${id}/reject`, { method: 'POST', body: '{}' });
  },
  approvePendingInvoice(id: number) {
    return request(`/api/approvals/invoices/${id}/approve`, { method: 'POST', body: '{}' });
  },
  rejectPendingInvoice(id: number) {
    return request(`/api/approvals/invoices/${id}/reject`, { method: 'POST', body: '{}' });
  },

  listCategories() {
    return fetchListItems<AccountCategory>(`/api/accounting/categories?${SELECTOR_LIST_QUERY}`);
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

  listProducts(options?: { lite?: boolean }) {
    const query = new URLSearchParams({ limit: '2000' });
    if (options?.lite) query.set('lite', '1');
    return fetchListItems<Product>(`/api/products?${query.toString()}`);
  },
  listProductCategories() {
    return fetchListItems<ProductCategory>(`/api/products/product-categories?${SELECTOR_LIST_QUERY}`);
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
  getProductInsight(productId: number, storeId: number) {
    return request<{ averageRate: number | null; storeStock: number; storeName: string }>(
      `/api/products/${productId}/insight?storeId=${storeId}`,
    );
  },

  listStores() {
    return fetchListItems<Store>(`/api/stores?${SELECTOR_LIST_QUERY}`);
  },
  listActiveStores() {
    return fetchListItems<Store>(`/api/stores/active?${SELECTOR_LIST_QUERY}`);
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
  getStoreDeletionSummary(id: number) {
    return request<{
      store: Store;
      saleInvoicesCount: number;
      purchaseInvoicesCount: number;
      stockMovementsCount: number;
      stockRemaindersCount: number;
      totalLinkedRecords: number;
    }>(`/api/stores/${id}/deletion-summary`);
  },
  deleteStore(id: number, confirmPassword: string) {
    return request<Store>(`/api/stores/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ confirmPassword }),
    });
  },
  getStockByStore(storeId: number) {
    return request<{
      store: { id: number; name: string };
      products: Array<{
        productId: number;
        name: string;
        code: string;
        totalQty: number;
        saleInvoiceQty: number;
        purchaseInvoiceQty: number;
      }>;
    }>(`/api/stock/by-store/${storeId}`);
  },
  getStockBalance(params: { productId: number; storeId: number }) {
    const query = new URLSearchParams({
      productId: String(params.productId),
      storeId: String(params.storeId),
    });
    return request<{ productId: number; storeId: number | null; balance: number }>(
      `/api/stock/balance?${query.toString()}`,
    );
  },
  createStockTransfer(data: {
    transferDate: string;
    fromStoreId: number;
    toStoreId: number;
    productId: number;
    quantity: number;
  }) {
    return request<{ id: number; reference: string; type: string }>('/api/stock/transfer', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  getProductsByStore(storeId: number) {
    return request<Array<{ id: number; name: string; code: string }>>(
      `/api/stock/products-by-store?storeId=${storeId}`,
    );
  },

  listSaleParties() {
    return fetchListItems<Party>(`/api/parties/sale-parties?${SELECTOR_LIST_QUERY}`);
  },
  createSaleParty(data: Record<string, string | undefined>) {
    return request<Party>('/api/parties/sale-parties', { method: 'POST', body: JSON.stringify(data) });
  },
  removeSaleParty(id: number) {
    return request<Party>(`/api/parties/sale-parties/${id}`, { method: 'DELETE' });
  },

  listPurchaseParties() {
    return fetchListItems<Party>(`/api/parties/purchase-parties?${SELECTOR_LIST_QUERY}`);
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
    lines: {
      partyAccountId: number;
      jins?: string;
      qism?: string;
      bagCount: number;
      bhartii: number;
      dharanCount: number;
      looseKg: number;
      ratePerMaund: number;
    }[];
  }) {
    return request<KachiMaalInvoiceResult>('/api/invoices/kachi-maal', {
      method: 'POST',
      body: JSON.stringify(data),
    });
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
    financialYearId?: number;
    limit?: number;
    offset?: number;
  }) {
    const query = new URLSearchParams();
    if (params?.fromDate) query.set('fromDate', params.fromDate);
    if (params?.toDate) query.set('toDate', params.toDate);
    if (params?.type) query.set('type', params.type);
    if (params?.financialYearId != null) query.set('financialYearId', String(params.financialYearId));
    if (params?.limit != null) query.set('limit', String(params.limit));
    if (params?.offset != null) query.set('offset', String(params.offset));
    const suffix = query.toString() ? `?${query}` : '';
    return request<Paginated<Voucher>>(`/api/accounting/vouchers${suffix}`);
  },

  listFinancialYears() {
    return request<FinancialYear[]>('/api/accounting/financial-years');
  },

  changeFinancialYear(password: string) {
    return request<
      | { ok: false }
      | { ok: true; closedYear: FinancialYear; newYear: FinancialYear }
    >('/api/accounting/financial-year/change', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
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
        totalQty?: number;
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
  createVouchersBatch(vouchers: Array<{
    type: string;
    debitAccountId: number;
    creditAccountId: number;
    amount: number;
    date: string;
    description?: string;
    reference: string;
  }>) {
    return request<Voucher[]>('/api/accounting/vouchers/batch', {
      method: 'POST',
      body: JSON.stringify({ vouchers }),
    });
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
  cancelInvoice(invoiceId: number) {
    return request<InvoiceDetail>(`/api/invoices/${invoiceId}`, { method: 'DELETE' });
  },

  listAccounts(options?: { lite?: boolean }) {
    const query = new URLSearchParams({ limit: '2000' });
    if (options?.lite) query.set('lite', '1');
    return fetchListItems<Account>(`/api/accounting/accounts?${query.toString()}`);
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

  getLedger(
    accountId: number,
    params?: { fromDate?: string; toDate?: string; limit?: number; cursor?: string; financialYearId?: number },
  ) {
    const query = new URLSearchParams({ limit: String(params?.limit ?? 2000) });
    if (params?.fromDate) query.set('fromDate', params.fromDate);
    if (params?.toDate) query.set('toDate', params.toDate);
    if (params?.cursor) query.set('cursor', params.cursor);
    if (params?.financialYearId != null) query.set('financialYearId', String(params.financialYearId));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request<{
      account: { id: number; name: string; code: string; type: string };
      balance: number;
      totalCount: number;
      nextCursor: string | null;
      hasMore: boolean;
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
        isClosingRow?: boolean;
      }[];
      summary: { periodOpening: number; totalDebit: number; totalCredit: number; closingBalance: number };
      pagination?: {
        total: number;
        limit: number;
        offset?: number;
        nextCursor?: string | null;
        hasMore?: boolean;
      };
    }>(`/api/accounting/ledger/${accountId}${suffix}`);
  },

  getTrialBalance(params?: { financialYearId?: number }) {
    const query =
      params?.financialYearId != null ? `?financialYearId=${params.financialYearId}` : '';
    return request<{
      accounts: { accountName: string; debit: number; credit: number }[];
      totalDebit: number;
      totalCredit: number;
      isBalanced: boolean;
      scope?: 'live' | 'closing_snapshot';
      financialYearId?: number | null;
      financialYearLabel?: string | null;
    }>(`/api/accounting/trial-balance${query}`);
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


  getStockReport(params: { productId: number; storeId?: number | null }) {
    const query = new URLSearchParams({
      productId: String(params.productId),
    });
    if (params.storeId != null && params.storeId > 0) {
      query.set('storeId', String(params.storeId));
    }
    return request<{
      product: { id: number; name: string; code: string };
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

  getBackupStatus() {
    return request<BackupStatus>('/api/system/backup-status');
  },

  connectGoogleDrive() {
    return request<{ success: boolean; message: string }>('/api/system/google-drive/connect', {
      method: 'POST',
    });
  },

  disconnectGoogleDrive() {
    return request<{ ok: boolean }>('/api/system/google-drive/disconnect', {
      method: 'POST',
    });
  },

  triggerGoogleDriveBackup() {
    return request<{ ok: boolean }>('/api/system/google-drive/backup-now', {
      method: 'POST',
    });
  },
};
