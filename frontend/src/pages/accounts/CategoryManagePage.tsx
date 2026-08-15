import { FormEvent, useEffect, useState } from 'react';
import { api, type AccountCategory } from '../../lib/api';
import { FieldLabel, PageShell, Panel, PrimaryButton, SecondaryButton, TextInput } from '../../components/ui/PageShell';
import { PageCloseBar } from '../../components/ui/PageCloseBar';

type Mode = 'add' | 'edit' | 'remove';

const copy: Record<Mode, { title: string; subtitle: string }> = {
  add: { title: 'Add Category', subtitle: 'Create a new chart-of-accounts category' },
  edit: { title: 'Edit Category', subtitle: 'Rename a category (coming soon — delete & re-add for now)' },
  remove: { title: 'Remove Category', subtitle: 'Soft-delete an empty category' },
};

export function CategoryManagePage({ mode }: { mode: Mode }) {
  const [categories, setCategories] = useState<AccountCategory[]>([]);
  const [name, setName] = useState('');
  const [selectedId, setSelectedId] = useState<number | ''>('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.listCategories().then(setCategories).catch(() => setCategories([]));
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      if (mode === 'add') {
        await api.createCategory(name);
        setMessage('Category created.');
        setName('');
      } else if (mode === 'remove') {
        if (!selectedId) throw new Error('Select a category');
        await api.deleteCategory(Number(selectedId));
        setMessage('Category removed.');
        setSelectedId('');
      } else {
        setMessage('Edit category will be wired when you confirm rename rules.');
      }
      setCategories(await api.listCategories());
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
            <div>
              <FieldLabel>Category name</FieldLabel>
              <TextInput value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
          ) : (
            <div>
              <FieldLabel>Category</FieldLabel>
              <select
                className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : '')}
                required={mode === 'remove'}
              >
                <option value="">Select category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          {message ? <p className="text-sm text-success">{message}</p> : null}
          <div className="flex gap-2">
            <PrimaryButton type="submit">{mode === 'remove' ? 'Remove' : 'Save'}</PrimaryButton>
            <SecondaryButton type="button" onClick={() => { setName(''); setSelectedId(''); }}>Clear</SecondaryButton>
          </div>
        </form>
      </Panel>
      <PageCloseBar />
    </PageShell>
  );
}
