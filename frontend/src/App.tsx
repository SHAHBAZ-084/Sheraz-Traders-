import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppShell } from './components/layout/AppShell';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AdminRoute } from './components/AdminRoute';
import { AuthProvider } from './contexts/AuthContext';
import { AccountManagePage } from './pages/accounts/AccountManagePage';
import { CategoryManagePage } from './pages/accounts/CategoryManagePage';
import { PurchasePartiesPage, SalePartiesPage } from './pages/accounts/PartiesPage';
import { ProductRemovePage } from './pages/accounts/ProductManagePage';
import { AddProductPage } from './pages/products/AddProductPage';
import { StockTransferPage } from './pages/inventory/StockTransferPage';
import { StockAdjustmentPage } from './pages/inventory/StockAdjustmentPage';
import { InvoiceFormPage } from './pages/invoices/InvoiceFormPage';
import { ViewInvoicePage } from './pages/invoices/ViewInvoicePage';
import { InvoiceBillPrintPage } from './pages/invoices/InvoiceBillPrintPage';
import { LoginPage } from './pages/LoginPage';
import { HomePage } from './pages/HomePage';
import { PosHomePage } from './pages/PosHomePage';
import { AccountReportsPage, AccountBalancePage, ProfitLossStatementPage, StockReportPage, TrialBalancePage, VouchersReportPage } from './pages/reports/ReportPages';
import { FinancialYearReportsHubPage, FinancialYearReportsPickerPage } from './pages/reports/FinancialYearReportsPage';
import { SystemPreferencesPage } from './pages/system/SystemPreferencesPage';
import { DatabaseMaintenancePage } from './pages/system/DatabaseMaintenancePage';
import { StoresPage } from './pages/system/StoresPage';
import { PendingApprovalsPage } from './pages/system/PendingApprovalsPage';
import { FinancialYearProvider } from './contexts/FinancialYearContext';
import { FinancialYearManagementPage } from './pages/admin/FinancialYearManagementPage';
import { UserInfoPage } from './pages/user/UserInfoPage';
import { VoucherFormPage, VoucherListPage } from './pages/vouchers/VoucherPages';
import { JamaNaamRegisterPage } from './pages/jama-naam/JamaNaamRegisterPage';

export default function App() {
  return (
    <ErrorBoundary title="Sheeraz Traders encountered an error">
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<FinancialYearProvider><AppShell /></FinancialYearProvider>}>
                <Route path="/" element={<HomePage />} />
                <Route path="/dashboard" element={<PosHomePage />} />

                <Route path="/accounts/categories/add" element={<CategoryManagePage mode="add" />} />
                <Route path="/accounts/categories/edit" element={<CategoryManagePage mode="edit" />} />
                <Route element={<AdminRoute />}>
                  <Route path="/accounts/categories/remove" element={<CategoryManagePage mode="remove" />} />
                  <Route path="/accounts/manage/remove" element={<AccountManagePage mode="remove" />} />
                  <Route path="/products/remove" element={<ProductRemovePage />} />
                </Route>
                <Route path="/accounts/manage/add" element={<AccountManagePage mode="add" />} />
                <Route path="/accounts/manage/edit" element={<AccountManagePage mode="edit" />} />
                <Route path="/products/add" element={<AddProductPage />} />
                <Route path="/accounts/products/add" element={<Navigate to="/products/add" replace />} />
                <Route path="/accounts/products/remove" element={<Navigate to="/products/remove" replace />} />
                <Route path="/accounts/sale-parties" element={<SalePartiesPage />} />
                <Route path="/accounts/purchase-parties" element={<PurchasePartiesPage />} />

                <Route path="/invoices/kachi-maal" element={<InvoiceFormPage slug="kachi-maal" />} />
                <Route path="/invoices/sale-invoice" element={<InvoiceFormPage slug="sale-invoice" />} />
                <Route path="/invoices/purchase-invoice" element={<InvoiceFormPage slug="purchase-invoice" />} />
                <Route path="/invoices/view-invoice" element={<ViewInvoicePage />} />
                <Route path="/invoices/print-bill" element={<InvoiceBillPrintPage />} />

                <Route path="/jama-naam" element={<JamaNaamRegisterPage />} />

                <Route path="/inventory/stock-transfer" element={<StockTransferPage />} />
                <Route path="/inventory/stock-adjustment" element={<StockAdjustmentPage />} />

                <Route path="/vouchers/receipt" element={<VoucherFormPage kind="receipt" />} />
                <Route path="/vouchers/payment" element={<VoucherFormPage kind="payment" />} />
                <Route path="/vouchers/journal" element={<VoucherFormPage kind="journal" />} />
                <Route path="/vouchers/view" element={<VoucherListPage />} />

                <Route path="/reports/accounts" element={<AccountReportsPage />} />
                <Route path="/reports/account-balance" element={<AccountBalancePage />} />
                <Route path="/reports/vouchers" element={<VouchersReportPage />} />
                <Route path="/reports/trial-balance" element={<TrialBalancePage />} />
                <Route path="/reports/profit-loss" element={<ProfitLossStatementPage />} />
                <Route path="/reports/financial-year" element={<FinancialYearReportsPickerPage />} />
                <Route path="/reports/financial-year/:yearId" element={<FinancialYearReportsHubPage />} />
                <Route path="/reports/stock" element={<StockReportPage />} />

                <Route path="/system/database" element={<DatabaseMaintenancePage />} />
                <Route path="/system/stores" element={<StoresPage />} />
                <Route path="/system/approvals" element={<PendingApprovalsPage />} />
                <Route path="/system/preferences" element={<SystemPreferencesPage />} />
                <Route path="/user" element={<UserInfoPage />} />
                <Route path="/user/fy-management" element={<FinancialYearManagementPage />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}
