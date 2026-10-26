import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './index.css';
import { AppShell } from './components/AppShell';
import { SettingsProvider } from './hooks/useSettings';
import { Spinner } from './components/ui/primitives';
import { initAccount } from './lib/cloud/account';
import { initInstall } from './lib/install';
import { initUpdates } from './lib/update';

const Tracks = lazy(() => import('./pages/Tracks').then((m) => ({ default: m.Tracks })));
const Track = lazy(() => import('./pages/Track').then((m) => ({ default: m.Track })));
const TrackRedirect = lazy(() => import('./pages/Track').then((m) => ({ default: m.TrackRedirect })));
const Me = lazy(() => import('./pages/Me').then((m) => ({ default: m.Me })));
const Help = lazy(() => import('./pages/Help').then((m) => ({ default: m.Help })));
const CircuitEditor = lazy(() => import('./pages/CircuitEditor').then((m) => ({ default: m.CircuitEditor })));
const RecordCircuit = lazy(() => import('./pages/RecordCircuit').then((m) => ({ default: m.RecordCircuit })));
const Live = lazy(() => import('./pages/Live').then((m) => ({ default: m.Live })));
const DriveResult = lazy(() => import('./pages/DriveResult').then((m) => ({ default: m.DriveResult })));
const Sessions = lazy(() => import('./pages/Sessions').then((m) => ({ default: m.Sessions })));
const SessionDetail = lazy(() => import('./pages/SessionDetail').then((m) => ({ default: m.SessionDetail })));
const LeaderboardCompare = lazy(() => import('./pages/LeaderboardCompare').then((m) => ({ default: m.LeaderboardCompare })));
const Account = lazy(() => import('./pages/Account').then((m) => ({ default: m.Account })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const PrivacyPolicy = lazy(() => import('./pages/Legal').then((m) => ({ default: m.PrivacyPolicy })));
const Terms = lazy(() => import('./pages/Legal').then((m) => ({ default: m.Terms })));
const CookiePolicy = lazy(() => import('./pages/Legal').then((m) => ({ default: m.CookiePolicy })));

initUpdates();
initInstall();
initAccount();

// Safari on iPhone ignores `user-scalable=no`; its pinch gesture events can still be stopped.
// Maps handle their own pinch, so a pinch on a map is left alone.
document.addEventListener('gesturestart', (e) => {
  if (!(e.target instanceof Element && e.target.closest('.leaflet-container'))) e.preventDefault();
});

function NotFound() {
  return <div className="p-6 text-muted">Page not found.</div>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <BrowserRouter>
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center p-6">
              <Spinner />
            </div>
          }
        >
          <Routes>
            {/* Readable before signing in: the sign-up screen links to them. */}
            <Route path="privacy" element={<PrivacyPolicy />} />
            <Route path="terms" element={<Terms />} />
            <Route path="cookies" element={<CookiePolicy />} />
            <Route element={<AppShell />}>
              <Route index element={<Tracks />} />
              <Route path="tracks/:id" element={<Track />} />
              <Route path="circuits/new" element={<CircuitEditor />} />
              <Route path="circuits/record" element={<RecordCircuit />} />
              <Route path="circuits/:id/edit" element={<CircuitEditor />} />
              <Route path="live" element={<Live />} />
              <Route path="result/:id" element={<DriveResult />} />
              <Route path="me" element={<Me />} />
              <Route path="help" element={<Help />} />
              <Route path="sessions" element={<Sessions />} />
              <Route path="sessions/:id" element={<SessionDetail />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="account" element={<Account />} />
              <Route path="leaderboard/:id/compare" element={<LeaderboardCompare />} />
              {/* Older addresses, kept working for bookmarks and links already shared. */}
              <Route path="circuits" element={<Navigate to="/" replace />} />
              <Route path="circuits/:id" element={<TrackRedirect />} />
              <Route path="leaderboard" element={<Navigate to="/" replace />} />
              <Route path="leaderboard/:id" element={<TrackRedirect tab="leaderboard" />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </SettingsProvider>
  </StrictMode>,
);
