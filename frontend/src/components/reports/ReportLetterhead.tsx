import { BILL_LETTERHEAD } from '../../config/billPrint';

type ReportLetterheadProps = {
  title?: string;
  subtitle?: string;
  className?: string;
};

/** Centered business letterhead for on-screen reports and print preview. */
export function ReportLetterhead({ title, subtitle, className = '' }: ReportLetterheadProps) {
  const h = BILL_LETTERHEAD;

  return (
    <header className={`report-letterhead ${className}`.trim()}>
      <h1 className="report-letterhead__company">{h.companyName}</h1>
      <p className="report-letterhead__detail">{h.subtitle}</p>
      {h.email ? <p className="report-letterhead__detail">Email: {h.email}</p> : null}
      {h.contacts.map((c) => (
        <p key={c.phone} className="report-letterhead__detail">
          {c.name}: {c.phone}
        </p>
      ))}
      {title ? (
        <>
          <div className="report-letterhead__divider" aria-hidden />
          <h2 className="report-letterhead__title">{title}</h2>
          {subtitle ? <p className="report-letterhead__subtitle">{subtitle}</p> : null}
        </>
      ) : null}
    </header>
  );
}
