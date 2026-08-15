/**
 * One-time adapter: transforms CROWNEV accounting.service.ts for single-shop Grain Market POS.
 * Reads reference file only; writes output into this project.
 */
const fs = require('fs');
const path = require('path');

const source = path.resolve(__dirname, '../../../backend/src/modules/accounting/accounting.service.ts');
const dest = path.resolve(__dirname, '../src/modules/accounting/accounting.service.ts');

let content = fs.readFileSync(source, 'utf8');

content = content
  .replace(
    "import { prisma } from '../../config/database.js';",
    "import { prisma } from '../../lib/prisma';",
  )
  .replace(
    "import { AppError } from '../../utils/helpers.js';",
    "import { AppError } from '../../utils/helpers';",
  )
  .replace('OrderType, ', '')
  .replace(/export const BRANCH_DEFAULT_CATEGORY_NAMES/g, 'export const DEFAULT_CATEGORY_NAMES')
  .replace(/bootstrapBranchChartOfAccounts/g, 'bootstrapChartOfAccounts')
  .replace(/createdById: string/g, 'createdById: number')
  .replace(/userId: string/g, 'userId: number')
  .replace(/approvedById: string/g, 'approvedById: number');

// User display fields
content = content.replace(
  /createdBy: \{ select: \{ firstName: true, lastName: true \} \}/g,
  "createdBy: { select: { id: true, displayName: true, username: true } }",
);
content = content.replace(
  /modifiedBy: \{ select: \{ firstName: true, lastName: true \} \}/g,
  "modifiedBy: { select: { id: true, displayName: true, username: true } }",
);
content = content.replace(
  /deletedBy: \{ select: \{ firstName: true, lastName: true \} \}/g,
  "deletedBy: { select: { id: true, displayName: true, username: true } }",
);
content = content.replace(
  /closedBy: \{ select: \{ firstName: true, lastName: true \} \}/g,
  "closedBy: { select: { id: true, displayName: true, username: true } }",
);
content = content.replace(
  /approvedBy: \{ select: \{ firstName: true, lastName: true \} \}/g,
  "approvedBy: { select: { id: true, displayName: true, username: true } }",
);

// Function signatures: remove branchId param
content = content.replace(
  /export async function getActiveFinancialYearId\(db: DbClient, branchId: number\)/g,
  'export async function getActiveFinancialYearId(db: DbClient)',
);
content = content.replace(
  /export async function assertActiveFinancialYear\(\s*db: DbClient,\s*branchId: number,\s*financialYearId: number \| null \| undefined,\s*\)/g,
  'export async function assertActiveFinancialYear(\n  db: DbClient,\n  financialYearId: number | null | undefined,\n)',
);
content = content.replace(
  /export async function listFinancialYears\(branchId: number\)/g,
  'export async function listFinancialYears()',
);
content = content.replace(
  /export async function closeFinancialYear\(branchId: number, userId: number\)/g,
  'export async function closeFinancialYear(userId: number)',
);

const stripBranchIdFromFn = (name) => {
  content = content.replace(
    new RegExp(`export async function ${name}\\(branchId: number`, 'g'),
    `export async function ${name}(`,
  );
  content = content.replace(
    new RegExp(`export async function ${name}\\(\\s*branchId: number,`, 'g'),
    `export async function ${name}(`,
  );
};

[
  'ensureCustomersCategory',
  'ensureSuppliersCategory',
  'ensureInventoryCategory',
  'listAccountCategories',
  'createAccountCategory',
  'listAccounts',
  'syncCustomerSupplierAccounts',
  'listVouchers',
  'getTrialBalance',
  'listTrialBalanceApprovals',
].forEach(stripBranchIdFromFn);

