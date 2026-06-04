import { Suspense, lazy, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminProvider } from './context/AdminContext.jsx';
import { Header } from './components/layout/Header.jsx';
import { Sidebar } from './components/layout/Sidebar.jsx';
import { LoadingSpinner } from './components/ui/LoadingSpinner.jsx';

const Overview = lazy(() => import('./pages/Overview.jsx').then((module) => ({ default: module.Overview })));
const Infrastructure = lazy(() => import('./pages/Infrastructure.jsx').then((module) => ({ default: module.Infrastructure })));
const Crawling = lazy(() => import('./pages/Crawling.jsx').then((module) => ({ default: module.Crawling })));
const Failures = lazy(() => import('./pages/Failures.jsx').then((module) => ({ default: module.Failures })));
const Capacity = lazy(() => import('./pages/Capacity.jsx').then((module) => ({ default: module.Capacity })));

export function AdminApp() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <AdminProvider>
      <div className={`admin-ops ${sidebarCollapsed ? 'admin-sidebar-collapsed' : ''}`}>
        <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((value) => !value)} />
        <div className="admin-main">
          <Header />
          <main className="admin-content">
            <Suspense fallback={<LoadingSpinner />}>
              <Routes>
                <Route index element={<Overview />} />
                <Route path="infrastructure" element={<Infrastructure />} />
                <Route path="crawling" element={<Crawling />} />
                <Route path="failures" element={<Failures />} />
                <Route path="capacity" element={<Capacity />} />
                <Route path="*" element={<Navigate to="/admin" replace />} />
              </Routes>
            </Suspense>
          </main>
        </div>
      </div>
    </AdminProvider>
  );
}
