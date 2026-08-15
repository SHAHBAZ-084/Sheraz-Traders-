import { AccountType } from '@prisma/client';
import { createServer, type Server } from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../lib/prisma';
import { createUser } from '../auth/auth.service';
import { KACHI_MAAL_CATEGORY_NAMES } from '../accounting/accounting.service';
import { createProduct } from '../products/products.service';
import { createSaleParty } from '../parties/parties.service';
import { createStore } from '../stores/stores.service';

function extractSessionCookie(setCookie: string | null): string {
  if (!setCookie) throw new Error('Missing Set-Cookie header');
  const match = setCookie.match(/connect\.sid=[^;]+/);
  if (!match) throw new Error('Session cookie not found');
  return match[0];
}

async function login(baseUrl: string, username: string, password: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  expect(response.status).toBe(200);
  return extractSessionCookie(response.headers.get('set-cookie'));
}

describe('Delete/remove endpoint authorization', () => {
  let server: Server;
  let baseUrl: string;
  let clerkUsername: string;
  const clerkPassword = 'clerk-del-123';

  let productId: number;
  let salePartyId: number;
  let purchasePartyId: number;
  let emptyCategoryId: number;
  let removableAccountId: number;
  let storeId: number;

  beforeAll(async () => {
    const app = createApp();
    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to bind test server');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;

    clerkUsername = `del_clerk_${Date.now()}`;
    await createUser({
      username: clerkUsername,
      password: clerkPassword,
      displayName: 'Delete Auth Clerk',
    });

    const product = await createProduct({ name: `Delete Auth Product ${Date.now()}` });
    productId = product.id;

    const saleParty = await createSaleParty({ name: `Delete Auth Sale Party ${Date.now()}` });
    salePartyId = saleParty.id;

    const purchaseCategory = await prisma.accountCategory.findFirst({
      where: { isActive: true, name: KACHI_MAAL_CATEGORY_NAMES.PURCHASE_PARTY },
    });
    if (!purchaseCategory) throw new Error('Purchase party category missing');
    const purchaseParty = await prisma.account.create({
      data: {
        categoryId: purchaseCategory.id,
        name: `Delete Auth Purchase Party ${Date.now()}`,
        code: `DEL-PP-${Date.now()}`,
        type: AccountType.LIABILITY,
      },
    });
    await prisma.ledger.create({ data: { accountId: purchaseParty.id, balance: 0 } });
    purchasePartyId = purchaseParty.id;

    const emptyCategory = await prisma.accountCategory.create({
      data: { name: `Delete Auth Empty Cat ${Date.now()}` },
    });
    emptyCategoryId = emptyCategory.id;

    const expenseCategory = await prisma.accountCategory.findFirst({
      where: { isActive: true, name: 'Expenses' },
    });
    if (!expenseCategory) throw new Error('Expenses category missing');
    const account = await prisma.account.create({
      data: {
        categoryId: expenseCategory.id,
        name: `Delete Auth Account ${Date.now()}`,
        code: `DEL-ACC-${Date.now()}`,
        type: AccountType.EXPENSE,
      },
    });
    await prisma.ledger.create({ data: { accountId: account.id, balance: 0 } });
    removableAccountId = account.id;

    storeId = (await createStore(`Delete Auth Store ${Date.now()}`)).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: clerkUsername } }).catch(() => undefined);
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it.each([
    ['DELETE /api/products/:id', (id: number) => `/api/products/${id}`],
    ['DELETE /api/parties/sale-parties/:id', (id: number) => `/api/parties/sale-parties/${id}`],
    ['DELETE /api/parties/purchase-parties/:id', (id: number) => `/api/parties/purchase-parties/${id}`],
    ['DELETE /api/accounting/categories/:id', (id: number) => `/api/accounting/categories/${id}`],
    ['DELETE /api/accounting/accounts/:id', (id: number) => `/api/accounting/accounts/${id}`],
    ['DELETE /api/stores/:id', (id: number) => `/api/stores/${id}`],
  ])('rejects %s for non-admin with 403', async (_label, pathFor) => {
    const cookie = await login(baseUrl, clerkUsername, clerkPassword);
    const targetId =
      _label.includes('products') ? productId
      : _label.includes('sale-parties') ? salePartyId
      : _label.includes('purchase-parties') ? purchasePartyId
      : _label.includes('categories') ? emptyCategoryId
      : _label.includes('accounts') ? removableAccountId
      : storeId;

    const response = await fetch(`${baseUrl}${pathFor(targetId)}`, {
      method: 'DELETE',
      headers: {
        Cookie: cookie,
        ...( _label.includes('stores') ? { 'Content-Type': 'application/json' } : {}),
      },
      body: _label.includes('stores') ? JSON.stringify({ confirmPassword: clerkPassword }) : undefined,
    });

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/admin/i);
  });

  it('rejects store deactivate (PATCH) for non-admin with 403', async () => {
    const cookie = await login(baseUrl, clerkUsername, clerkPassword);
    const response = await fetch(`${baseUrl}/api/stores/${storeId}`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: false }),
    });
    expect(response.status).toBe(403);
  });

  it('allows admin DELETE /api/products/:id', async () => {
    const disposable = await createProduct({ name: `Admin Delete Product ${Date.now()}` });
    const cookie = await login(baseUrl, 'admin', 'admin123');
    const response = await fetch(`${baseUrl}/api/products/${disposable.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(200);
    const removed = await prisma.product.findFirst({ where: { id: disposable.id, isActive: true } });
    expect(removed).toBeNull();
  });
});
