import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronDown, ChevronRight, LayoutDashboard, Users } from 'lucide-react';
import { SIDEBAR_NAV, type NavItem } from '../../config/navigation';
import type { LucideIcon } from 'lucide-react';

function linkMatchesPath(pathname: string, to: string) {
  return pathname === to || (to !== '/' && pathname.startsWith(`${to}/`));
}

function sectionHasActive(pathname: string, items: NavItem[]) {
  for (const item of items) {
    if (item.kind === 'link' && linkMatchesPath(pathname, item.to)) return true;
    if (item.kind === 'submenu' && item.children.some((child) => linkMatchesPath(pathname, child.to))) {
      return true;
    }
  }
  return false;
}

function SidebarLink({ to, label, nested = false }: { to: string; label: string; nested?: boolean }) {
  const location = useLocation();
  const active = linkMatchesPath(location.pathname, to);

  return (
    <Link
      to={to}
      className={`app-sidebar-link ${nested ? 'app-sidebar-link-nested' : ''} ${active ? 'is-active' : ''}`}
    >
      {label}
    </Link>
  );
}

function SidebarSubmenu({ label, children }: { label: string; children: { label: string; to: string }[] }) {
  const location = useLocation();
  const hasActive = children.some((child) => linkMatchesPath(location.pathname, child.to));
  const [open, setOpen] = useState(hasActive);

  useEffect(() => {
    if (hasActive) setOpen(true);
  }, [hasActive]);

  return (
    <div className="app-sidebar-submenu">
      <button
        type="button"
        className={`app-sidebar-sublabel ${hasActive ? 'is-active' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span>{label}</span>
        {open ? <ChevronDown className="h-3.5 w-3.5 opacity-70" /> : <ChevronRight className="h-3.5 w-3.5 opacity-70" />}
      </button>
      {open ? (
        <div className="app-sidebar-submenu-items">
          {children.map((child) => (
            <SidebarLink key={child.to} to={child.to} label={child.label} nested />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SidebarSectionBlock({
  label,
  icon: Icon,
  items,
}: {
  label: string;
  icon: LucideIcon;
  items: NavItem[];
}) {
  const location = useLocation();
  const hasActive = sectionHasActive(location.pathname, items);
  const [open, setOpen] = useState(hasActive);

  useEffect(() => {
    if (hasActive) setOpen(true);
  }, [hasActive]);

  return (
    <div className="app-sidebar-section">
      <button
        type="button"
        className={`app-sidebar-section-toggle ${hasActive ? 'is-active' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <Icon className="app-sidebar-nav-icon shrink-0" strokeWidth={2} />
        <span className="flex-1 text-left">{label}</span>
        {open ? <ChevronDown className="h-4 w-4 opacity-70" /> : <ChevronRight className="h-4 w-4 opacity-70" />}
      </button>
      {open ? (
        <div className="app-sidebar-section-items">
          {items.map((item) =>
            item.kind === 'submenu' ? (
              <SidebarSubmenu key={item.label} label={item.label} children={item.children} />
            ) : (
              <SidebarLink key={item.to} to={item.to} label={item.label} nested />
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

export function Sidebar() {
  const location = useLocation();
  const dashboardActive = location.pathname === '/';

  return (
    <aside className="app-sidebar">
      <div className="app-sidebar-brand">
        <Link to="/" className="app-sidebar-brand-link" aria-label="Sheraz Traders — Dashboard">
          <img src="/sheraz-traders-logo.png" alt="Sheraz Traders" className="app-sidebar-brand-logo" />
        </Link>
        <p className="app-sidebar-brand-sub">Grain Market POS</p>
      </div>

      <nav className="app-sidebar-nav">
        <Link to="/" className={`app-sidebar-link app-sidebar-link-top ${dashboardActive ? 'is-active' : ''}`}>
          <LayoutDashboard className="app-sidebar-nav-icon shrink-0" strokeWidth={2} />
          <span>Dashboard</span>
        </Link>

        {SIDEBAR_NAV.map((section) => (
          <SidebarSectionBlock key={section.id} label={section.label} icon={section.icon} items={section.items} />
        ))}
      </nav>

      <div className="app-sidebar-footer">
        <Link
          to="/user"
          className={`app-sidebar-link app-sidebar-link-top ${location.pathname === '/user' ? 'is-active' : ''}`}
        >
          <Users className="app-sidebar-nav-icon shrink-0" strokeWidth={2} />
          <span>User</span>
        </Link>
      </div>
    </aside>
  );
}
