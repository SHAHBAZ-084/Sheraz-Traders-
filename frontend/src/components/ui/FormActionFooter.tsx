import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { FinancialButton, SecondaryButton } from './PageShell';

type FormActionFooterProps = {
  /** Optional left-side content (e.g. invoice totals). */
  leading?: ReactNode;
  error?: string;
  message?: string;
  primaryLabel: string;
  savingLabel?: string;
  saving?: boolean;
  disabled?: boolean;
  onClose: () => void;
  /** Pause this form and keep its draft in the session tray. */
  onMinimize?: () => void;
  onPrimaryClick?: () => void;
  secondaryPrimaryLabel?: string;
  onSecondaryPrimaryClick?: () => void;
  primaryRef?: Ref<HTMLButtonElement>;
  primaryType?: ButtonHTMLAttributes<HTMLButtonElement>['type'];
  primaryTabIndex?: number;
  closeTabIndex?: number;
  className?: string;
};

/**
 * Shared form footer: optional leading content + right-aligned primary + Minimize + Close.
 * Used by vouchers and invoices.
 */
export function FormActionFooter({
  leading,
  error,
  message,
  primaryLabel,
  savingLabel = 'Saving…',
  saving = false,
  disabled = false,
  onClose,
  onMinimize,
  onPrimaryClick,
  secondaryPrimaryLabel,
  onSecondaryPrimaryClick,
  primaryRef,
  primaryType = 'submit',
  primaryTabIndex,
  closeTabIndex,
  className = '',
}: FormActionFooterProps) {
  return (
    <div className={`app-form-footer ${className}`.trim()}>
      {leading ? <div className="app-form-footer-leading">{leading}</div> : null}
      <div className="app-form-footer-actions">
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        {message ? <p className="text-sm text-success">{message}</p> : null}
        <FinancialButton
          ref={primaryRef}
          type={primaryType}
          tabIndex={primaryTabIndex}
          disabled={saving || disabled}
          onClick={onPrimaryClick}
          className="px-6 py-2.5"
        >
          {saving ? savingLabel : primaryLabel}
        </FinancialButton>
        {secondaryPrimaryLabel && onSecondaryPrimaryClick ? (
          <FinancialButton
            type="button"
            disabled={saving || disabled}
            onClick={onSecondaryPrimaryClick}
            className="px-6 py-2.5"
          >
            {saving ? savingLabel : secondaryPrimaryLabel}
          </FinancialButton>
        ) : null}
        {onMinimize ? (
          <SecondaryButton
            type="button"
            className="px-6 py-2.5"
            disabled={saving}
            onClick={onMinimize}
          >
            Minimize
          </SecondaryButton>
        ) : null}
        <SecondaryButton
          type="button"
          tabIndex={closeTabIndex}
          className="px-6 py-2.5"
          onClick={onClose}
        >
          Close
        </SecondaryButton>
      </div>
    </div>
  );
}
