import { FormEvent, useRef, useState } from 'react';
import { FieldLabel, PrimaryButton, SecondaryButton, TextInput } from '../ui/PageShell';
import { PhoneInput } from '../ui/PhoneInput';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { api, type Party } from '../../lib/api';

export type QuickAddPartyKind = 'customer' | 'supplier';

export function QuickAddPartyModal({
  kind,
  isOpen,
  onClose,
  onCreated,
}: {
  kind: QuickAddPartyKind;
  isOpen: boolean;
  onClose: () => void;
  onCreated: (party: Party) => void;
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, { disabled: !isOpen });

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const isCustomer = kind === 'customer';
  const title = isCustomer ? 'Quick Add Customer' : 'Quick Add Supplier';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setSaving(true);
    setError('');

    try {
      const payload = {
        name: name.trim(),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(address.trim() ? { address: address.trim() } : {}),
      };

      const party = isCustomer
        ? await api.createSaleParty(payload)
        : await api.createPurchaseParty(payload);

      setName('');
      setPhone('');
      setAddress('');
      onCreated(party);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create party');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      ref={modalRef}
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
    >
      <div className="w-full max-w-md rounded border border-border bg-surface2 p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-textPrimary">{title}</h3>
        <p className="mt-1 text-xs text-textSecondary">
          Creates party profile and automatically maps a linked ledger account.
        </p>

        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <FieldLabel>Party / Business Name *</FieldLabel>
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ali Traders"
              required
              autoFocus
            />
          </div>

          <div>
            <FieldLabel>Phone Number</FieldLabel>
            <PhoneInput
              value={phone}
              onChange={setPhone}
              placeholder="03001234567"
            />
          </div>

          <div>
            <FieldLabel>Address</FieldLabel>
            <TextInput
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="City / Market location"
            />
          </div>

          <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
            <SecondaryButton type="button" onClick={onClose} disabled={saving}>
              Cancel
            </SecondaryButton>
            <PrimaryButton type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save Party & Account'}
            </PrimaryButton>
          </div>
        </form>
      </div>
    </div>
  );
}
