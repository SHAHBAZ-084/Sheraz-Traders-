import { Outlet } from 'react-router-dom';
import { ContentHeader } from './ContentHeader';
import { MinimizedFormsTray } from './MinimizedFormsTray';
import { TopBar } from './TopBar';

export function AppShell() {
  return (
    <div className="app-shell">
      <TopBar />
      <div className="app-main">
        <ContentHeader />
        <main className="app-main-scroll">
          <Outlet />
        </main>
        <MinimizedFormsTray />
      </div>
    </div>
  );
}
