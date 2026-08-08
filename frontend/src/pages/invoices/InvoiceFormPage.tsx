import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { INVOICE_TYPE_LABELS } from '../../config/navigation';
import { PageShell, Panel, SecondaryButton } from '../../components/ui/PageShell';
import { KachiMaalInvoicePage } from './KachiMaalInvoicePage';
import { PurchaseInvoicePage } from './PurchaseInvoicePage';
import { SaleInvoicePage } from './SaleInvoicePage';

const ROUTE_TO_TYPE: Record<string, string> = {
  'kachi-maal': 'KACHI_MAAL',
  'sale-invoice': 'SALE_INVOICE',
  'purchase-invoice': 'PURCHASE_INVOICE',
};

export function InvoiceFormPage({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  // Captured ONCE at first render. useMinimizableForm clears location.state
  // right after it consumes the restored draft (see useMinimizableForm.ts).
  // If formKey were derived from location.state directly, that clear would
  // change formKey on the next render and force React to unmount/remount
  // the form — by which point the draft has already been removed from the
  // store, so the fresh mount comes up empty. Freezing the id here keeps
  // the remount key stable for the lifetime of this page visit.
  const [stableRestoreId] = useState(
    () => (location.state as { minimizedFormId?: string } | null)?.minimizedFormId,
  );
  const formKey = stableRestoreId ? `restore-${stableRestoreId}` : `${slug}-${location.key}`;

  if (slug === 'kachi-maal') {
    return <KachiMaalInvoicePage key={formKey} />;
  }
  if (slug === 'sale-invoice') {
    return <SaleInvoicePage key={formKey} />;
  }
  if (slug === 'purchase-invoice') {
    return <PurchaseInvoicePage key={formKey} />;
  }

  const typeKey = ROUTE_TO_TYPE[slug];
  const title = INVOICE_TYPE_LABELS[typeKey] ?? 'Invoice';

  return (
    <PageShell centerTitle invoiceTitleBand title={title}>
      <Panel>
        <p className="text-sm leading-6 text-textSecondary">
          Unknown invoice form.
        </p>
        <div className="mt-6 flex gap-3 border-t border-border pt-5">
          <SecondaryButton type="button" className="px-6 py-2.5" onClick={() => navigate('/')}>
            Close
          </SecondaryButton>
        </div>
      </Panel>
    </PageShell>
  );
}
