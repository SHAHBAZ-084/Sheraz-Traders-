import { useNavigate } from 'react-router-dom';
import { Minimize2, X } from 'lucide-react';
import {
  MINIMIZED_FORM_ROUTES,
  MINIMIZED_FORM_TITLES,
  useMinimizedFormsStore,
  type MinimizedFormKind,
} from '../../stores/minimizedFormsStore';

function kindAccent(kind: MinimizedFormKind) {
  if (kind === 'payment') return 'minimized-tray-chip--payment';
  if (kind === 'receipt') return 'minimized-tray-chip--receipt';
  if (kind === 'journal') return 'minimized-tray-chip--journal';
  return 'minimized-tray-chip--invoice';
}

export function MinimizedFormsTray() {
  const navigate = useNavigate();
  const forms = useMinimizedFormsStore((s) => s.forms);
  const discard = useMinimizedFormsStore((s) => s.discard);

  if (forms.length === 0) return null;

  return (
    <div className="minimized-tray" role="status" aria-label="Minimized forms">
      <p className="minimized-tray-heading">Minimized drafts — click to restore</p>
      <div className="minimized-tray-inner">
        {forms.map((form) => (
          <div key={form.id} className={`minimized-tray-chip ${kindAccent(form.kind)}`.trim()}>
            <button
              type="button"
              className="minimized-tray-chip-main"
              title={`Restore ${form.label}`}
              onClick={() => {
                const base = MINIMIZED_FORM_ROUTES[form.kind];
                navigate(`${base}?minimizedFormId=${encodeURIComponent(form.id)}`);
              }}
            >
              <Minimize2 className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
              <span className="minimized-tray-chip-label">
                <span className="minimized-tray-chip-kind">{MINIMIZED_FORM_TITLES[form.kind]}</span>
                <span className="minimized-tray-chip-title">{form.label}</span>
              </span>
            </button>
            <button
              type="button"
              className="minimized-tray-chip-discard"
              aria-label={`Discard ${form.label}`}
              title="Discard"
              onClick={(e) => {
                e.stopPropagation();
                discard(form.id);
              }}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
