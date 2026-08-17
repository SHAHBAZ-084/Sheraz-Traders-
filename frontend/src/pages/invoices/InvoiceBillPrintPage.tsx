import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { SecondaryButton } from '../../components/ui/PageShell';
import { api, type InvoiceDetail, type SystemPreferences } from '../../lib/api';
import { InvoiceBillView } from './InvoiceBillView';

export function InvoiceBillPrintPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const reference = searchParams.get('reference')?.trim() ?? '';
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [prefs, setPrefs] = useState<SystemPreferences | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const printedRef = useRef(false);

  useEffect(() => {
    if (!reference) {
      setError('Missing invoice reference.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    Promise.all([api.getInvoiceByReference(reference), api.getSystemPreferences()])
      .then(([inv, systemPrefs]) => {
        if (cancelled) return;
        setInvoice(inv);
        setPrefs(systemPrefs);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load invoice for printing');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reference]);

  useEffect(() => {
    if (!invoice || loading || printedRef.current) return;
    printedRef.current = true;
    const timer = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(timer);
  }, [invoice, loading]);

  return (
    <div className="app-page">
      <div className="app-page-body">
        <div className="mx-auto max-w-[840px] print:hidden">
          <div className="mb-4 flex flex-wrap gap-2">
            <SecondaryButton type="button" onClick={() => window.print()} disabled={!invoice}>
              Print again
            </SecondaryButton>
            <SecondaryButton type="button" onClick={() => navigate(-1)}>
              Back
            </SecondaryButton>
          </div>
          {loading ? <p className="text-sm text-textMuted">Loading bill…</p> : null}
          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </div>
        {invoice ? (
          <div className="mx-auto w-[800px] max-w-full bg-white shadow-sm print:shadow-none">
            <InvoiceBillView invoice={invoice} prefs={prefs} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
