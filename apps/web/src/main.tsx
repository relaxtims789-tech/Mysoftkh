import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './styles/base.css';
import { AuthProvider } from './lib/auth';
import { Loading, UiProvider } from './components/ui';
import { EmployeeApp } from './employee/EmployeeApp';
import { detectMiniApp } from './lib/telegram';

detectMiniApp();

// The admin dashboard is a separate chunk so the phone app stays small.
const AdminApp = lazy(() => import('./admin/AdminApp'));
// The public website (landing, prices, sign-up) is its own chunk too.
const Site = lazy(() => import('./site/Site'));
// The admin Mini App (admin Telegram bot, /manage).
const ManageApp = lazy(() => import('./manage/ManageApp'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <UiProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/scan/:token" element={<EmployeeApp scanEntry />} />
            <Route path="/app/*" element={<EmployeeApp />} />
            <Route
              path="/manage/*"
              element={
                <Suspense fallback={<Loading />}>
                  <ManageApp />
                </Suspense>
              }
            />
            <Route
              path="/admin/*"
              element={
                <Suspense fallback={<Loading />}>
                  <AdminApp />
                </Suspense>
              }
            />
            <Route
              path="/*"
              element={
                <Suspense fallback={<Loading />}>
                  <Site />
                </Suspense>
              }
            />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </UiProvider>
  </StrictMode>,
);

// Android browsers offer "Install app" once, early; keep the event so the app can show its own Install button.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__qraInstallPrompt = e;
  window.dispatchEvent(new Event('qra-install-ready'));
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}
