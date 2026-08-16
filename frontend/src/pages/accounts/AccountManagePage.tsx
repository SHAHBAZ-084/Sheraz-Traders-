import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { formatLedgerBalance } from '../../lib/format';
import { sanitizeDecimalInput } from '../../lib/numericInput';
import { api, type Account, type AccountCategory } from '../../lib/api';
import {
  FieldLabel,
  LegacyTable,
  PageShell,
  Panel,
  PrimaryButton,
  SecondaryButton,
  TextInput,
} from '../../components/ui/PageShell';
import { DecimalInput } from '../../components/ui/DecimalInput';
import { PageCloseBar } from '../../components/ui/PageCloseBar';

type Mode = 'add' | 'edit' | 'remove';

const copy: Record<Mode, { title: string; subtitle: string }> = {
  add: { title: 'Add Account', subtitle: 'Create a new account under a category' },
  edit: { title: 'Edit Account', subtitle: 'Rename an existing account' },
  remove: { title: 'Remove Account', subtitle: 'Soft-delete an account' },
};

function parseOpeningAmount(raw: string): number {
  const cleaned = sanitizeDecimalInput(raw.trim());
  if (!cleaned) return 0;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : NaN;
}

function suggestedOpeningSideForCategory(categoryId: number, accounts: Account[]): 'DR' | 'CR' {
  const sibling = accounts.find((a) => a.categoryId === categoryId);
  if (sibling) {
    return sibling.type === 'ASSET' || sibling.type === 'EXPENSE' ? 'DR' : 'CR';
  }
  return 'DR';
}

