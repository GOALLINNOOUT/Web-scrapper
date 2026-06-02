import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell.jsx';
import { Overview } from './pages/Overview.jsx';
import { Crawls } from './pages/Crawls.jsx';
import { CrawlDetail } from './pages/CrawlDetail.jsx';
import { DataExplorer } from './pages/DataExplorer.jsx';
import { Domains } from './pages/Domains.jsx';
import { Monitoring } from './pages/Monitoring.jsx';
import { Settings } from './pages/Settings.jsx';
import { ToastProvider } from './components/ToastProvider.jsx';
import { NetworkStatusBanner } from './components/NetworkStatusBanner.jsx';
import { RouteSeo } from './components/RouteSeo.jsx';
import { useLiveEvents } from './hooks/useLiveEvents.js';
import { applyTheme, getStoredTheme } from './theme.js';
import './styles.css';

const root = document.getElementById('root') as RootElement | null;

applyTheme(getStoredTheme());

if (!root) {
  throw new Error('Root element not found');
}

function RootApp() {
  useLiveEvents();

  return (
    <BrowserRouter>
      <RouteSeo />
      <ToastProvider />
      <NetworkStatusBanner />
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Overview />} />
          <Route path="/crawls" element={<Crawls />} />
          <Route path="/crawls/:id" element={<CrawlDetail />} />
          <Route path="/domains" element={<Domains />} />
          <Route path="/data" element={<DataExplorer />} />
          <Route path="/monitoring" element={<Monitoring />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

(root.__webIntelRoot ||= createRoot(root)).render(
  <React.StrictMode>
    <RootApp />
  </React.StrictMode>
);

type RootElement = HTMLElement & {
  __webIntelRoot?: ReturnType<typeof createRoot>;
};
