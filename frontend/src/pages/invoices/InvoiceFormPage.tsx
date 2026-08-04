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
  const restoreId = (location.state as { minimizedFormId?: string } | null)?.minimizedFormId;
  const formKey = restoreId ? `restore-${restoreId}` : `${slug}-${location.key}`;

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
