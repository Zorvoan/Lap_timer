import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import { AppShell } from './components/AppShell';
import { SettingsProvider } from './hooks/useSettings';
import { Spinner } from './components/ui/primitives';
import { Dashboard } from './pages/Dashboard';
import { initAccount } from './lib/cloud/account';
import { initInstall } from './lib/install';

const Circuits = lazy(() => import('./pages/Circuits').then((m) => ({ default: m.Circuits })));
const CircuitDetail = lazy(() => import('./pages/CircuitDetail').then((m) => ({ default: m.CircuitDetail })));
const CircuitEditor = lazy(() => import('./pages/CircuitEditor').then((m) => ({ default: m.CircuitEditor })));
const RecordCircuit = lazy(() => import('./pages/RecordCircuit').then((m) => ({ default: m.RecordCircuit })));
const Live = lazy(() => import('./pages/Live').then((m) => ({ default: m.Live })));
const Sessions = lazy(() => import('./pages/Sessions').then((m) => ({ default: m.Sessions })));
const SessionDetail = lazy(() => import('./pages/SessionDetail').then((m) => ({ default: m.SessionDetail })));
const LeaderboardList = lazy(() => import('./pages/Leaderboard').then((m) => ({ default: m.LeaderboardList })));
const LeaderboardTrack = lazy(() => import('./pages/Leaderboard').then((m) => ({ default: m.LeaderboardTrack })));
const LeaderboardCompare = lazy(() => import('./pages/LeaderboardCompare').then((m) => ({ default: m.LeaderboardCompare })));
const Account = lazy(() => import('./pages/Account').then((m) => ({ default: m.Account })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));

registerSW({ immediate: true });
initInstall();
initAccount();

function NotFound() {
  return <div className="p-6 text-muted">Page not found.</div>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <BrowserRouter>
        <Suspense
          fallback={
            <div className="p-6">
              <Spinner />
            </div>
          }
        >
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<Dashboard />} />
              <Route path="circuits" element={<Circuits />} />
              <Route path="circuits/new" element={<CircuitEditor />} />
              <Route path="circuits/record" element={<RecordCircuit />} />
              <Route path="circuits/:id" element={<CircuitDetail />} />
              <Route path="circuits/:id/edit" element={<CircuitEditor />} />
              <Route path="live" element={<Live />} />
              <Route path="sessions" element={<Sessions />} />
              <Route path="sessions/:id" element={<SessionDetail />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="account" element={<Account />} />
              <Route path="leaderboard" element={<LeaderboardList />} />
              <Route path="leaderboard/:id" element={<LeaderboardTrack />} />
              <Route path="leaderboard/:id/compare" element={<LeaderboardCompare />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </SettingsProvider>
  </StrictMode>,
);
