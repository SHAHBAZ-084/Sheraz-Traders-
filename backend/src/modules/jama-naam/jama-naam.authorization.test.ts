import { createServer, type Server } from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../lib/prisma';
import { createUser } from '../auth/auth.service';
import { createJamaNaamEntry } from './jama-naam.service';
import { KACHI_MAAL_CATEGORY_NAMES } from '../accounting/accounting.service';

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

describe('Jama Naam settle authorization', () => {
  let server: Server;
  let baseUrl: string;
  let partyId: number;
  let entryId: number;
  let clerkUsername: string;
  const clerkPassword = 'clerk-pass-123';

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

    const category = await prisma.accountCategory.findFirst({
      where: { isActive: true, name: KACHI_MAAL_CATEGORY_NAMES.SALE_PARTY },
    });
    if (!category) throw new Error('Sale Party category required');

    let party = await prisma.account.findFirst({
      where: { isActive: true, categoryId: category.id },
    });
    if (!party) {
      party = await prisma.account.create({
        data: {
          categoryId: category.id,
          name: 'Jama Naam Auth Test Party',
          code: `JN-AUTH-${Date.now()}`,
          type: 'ASSET',
        },
      });
      await prisma.ledger.create({ data: { accountId: party.id, balance: 0 } });
    }
    partyId = party.id;

    clerkUsername = `jn_clerk_${Date.now()}`;
    await createUser({
      username: clerkUsername,
      password: clerkPassword,
      displayName: 'Jama Naam Clerk',
    });

    const entry = await createJamaNaamEntry({
      partyId,
      amount: 1000,
      direction: 'JAMA',
      date: new Date().toISOString().slice(0, 10),
      notes: 'Auth test entry',
    });
    entryId = entry.id;
  });

  afterAll(async () => {
    await prisma.jamaNaamEntry.deleteMany({ where: { id: entryId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { username: clerkUsername } }).catch(() => undefined);
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('rejects settle (DELETE) for non-admin users with 403', async () => {
    const cookie = await login(baseUrl, clerkUsername, clerkPassword);

    const response = await fetch(`${baseUrl}/api/jama-naam/${entryId}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/admin/i);

    const stillThere = await prisma.jamaNaamEntry.findUnique({ where: { id: entryId } });
    expect(stillThere).not.toBeNull();
  });

  it('allows settle (DELETE) for admin users', async () => {
    const cookie = await login(baseUrl, 'admin', 'admin123');

    const response = await fetch(`${baseUrl}/api/jama-naam/${entryId}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });

    expect(response.status).toBe(200);

    const deleted = await prisma.jamaNaamEntry.findUnique({ where: { id: entryId } });
    expect(deleted).toBeNull();
  });
});
