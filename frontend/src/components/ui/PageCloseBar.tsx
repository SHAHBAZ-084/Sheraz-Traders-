import { useNavigate } from 'react-router-dom';
import { SecondaryButton } from './PageShell';

/**
 * Bottom-right Close control matching FormActionFooter / invoice form styling.
 * Navigates to the Dashboard (`/`).
 */
export function PageCloseBar({ className = '' }: { className?: string }) {
  const navigate = useNavigate();
  return (
    <div className={`mt-6 flex justify-end gap-3 border-t border-border pt-5 print:hidden ${className}`.trim()}>
      <SecondaryButton type="button" className="px-6 py-2.5" onClick={() => navigate('/')}>
        Close
      </SecondaryButton>
    </div>
  );
}
