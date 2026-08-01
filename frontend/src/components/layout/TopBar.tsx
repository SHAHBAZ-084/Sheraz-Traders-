import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { TOP_NAV, NavItem } from '../../config/navigation';
import { voucherTypeColorClass } from '../../lib/format';

function linkMatchesPath(pathname: string, to: string) {
  return pathname === to || (to !== '/' && pathname.startsWith(`${to}/`));
}

function groupHasActive(pathname: string, items: NavItem[]) {
  for (const item of items) {
    if (item.kind === 'link' && linkMatchesPath(pathname, item.to)) return true;
    if (item.kind === 'submenu' && item.children.some((child) => linkMatchesPath(pathname, child.to))) {
      return true;
    }
  }
  return false;
}

function voucherNavLabelClass(label: string) {
  if (label.startsWith('Payment')) return voucherTypeColorClass('PAYMENT');
  if (label.startsWith('Receipt')) return voucherTypeColorClass('RECEIPT');
  if (label.startsWith('Journal')) return voucherTypeColorClass('JOURNAL');
  return '';
}

function NavSubmenu({ label, children }: { label: string; children: { label: string; to: string; description?: string }[] }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const hasActive = children.some((child) => linkMatchesPath(location.pathname, child.to));

  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`app-dropdown-item flex w-full items-center justify-between text-left ${hasActive ? 'is-active' : ''}`}
      >
        {label}
        <span className="ml-2 text-textMuted">›</span>
      </button>
      {open ? (
        <div className="app-dropdown left-full top-0">
          {children.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`app-dropdown-item ${linkMatchesPath(location.pathname, item.to) ? 'is-active' : ''}`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function NavDropdown({ label, children }: { label: string; children: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const active = groupHasActive(location.pathname, children);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`app-topnav-link ${open ? 'is-open' : ''} ${active ? 'is-active' : ''}`}
      >
        {label}
      </button>
      {open ? (
        <div className="app-dropdown left-0 top-full mt-1">
          {children.map((item) =>
            item.kind === 'submenu' ? (
              <NavSubmenu key={item.label} label={item.label} children={item.children} />
            ) : (
              <Link
                key={item.to}
                to={item.to}
                className={`app-dropdown-item ${voucherNavLabelClass(item.label)} ${linkMatchesPath(location.pathname, item.to) ? 'is-active' : ''}`}
              >
                {item.label}
              </Link>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

export function TopBar() {
  const location = useLocation();

  return (
    <header className="app-topnav sticky top-0 isolate shadow-md">
      <div className="flex min-h-12 items-center gap-1 px-4">
        <Link to="/" className="app-topnav-brand mr-2 shrink-0 pr-2 text-sm">
          Sheraz Traders
        </Link>
        <nav className="flex flex-1 flex-wrap items-center gap-1">
          {TOP_NAV.map((group) =>
            group.children ? (
              <NavDropdown key={group.label} label={group.label} children={group.children} />
            ) : (
              <Link
                key={group.label}
                to={group.to!}
                className={`app-topnav-link ${location.pathname === group.to ? 'is-active' : ''}`}
              >
                {group.label}
              </Link>
            ),
          )}
        </nav>
      </div>
    </header>
  );
}