content = content.replace(
  /export async function softDeleteAccountCategory\(id: number, branchId: number\)/g,
  'export async function softDeleteAccountCategory(id: number)',
);
content = content.replace(
  /export async function createAccount\(data: \{\s*branchId: number;/g,
  'export async function createAccount(data: {',
);
content = content.replace(
  /export async function createVoucher\(data: \{\s*branchId: number;/g,
  'export async function createVoucher(data: {',
);
content = content.replace(
  /export async function createVoucherInTx\(\s*tx: Prisma\.TransactionClient,\s*data: \{\s*branchId: number;/g,
  'export async function createVoucherInTx(\n  tx: Prisma.TransactionClient,\n  data: {',
);
content = content.replace(
  /export async function updateVoucherAmount\(\s*branchId: number,\s*voucherId: number,/g,
  'export async function updateVoucherAmount(\n  voucherId: number,',
);
content = content.replace(
  /export async function cancelVoucher\(branchId: number, voucherId: number, userId: number\)/g,
  'export async function cancelVoucher(voucherId: number, userId: number)',
);
content = content.replace(
  /export async function restoreVoucher\(branchId: number, voucherId: number, userId: number\)/g,
  'export async function restoreVoucher(voucherId: number, userId: number)',
);
content = content.replace(
  /export async function deleteVoucher\(branchId: number, voucherId: number, userId: number\)/g,
  'export async function deleteVoucher(voucherId: number, userId: number)',
);
content = content.replace(
  /export async function getLedgerEntries\(\s*accountId: number,\s*branchId: number,/g,
  'export async function getLedgerEntries(\n  accountId: number,',
);
content = content.replace(
  /export async function getLedgerEntriesForYear\(\s*accountId: number,\s*branchId: number,\s*financialYearId: number,/g,
  'export async function getLedgerEntriesForYear(\n  accountId: number,\n  financialYearId: number,',
);
content = content.replace(
  /export async function approveTrialBalance\(data: \{\s*branchId: number;/g,
  'export async function approveTrialBalance(data: {',
);
content = content.replace(
  /export async function updateAccount\(\s*id: number,\s*branchId: number,/g,
  'export async function updateAccount(\n  id: number,',
);
content = content.replace(
  /export async function softDeleteAccount\(id: number, branchId: number\)/g,
  'export async function softDeleteAccount(id: number)',
);

// Internal helpers with branchId
content = content.replace(/branchId: number,\s*debitAccountId/g, 'debitAccountId');
content = content.replace(/async function getOpeningBalanceSnapshot\(\s*db: DbClient,\s*branchId: number,/g, 'async function getOpeningBalanceSnapshot(\n  db: DbClient,');
content = content.replace(/async function loadBranchAccounts\(/g, 'async function loadAccounts(');
content = content.replace(/async function nextVoucherNumber\(\s*tx: Prisma\.TransactionClient,\s*branchId: number,/g, 'async function nextVoucherNumber(\n  tx: Prisma.TransactionClient,');
content = content.replace(/async function buildLedgerEntriesReport\(\s*accountId: number,\s*branchId: number,/g, 'async function buildLedgerEntriesReport(\n  accountId: number,');

// ensure*Account(tx, branchId, -> ensure*Account(tx,
content = content.replace(/ensureCustomerAccount\(tx, branchId,/g, 'ensureCustomerAccount(tx,');
content = content.replace(/ensureSupplierAccount\(tx, branchId,/g, 'ensureSupplierAccount(tx,');
content = content.replace(/ensureSaleRevenueAccount\(tx, branchId\)/g, 'ensureSaleRevenueAccount(tx)');
content = content.replace(/ensureServiceRevenueAccount\(tx, branchId\)/g, 'ensureServiceRevenueAccount(tx)');
content = content.replace(/ensureInventoryAccount\(tx, branchId\)/g, 'ensureInventoryAccount(tx)');
content = content.replace(/consolidateDuplicateInventoryAccounts\(tx, branchId\)/g, 'consolidateDuplicateInventoryAccounts(tx)');
content = content.replace(/syncCustomerSupplierAccountsInTx\(tx, branchId\)/g, 'syncCustomerSupplierAccountsInTx(tx)');
content = content.replace(/ensureCustomersCategoryInTx\(tx, branchId\)/g, 'ensureCustomersCategoryInTx(tx)');
content = content.replace(/ensureSuppliersCategoryInTx\(tx, branchId\)/g, 'ensureSuppliersCategoryInTx(tx)');
content = content.replace(/ensureInventoryCategoryInTx\(tx, branchId\)/g, 'ensureInventoryCategoryInTx(tx)');
content = content.replace(/ensureCategoryInTx\(tx, branchId,/g, 'ensureCategoryInTx(tx,');
content = content.replace(/ensureDefaultAccountInTx\(\s*tx,\s*branchId,/g, 'ensureDefaultAccountInTx(\n  tx,');
content = content.replace(/postOpeningBalanceOffset\(tx, data\.branchId,/g, 'postOpeningBalanceOffset(tx,');
content = content.replace(/postOpeningBalanceOffset\(tx, branchId,/g, 'postOpeningBalanceOffset(tx,');
content = content.replace(/findOrCreateOpeningBalanceEquityAccount\(\s*tx,\s*branchId,/g, 'findOrCreateOpeningBalanceEquityAccount(\n  tx,');
content = content.replace(/generateNextAccountCodeInTx\(tx, branchId\)/g, 'generateNextAccountCodeInTx(tx)');
content = content.replace(/generateNextAccountCode\(branchId\)/g, 'generateNextAccountCode()');
content = content.replace(/assertUniqueCategoryName\(branchId,/g, 'assertUniqueCategoryName(');
content = content.replace(/assertUniqueAccountName\(branchId,/g, 'assertUniqueAccountName(');
content = content.replace(/assertUniqueAccountCode\(branchId,/g, 'assertUniqueAccountCode(');
content = content.replace(/resolveAccountType\(\s*branchId,/g, 'resolveAccountType(');
content = content.replace(/loadPurchaseDescriptionsByRef\(branchId,/g, 'loadPurchaseDescriptionsByRef(');
content = content.replace(/loadSaleDescriptionsByRef\(branchId,/g, 'loadSaleDescriptionsByRef(');
content = content.replace(/cancelVoucherInTx\(tx, branchId,/g, 'cancelVoucherInTx(tx,');
content = content.replace(/cancelActiveVouchersByReferenceInTx\(\s*tx,\s*branchId,/g, 'cancelActiveVouchersByReferenceInTx(\n  tx,');
content = content.replace(/consolidateDuplicateInventoryCategories\(tx, branchId\)/g, 'consolidateDuplicateInventoryCategories(tx)');

// Remove branchId from prisma where/create objects (common patterns)
content = content.replace(/where: \{ branchId, status: FinancialYearStatus\.ACTIVE \}/g, 'where: { status: FinancialYearStatus.ACTIVE }');
content = content.replace(/where: \{ id: financialYearId, branchId \}/g, 'where: { id: financialYearId }');
content = content.replace(/where: \{ id: financialYearId, branchId, \}/g, 'where: { id: financialYearId }');
content = content.replace(/where: \{ id, branchId,/g, 'where: { id,');
content = content.replace(/where: \{ id, branchId \}/g, 'where: { id }');
content = content.replace(/where: \{ branchId \}/g, 'where: {}');
content = content.replace(/where: \{ branchId, isActive: true \}/g, 'where: { isActive: true }');
content = content.replace(/where: \{ branchId, isActive: true,/g, 'where: { isActive: true,');
content = content.replace(/where: \{ branchId,/g, 'where: {');
content = content.replace(/data: \{ branchId, name:/g, 'data: { name:');
content = content.replace(/data: \{ branchId, categoryId:/g, 'data: { categoryId:');
content = content.replace(/data: \{ branchId, accountId:/g, 'data: { accountId:');
content = content.replace(/branchId,\s*label:/g, 'label:');
content = content.replace(/branchId,\s*type,/g, 'type,');
content = content.replace(/branchId,\s*status:/g, 'status:');
content = content.replace(/branchId,\s*period:/g, 'period:');
content = content.replace(/\.\.\.data,\s*branchId,/g, '...data,');
content = content.replace(/branchId: data\.branchId,\s*/g, '');
content = content.replace(/branchId,\s*\.\.\.req\.body/g, '...req.body');
content = content.replace(/getActiveFinancialYearId\(tx, data\.branchId\)/g, 'getActiveFinancialYearId(tx)');
content = content.replace(/getActiveFinancialYearId\(tx, branchId\)/g, 'getActiveFinancialYearId(tx)');
content = content.replace(/getActiveFinancialYearId\(prisma, branchId\)/g, 'getActiveFinancialYearId(prisma)');
content = content.replace(/assertActiveFinancialYear\(tx, branchId,/g, 'assertActiveFinancialYear(tx,');
content = content.replace(/loadAccounts\(\s*tx,\s*data\.branchId,/g, 'loadAccounts(\n    tx,');
content = content.replace(/loadBranchAccounts\(\s*tx,\s*data\.branchId,/g, 'loadAccounts(\n    tx,');
content = content.replace(/loadAccounts\(\s*tx,\s*branchId,/g, 'loadAccounts(\n    tx,');
content = content.replace(/nextVoucherNumber\(tx, data\.branchId,/g, 'nextVoucherNumber(tx,');
content = content.replace(/nextVoucherNumber\(tx, branchId,/g, 'nextVoucherNumber(tx,');
content = content.replace(/where: \{ branchId, type, financialYearId \}/g, 'where: { type, financialYearId }');
content = content.replace(/where: \{ branchId, reference:/g, 'where: { reference:');
content = content.replace(/where: \{ accountId, branchId \}/g, 'where: { accountId }');
content = content.replace(/where: \{ id: voucherId, branchId \}/g, 'where: { id: voucherId }');
content = content.replace(/where: \{ branchId, code \}/g, 'where: { code }');
content = content.replace(/where: \{ branchId, code: \{ equals: trimmed, mode: 'insensitive' \} \}/g, "where: { code: { equals: trimmed, mode: 'insensitive' } }");
content = content.replace(/where: \{ branchId, name: \{ equals: trimmed, mode: 'insensitive' \} \}/g, "where: { name: { equals: trimmed, mode: 'insensitive' } }");
content = content.replace(/where: \{ branchId_period: \{ branchId: data\.branchId, period: data\.period \} \}/g, 'where: { period: data.period }');
content = content.replace(/branchId: data\.branchId,\s*period:/g, 'period:');
content = content.replace(/create: \{\s*branchId: data\.branchId,/g, 'create: {');
content = content.replace(/getTrialBalance\(data\.branchId\)/g, 'getTrialBalance()');
content = content.replace(/listAccounts\(branchId\)/g, 'listAccounts()');
content = content.replace(/await bootstrapChartOfAccounts\(branchId\)/g, 'await bootstrapChartOfAccounts()');
content = content.replace(/await consolidateDuplicateInventoryAccounts\(tx, branchId\)/g, 'await consolidateDuplicateInventoryAccounts(tx)');
content = content.replace(/await syncCustomerSupplierAccountsInTx\(tx, branchId\)/g, 'await syncCustomerSupplierAccountsInTx(tx)');
content = content.replace(/buildLedgerEntriesReport\(accountId, branchId,/g, 'buildLedgerEntriesReport(accountId,');
content = content.replace(/getOpeningBalanceSnapshot\(\s*prisma,\s*branchId,/g, 'getOpeningBalanceSnapshot(\n    prisma,');
content = content.replace(/getLedgerEntries\(accountId, branchId,/g, 'getLedgerEntries(accountId,');
content = content.replace(/getLedgerEntriesForYear\(\s*accountId,\s*branchId,/g, 'getLedgerEntriesForYear(\n          accountId,');
content = content.replace(/cancelVoucher\(branchId,/g, 'cancelVoucher(');
content = content.replace(/restoreVoucher\(branchId,/g, 'restoreVoucher(');
content = content.replace(/deleteVoucher\(branchId,/g, 'deleteVoucher(');
content = content.replace(/updateVoucherAmount\(\s*branchId,/g, 'updateVoucherAmount(');
content = content.replace(/softDeleteAccountCategory\(\s*parseInt\(param\(req\.params\.id\), 10\),\s*branchId,/g, 'softDeleteAccountCategory(parseInt(param(req.params.id), 10),');
content = content.replace(/softDeleteAccount\(\s*parseInt\(param\(req\.params\.id\), 10\),\s*branchId,/g, 'softDeleteAccount(parseInt(param(req.params.id), 10),');

// Remove bank account section (model not in scope)
content = content.replace(/export async function listBankAccounts[\s\S]*?export async function createBankAccount[\s\S]*?\}\n\}\n\n/, '');
content = content.replace(/export async function updateBankAccount[\s\S]*?\}\n\n/, '');

// Stub purchase/sale description loaders (Purchase/Order models not yet in grain POS)
content = content.replace(
  /async function loadPurchaseDescriptionsByRef\([\s\S]*?return map;\n\}/,
  'async function loadPurchaseDescriptionsByRef(_refs: string[]) {\n  return new Map<string, string>();\n}',
);
content = content.replace(
  /async function loadSaleDescriptionsByRef\([\s\S]*?return map;\n\}/,
  'async function loadSaleDescriptionsByRef(_refs: string[]) {\n  return new Map<string, string>();\n}',
);

// Fix remaining branchId in prior year lookup
content = content.replace(
  /where: \{\s*branchId,\s*startDate: \{ lt: currentYear\.startDate \},\s*\}/g,
  'where: { startDate: { lt: currentYear.startDate } }',
);

// Fix invalid for this branch messages
content = content.replace(/invalid for this branch/g, 'invalid');
content = content.replace(/No active financial year for this branch/g, 'No active financial year');
content = content.replace(/Invalid category for this branch/g, 'Invalid category');

// Fix createAccount category lookup
content = content.replace(
  /where: \{ id: data\.categoryId, branchId: data\.branchId, isActive: true \}/g,
  'where: { id: data.categoryId, isActive: true }',
);

// Fix resolveAccountType sibling lookup - remove branchId from where
content = content.replace(
  /where: \{ branchId, categoryId, isActive: true \}/g,
  'where: { categoryId, isActive: true }',
);

// Fix ensure* category lookups with insensitive name
content = content.replace(
  /where: \{ branchId, isActive: true, name: \{ equals: CUSTOMERS_CATEGORY_NAME/g,
  'where: { isActive: true, name: { equals: CUSTOMERS_CATEGORY_NAME',
);
content = content.replace(
  /where: \{ branchId, isActive: true, name: \{ equals: SUPPLIERS_CATEGORY_NAME/g,
  'where: { isActive: true, name: { equals: SUPPLIERS_CATEGORY_NAME',
);
content = content.replace(
  /where: \{ branchId, isActive: true, name: \{ equals: INVENTORY_CATEGORY_NAME/g,
  'where: { isActive: true, name: { equals: INVENTORY_CATEGORY_NAME',
);
content = content.replace(
  /where: \{ branchId, isActive: true, name: \{ equals: INCOME_CATEGORY_NAME/g,
  'where: { isActive: true, name: { equals: INCOME_CATEGORY_NAME',
);
content = content.replace(
  /where: \{ branchId, isActive: true, name: \{ equals: name, mode: 'insensitive' \} \}/g,
  "where: { isActive: true, name: { equals: name, mode: 'insensitive' } }",
);

// Fix account findFirst with branchId in ensure* functions
content = content.replace(/where: \{\s*branchId,\s*isActive: true,\s*code \}/g, 'where: { isActive: true, code }');
content = content.replace(/where: \{\s*branchId,\s*isActive: true,\s*name: \{ equals: INVENTORY_ACCOUNT_NAME/g, 'where: { isActive: true, name: { equals: INVENTORY_ACCOUNT_NAME');
content = content.replace(/where: \{\s*branchId,\s*isActive: true,\s*categoryId: category\.id,/g, 'where: { isActive: true, categoryId: category.id,');

// Fix customer/supplier counts in listAccountCategories
content = content.replace(/prisma\.customer\.count\(\{ where: \{ branchId, isActive: true \} \}\)/g, 'prisma.customer.count({ where: { isActive: true } })');
content = content.replace(/prisma\.supplier\.count\(\{ where: \{ branchId, isActive: true \} \}\)/g, 'prisma.supplier.count({ where: { isActive: true } })');

// Fix tx.customer.findMany where branchId
content = content.replace(/where: \{ branchId, isActive: true \},\s*select: \{ id: true, name: true \}/g, 'where: { isActive: true }, select: { id: true, name: true }');

// Fix bootstrap - remove branchId from for loop call
content = content.replace(/export async function bootstrapChartOfAccounts\(branchId: number\)/g, 'export async function bootstrapChartOfAccounts()');
content = content.replace(/for \(const name of DEFAULT_CATEGORY_NAMES\) \{\s*await ensureCategoryInTx\(tx, branchId, name\);/g, 'for (const name of DEFAULT_CATEGORY_NAMES) {\n      await ensureCategoryInTx(tx, name);');
content = content.replace(/await ensureDefaultAccountInTx\(\s*tx,\s*branchId,\s*cashCategory\.id,/g, 'await ensureDefaultAccountInTx(\n      tx,\n      cashCategory.id,');

// Fix close financial year accounts query
content = content.replace(/const accounts = await tx\.account\.findMany\(\{\s*where: \{ branchId \},/g, 'const accounts = await tx.account.findMany({');

// Fix getActiveFinancialYearId call in assert
content = content.replace(/const activeId = await getActiveFinancialYearId\(db, branchId\)/g, 'const activeId = await getActiveFinancialYearId(db)');

// Fix ledger findMany trial balance
content = content.replace(/where: \{ branchId \},\s*include: \{ account: true \}/g, 'include: { account: true }');

// Remove duplicate branchId params in ensure functions at export level
content = content.replace(/export async function ensureCustomersCategory\(branchId: number\)/g, 'export async function ensureCustomersCategory()');
content = content.replace(/export async function ensureSuppliersCategory\(branchId: number\)/g, 'export async function ensureSuppliersCategory()');
content = content.replace(/export async function ensureInventoryCategory\(branchId: number\)/g, 'export async function ensureInventoryCategory()');

content = content.replace(
  /export async function ensureCustomerAccount\(\s*tx: Prisma\.TransactionClient,\s*branchId: number,/g,
  'export async function ensureCustomerAccount(\n  tx: Prisma.TransactionClient,',
);
content = content.replace(
  /export async function ensureSupplierAccount\(\s*tx: Prisma\.TransactionClient,\s*branchId: number,/g,
  'export async function ensureSupplierAccount(\n  tx: Prisma.TransactionClient,',
);

// Fix loadAccounts signature
content = content.replace(
  /async function loadAccounts\(\s*tx: Prisma\.TransactionClient,\s*debitAccountId: number,/g,
  'async function loadAccounts(\n  tx: Prisma.TransactionClient,\n  debitAccountId: number,',
);

// Fix account find in loadAccounts
content = content.replace(
  /where: \{ id: debitAccountId, branchId, isActive: true \}/g,
  'where: { id: debitAccountId, isActive: true }',
);
content = content.replace(
  /where: \{ id: creditAccountId, branchId, isActive: true \}/g,
  'where: { id: creditAccountId, isActive: true }',
);

// Fix createAccountCategory
content = content.replace(/createAccountCategory\(branchId, req\.body\.name\)/g, 'createAccountCategory(req.body.name)');
content = content.replace(/return prisma\.accountCategory\.create\(\{ data: \{ branchId, name: trimmedName \} \}\)/g, 'return prisma.accountCategory.create({ data: { name: trimmedName } })');

// Fix createAccount opening balance ledger
content = content.replace(/data: \{ branchId: data\.branchId, accountId: account\.id, balance: signedBalance \}/g, 'data: { accountId: account.id, balance: signedBalance }');

// Fix account create in createAccount
content = content.replace(
  /data: \{\s*branchId: data\.branchId,\s*categoryId: data\.categoryId,/g,
  'data: {\n        categoryId: data.categoryId,',
);

// Fix resolveAccountType call
content = content.replace(/resolveAccountType\(data\.branchId, data\.categoryId/g, 'resolveAccountType(data.categoryId');
content = content.replace(/assertUniqueAccountName\(data\.branchId, data\.name\)/g, 'assertUniqueAccountName(data.name)');
content = content.replace(/assertUniqueAccountCode\(data\.branchId, data\.code\)/g, 'assertUniqueAccountCode(data.code)');

// Fix cancelActiveVouchersByReferenceInTx signature
content = content.replace(
  /export async function cancelActiveVouchersByReferenceInTx\(\s*tx: Prisma\.TransactionClient,\s*reference: string,/g,
  'export async function cancelActiveVouchersByReferenceInTx(\n  tx: Prisma.TransactionClient,\n  reference: string,',
);

// Fix cancelVoucherInTx signature - remove branchId
content = content.replace(
  /export async function cancelVoucherInTx\(\s*tx: Prisma\.TransactionClient,\s*voucherId: number,/g,
  'export async function cancelVoucherInTx(\n  tx: Prisma.TransactionClient,\n  voucherId: number,',
);

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, content);
console.log('Wrote', dest);
