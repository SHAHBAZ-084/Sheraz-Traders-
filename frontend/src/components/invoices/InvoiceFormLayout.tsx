import { useRef, type ButtonHTMLAttributes, type ReactNode, type RefObject } from 'react';
import { FieldLabel, FinancialButton, PageShell, Panel } from '../ui/PageShell';
import { FormActionFooter } from '../ui/FormActionFooter';
import { formatLedgerAmount } from '../../lib/format';
import { useFocusTrap } from '../../hooks/useFocusTrap';

/** Centered title band + white invoice/voucher form panel (app theme). */
export function FormPageShell({
  title,
  titleNode,
  titleRef,
  children,
  panelClassName = '',
}: {
  title?: string;
  titleNode?: ReactNode;
  titleRef?: RefObject<HTMLHeadingElement | null>;
  children: ReactNode;
  panelClassName?: string;
}) {
  const trapRef = useRef<HTMLDivElement>(null);
  // Page forms: trap Tab inside the panel; skip auto-focus if user already clicked a field.
  useFocusTrap(trapRef, { containTab: true });

  return (
    <PageShell
      centerTitle
      invoiceTitleBand
      titleRef={titleRef}
      title={titleNode ?? title}
    >
      <div
        ref={trapRef}
        data-focus-trap="form"
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' && title.trim() ? title : 'Form'}
      >
        <Panel
          className={`inv-form-panel mx-auto w-full overflow-visible bg-white ${panelClassName}`.trim()}
        >
          {children}
        </Panel>
      </div>
    </PageShell>
  );
}

/** Section block with accent tick header (invoice forms). */
export function InvoiceFormSection({
  label,
  children,
  className = '',
}: {
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`inv-section ${className}`.trim()}>
      {label ? <h2 className="inv-section-title">{label}</h2> : null}
      <div className={label ? 'inv-section-body' : undefined}>{children}</div>
    </section>
  );
}

/** Single field cell — fixed label track + control track. */
export function InvoiceField({
  children,
  className = '',
  wide = false,
}: {
  children: ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <div className={`app-field${wide ? ' inv-field--wide' : ''} ${className}`.trim()}>
      {children}
    </div>
  );
}

/** Logical cluster of fields with breathing room / optional divider from siblings. */
export function InvoiceFieldGroup({
  children,
  className = '',
  label,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <div className={`inv-field-group ${className}`.trim()}>
      {label ? <p className="inv-field-group-label">{label}</p> : null}
      {children}
    </div>
  );
}

/** Stacked field groups with vertical rhythm. */
export function InvoiceFieldStack({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`inv-field-stack ${className}`.trim()}>{children}</div>;
}

type FieldRowCols = 2 | 3 | 4 | 5 | 6;

/** Responsive field row — wraps; numeric cells keep an 8-digit min-width. */
export function InvoiceFieldRow({
  children,
  className = '',
  cols = 4,
}: {
  children: ReactNode;
  className?: string;
  cols?: FieldRowCols;
}) {
  return (
    <div className={`inv-field-row inv-field-row--${cols} ${className}`.trim()}>
      {children}
    </div>
  );
}

/** Header meta row (Date / Invoice # / Bill / …). */
export function InvoiceHeaderRow({ children }: { children: ReactNode }) {
  return <div className="inv-field-row inv-field-row--header">{children}</div>;
}

/** Grey-filled calculated / read-only amount field. */
export function InvoiceReadOnlyField({
  label,
  value,
  displayText,
  className = '',
  format = 'amount',
}: {
  label: string;
  value: number;
  /** When set, shown instead of formatting `value` (value still used for state/calc). */
  displayText?: string;
  className?: string;
  format?: 'amount' | 'number';
}) {
  const display =
    displayText ??
    (format === 'number'
      ? value.toLocaleString('en-PK', { maximumFractionDigits: 2 })
      : formatLedgerAmount(value));
  return (
    <InvoiceField className={className}>
      <FieldLabel>{label}</FieldLabel>
      <div className="app-input-static app-input-static--calc tabular-nums">{display}</div>
    </InvoiceField>
  );
}

/** Checkbox control aligned to the input baseline. */
export function InvoiceToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <InvoiceField className="inv-field--toggle">
      <span className="app-field-label" aria-hidden="true">
        &nbsp;
      </span>
      <label className="app-input-static app-input-static--toggle cursor-pointer gap-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 shrink-0 rounded border-border text-financial"
        />
        <span className="truncate text-sm font-medium text-textPrimary">{label}</span>
      </label>
    </InvoiceField>
  );
}

/** Full-width right-aligned primary row action (Add to grid). */
export function InvoiceAddRowAction({
  children = 'Add to grid',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <div className="inv-add-row">
      <FinancialButton type="button" className="px-6" {...props}>
        {children}
      </FinancialButton>
    </div>
  );
}

/** Settlement footer: total + messages + Save / Minimize / Close (shared FormActionFooter). */
export function InvoiceFormFooter({
  totalLabel,
  totalValue,
  error,
  message,
  saving,
  onClose,
  onMinimize,
  primaryLabel = 'Save invoice',
}: {
  totalLabel: string;
  totalValue: number;
  error?: string;
  message?: string;
  saving?: boolean;
  onClose: () => void;
  onMinimize?: () => void;
  primaryLabel?: string;
}) {
  return (
    <FormActionFooter
      leading={
        <div className="app-form-footer-total">
          <span className="app-form-footer-total-label">{totalLabel}</span>
          <span className="app-form-footer-total-value tabular-nums">
            {formatLedgerAmount(totalValue)}
          </span>
        </div>
      }
      error={error}
      message={message}
      primaryLabel={primaryLabel}
      saving={saving}
      onClose={onClose}
      onMinimize={onMinimize}
    />
  );
}