export function AccountManagePage({ mode }: { mode: Mode }) {
  const [categories, setCategories] = useState<AccountCategory[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [name, setName] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [openingBalanceSide, setOpeningBalanceSide] = useState<'DR' | 'CR'>('DR');
  const openingSideTouched = useRef(false);
  const [selectedId, setSelectedId] = useState<number | ''>('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filterCategoryId, setFilterCategoryId] = useState<number | ''>('');

  useEffect(() => {
    api.listCategories().then(setCategories).catch(() => setCategories([]));
    api.listAccounts({ forSelectors: false }).then(setAccounts).catch(() => setAccounts([]));
  }, []);

  useEffect(() => {
    if (mode === 'edit' && selectedId) {
      const account = accounts.find((a) => a.id === selectedId);
      setName(account?.name ?? '');
    }
  }, [selectedId, accounts, mode]);

  useEffect(() => {
    if (mode === 'add' && categoryId && !openingSideTouched.current) {
      setOpeningBalanceSide(suggestedOpeningSideForCategory(Number(categoryId), accounts));
    }
  }, [categoryId, accounts, mode]);

  const parsedOpeningAmount = useMemo(() => parseOpeningAmount(openingBalance), [openingBalance]);
  const hasOpeningAmount = parsedOpeningAmount > 0;

  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === categoryId),
    [categories, categoryId],
  );

  const filteredAccounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (accounts ?? []).filter((a) => {
      if (filterCategoryId !== '' && a.categoryId !== filterCategoryId) return false;
      if (!q) return true;
      const haystack = [a.name, a.code, a.category?.name ?? ''].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [accounts, search, filterCategoryId]);

  async function reload(modeHint: Mode = mode) {
    if (modeHint === 'remove' || modeHint === 'edit') {
      setAccounts(await api.listAccounts({ forSelectors: false }));
      return;
    }
    setCategories(await api.listCategories());
    setAccounts(await api.listAccounts({ forSelectors: false }));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      if (mode === 'add') {
        if (!categoryId) throw new Error('Select a category');
        if (openingBalance.trim() && !Number.isFinite(parsedOpeningAmount)) {
          throw new Error('Opening balance must be a valid number');
        }
        if (openingBalance.trim() && parsedOpeningAmount < 0) {
          throw new Error('Opening balance must be zero or greater');
        }
        const created = await api.createAccount({
          categoryId: Number(categoryId),
          name,
          ...(hasOpeningAmount
            ? { openingBalance: parsedOpeningAmount, openingBalanceSide }
            : {}),
        });
        if (hasOpeningAmount && created.ledger) {
          setMessage(
            `Account created with opening balance ${formatLedgerBalance(created.ledger.balance)}.`,
          );
        } else {
          setMessage('Account created.');
        }
        setCategoryId('');
        setName('');
        setOpeningBalance('');
        setOpeningBalanceSide('DR');
        openingSideTouched.current = false;
      } else if (mode === 'edit') {
        if (!selectedId) throw new Error('Select an account');
        await api.updateAccount(Number(selectedId), { name });
        setMessage('Account updated.');
        setSelectedId('');
        setName('');
      } else {
        if (!selectedId) throw new Error('Select an account');
        await api.removeAccount(Number(selectedId));
        setMessage('Account removed.');
        setSelectedId('');
      }
      await reload(mode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  const { title, subtitle } = copy[mode];

  return (
    <PageShell title={title} subtitle={subtitle}>
      <Panel className="max-w-lg">
        <form className="space-y-4" onSubmit={onSubmit}>
          {mode === 'add' ? (
            <>
              <div>
                <FieldLabel>Category</FieldLabel>
                <select
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                  value={categoryId}
                  onChange={(e) => {
                    openingSideTouched.current = false;
                    setCategoryId(e.target.value ? Number(e.target.value) : '');
                  }}
                  required
                >
                  <option value="">Select category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <FieldLabel>Account name</FieldLabel>
                <TextInput value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <FieldLabel>Opening balance</FieldLabel>
                  <DecimalInput
                    value={openingBalance}
                    onChange={setOpeningBalance}
                    placeholder="0.00 (optional)"
                  />
                </div>
                <div>
                  <FieldLabel>Opening balance side</FieldLabel>
                  <select
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                    value={openingBalanceSide}
                    onChange={(e) => {
                      openingSideTouched.current = true;
                      setOpeningBalanceSide(e.target.value as 'DR' | 'CR');
                    }}
                    disabled={!hasOpeningAmount}
                  >
                    <option value="DR">Dr</option>
                    <option value="CR">Cr</option>
                  </select>
                  {selectedCategory && !openingSideTouched.current ? (
                    <p className="mt-1 text-xs text-textMuted">
                      Suggested for {selectedCategory.name}: {suggestedOpeningSideForCategory(selectedCategory.id, accounts)} — you can choose Dr or Cr
                    </p>
                  ) : null}
                </div>
              </div>
            </>
          ) : (
            <>
              <div>
                <FieldLabel>Account</FieldLabel>
                <select
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                  value={selectedId}
                  onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : '')}
                  required
                >
                  <option value="">Select account</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
              {mode === 'edit' ? (
                <div>
                  <FieldLabel>Account name</FieldLabel>
                  <TextInput value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
              ) : null}
            </>
          )}
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          {message ? <p className="text-sm text-success">{message}</p> : null}
          <div className="flex gap-2">
            <PrimaryButton type="submit">{mode === 'remove' ? 'Remove' : 'Save'}</PrimaryButton>
            <SecondaryButton type="button" onClick={() => { setCategoryId(''); setName(''); setOpeningBalance(''); setOpeningBalanceSide('DR'); openingSideTouched.current = false; setSelectedId(''); }}>Clear</SecondaryButton>
          </div>
        </form>
      </Panel>

      {mode === 'add' ? (
        <Panel className="mt-4">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3 relative z-[1]">
            <h2 className="text-sm font-semibold text-textPrimary">Accounts</h2>
            <div className="flex flex-wrap gap-2">
              <div className="min-w-[12rem]">
                <FieldLabel>Search</FieldLabel>
                <TextInput
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name, code…"
                />
              </div>
              <div className="min-w-[10rem]">
                <FieldLabel>Filter category</FieldLabel>
                <select
                  className="w-full rounded-sm border border-border px-2.5 py-2 text-sm"
                  value={filterCategoryId === '' ? '' : String(filterCategoryId)}
                  onChange={(e) => {
                    const v = e.target.value;
                    setFilterCategoryId(v === '' ? '' : Number(v));
                  }}
                >
                  <option value="">All categories</option>
                  {(Array.isArray(categories) ? categories : []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <LegacyTable>
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Code</th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              {filteredAccounts.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-textMuted">
                    {(accounts?.length ?? 0) === 0 ? 'No accounts yet.' : 'No accounts match the search/filter.'}
                  </td>
                </tr>
              ) : (
                filteredAccounts.map((a) => (
                  <tr key={a.id}>
                    <td>{a.name}</td>
                    <td>{a.category?.name ?? '—'}</td>
                    <td>{a.code}</td>
                    <td>{formatLedgerBalance(a.ledger?.balance ?? 0)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </LegacyTable>
        </Panel>
      ) : null}

      <PageCloseBar />
    </PageShell>
  );
}
