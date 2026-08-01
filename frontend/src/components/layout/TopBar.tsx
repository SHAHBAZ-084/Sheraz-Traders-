import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { TOP_NAV, NavItem } from '../../config/navigation';
import { useAuth } from '../../contexts/AuthContext';
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

function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const label = user?.displayName || user?.username || 'User';
  const active = location.pathname === '/user';

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

  async function handleLogout() {
    setOpen(false);
    await logout();
    navigate('/login', { replace: true });
  }

  if (!user) return null;

  return (
    <div ref={ref} className="app-topnav-user relative ml-auto shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`app-topnav-link ${open ? 'is-open' : ''} ${active ? 'is-active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label}
      </button>
      {open ? (
        <div className="app-dropdown right-0 left-auto top-full mt-1" role="menu">
          <Link to="/user" className="app-dropdown-item" role="menuitem" onClick={() => setOpen(false)}>
            User Information
          </Link>
          <button type="button" className="app-dropdown-item w-full text-left" role="menuitem" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function TopBar() {
  const location = useLocation();
  const { user } = useAuth();
  const isUserRole = user?.role === 'USER';

  return (
    <header className="app-topnav sticky top-0 isolate shadow-md">
      <div className="app-topnav-inner">
        <Link to="/" className="app-topnav-brand shrink-0" aria-label="Sheraz Traders — Dashboard">
          <img src="/sheraz-traders-logo.png" alt="Sheraz Traders" className="app-topnav-logo" />
        </Link>
        <nav className="app-topnav-nav">
          {TOP_NAV.map((entry) => {
            if (isUserRole && entry.kind === 'dropdown' && entry.label === 'Reports') {
              return null;
            }
            if (isUserRole && entry.kind === 'link' && entry.id === 'ledger') {
              return null;
            }
            if (entry.kind === 'quick') {
              const Icon = entry.icon === 'sale' ? ArrowUpFromLine : ArrowDownToLine;
              return (
                <Link
                  key={entry.to}
                  to={entry.to}
                  className={`app-topnav-quick-link ${location.pathname === entry.to ? 'is-active' : ''}`}
                  title={entry.label === 'Sale' ? 'Sale Invoice' : 'Purchase Invoice'}
                  aria-label={entry.label === 'Sale' ? 'Sale Invoice' : 'Purchase Invoice'}
                >
                  <Icon className="h-4 w-4" strokeWidth={2} aria-hidden />
                  <span>{entry.label}</span>
                </Link>
              );
            }
            if (entry.kind === 'link') {
              return (
                <Link
                  key={entry.id}
                  to={entry.to}
                  className={`app-topnav-link ${linkMatchesPath(location.pathname, entry.to) ? 'is-active' : ''}`}
                >
                  {entry.label}
                </Link>
              );
            }
            return (
              <NavDropdown
                key={entry.label}
                label={entry.label}
                children={
                  isUserRole && entry.label === 'System'
                    ? entry.children.filter(
                        (item) => !(item.kind === 'link' && item.to === '/system/approvals'),
                      )
                    : entry.children
                }
              />
            );
          })}
        </nav>
        <UserMenu />
      </div>
    </header>
  );
}
