import type { ReactNode } from 'react';
import { BILL_LETTERHEAD } from '../../config/billPrint';

function LetterheadCircleIcon({ children }: { children: ReactNode }) {
  return (
    <span className="business-letterhead__icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25">
        <circle cx="12" cy="12" r="10" />
        {children}
      </svg>
    </span>
  );
}

function EnvelopeIcon() {
  return (
    <LetterheadCircleIcon>
      <path d="M7 9.5 12 13l5-3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 9.5h10v5.5H7V9.5Z" strokeLinejoin="round" />
    </LetterheadCircleIcon>
  );
}

function PersonIcon() {
  return (
    <LetterheadCircleIcon>
      <circle cx="12" cy="9.5" r="2.25" />
      <path d="M8 16.5c.75-2 2.25-3 4-3s3.25 1 4 3" strokeLinecap="round" />
    </LetterheadCircleIcon>
  );
}

function TaglineOrnament({ flip }: { flip?: boolean }) {
  return (
    <span className="business-letterhead__ornament-side">
      {!flip ? <span className="business-letterhead__ornament-line" /> : null}
      <span className="business-letterhead__ornament-diamond">◆</span>
      {flip ? <span className="business-letterhead__ornament-line" /> : null}
    </span>
  );
}

/** Shared centered business letterhead — reports, invoices, and PDF exports. */
export function BusinessLetterhead({ className = '' }: { className?: string }) {
  const h = BILL_LETTERHEAD;

  return (
    <div className={`business-letterhead ${className}`.trim()}>
      <h1 className="business-letterhead__company">{h.companyName}</h1>

      <div className="business-letterhead__tagline-row">
        <TaglineOrnament />
        <p className="business-letterhead__tagline">{h.subtitle}</p>
        <TaglineOrnament flip />
      </div>

      <div className="business-letterhead__contacts">
        {h.email ? (
          <>
            <div className="business-letterhead__contact">
              <EnvelopeIcon />
              <div className="business-letterhead__contact-text">
                <span className="business-letterhead__contact-label">Email: {h.email}</span>
              </div>
            </div>
            <div className="business-letterhead__contact-divider" aria-hidden="true" />
          </>
        ) : null}

        {h.contacts.map((contact, index) => (
          <div key={contact.phone} className="contents">
            {index > 0 ? <div className="business-letterhead__contact-divider" aria-hidden="true" /> : null}
            <div className="business-letterhead__contact">
              <PersonIcon />
              <div className="business-letterhead__contact-text">
                <span className="business-letterhead__contact-label">{contact.name}</span>
                <span className="business-letterhead__contact-phone">{contact.phone}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="business-letterhead__bottom-rule" aria-hidden="true">
        <span className="business-letterhead__bottom-rule-line" />
        <span className="business-letterhead__bottom-rule-diamond">◆</span>
        <span className="business-letterhead__bottom-rule-line" />
      </div>
    </div>
  );
}
