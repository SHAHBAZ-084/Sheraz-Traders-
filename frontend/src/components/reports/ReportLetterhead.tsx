import { forwardRef } from 'react';
import { BusinessLetterhead } from './BusinessLetterhead';

type ReportLetterheadProps = {
  title?: string;
  emphasis?: string;
  subtitle?: string;
  className?: string;
};

/** Centered business letterhead for on-screen reports and print preview. */
export const ReportLetterhead = forwardRef<HTMLElement, ReportLetterheadProps>(function ReportLetterhead(
  { title, emphasis, subtitle, className = '' },
  ref,
) {
  return (
    <header ref={ref} className={`report-letterhead ${className}`.trim()}>
      <BusinessLetterhead />

      {title ? (
        <div className="report-letterhead__report">
          <h2 className="report-letterhead__title">{title}</h2>
          {emphasis ? <p className="report-letterhead__emphasis">{emphasis}</p> : null}
          {subtitle ? <p className="report-letterhead__subtitle">{subtitle}</p> : null}
        </div>
      ) : null}
    </header>
  );
});
