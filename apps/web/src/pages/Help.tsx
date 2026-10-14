import { PageHeader } from '../components/AppShell';
import { ScreenWakeLock } from '../lib/wakeLock';

/** How timing works and how to get good results, in plain words. */
export function Help() {
  return (
    <div className="pb-10">
      <PageHeader title="How it works" back={{ to: '/me', label: 'Me' }} />
      <div className="mx-auto max-w-2xl space-y-6 p-4 text-sm leading-relaxed md:p-6">
        <section>
          <h2 className="mb-2 text-base font-bold">Timing</h2>
          <p className="text-muted">
            Pick a track and press Drive. When GPS is accurate enough, Start unlocks. Timing begins by itself when you cross the start line and stops at the finish line.
            While you drive, the big number is the gap to your best lap: green with a minus sign when you are faster, red with a plus sign when slower.
          </p>
        </section>
        <section>
          <h2 className="mb-2 text-base font-bold">Getting accurate times</h2>
          <ul className="list-disc space-y-1.5 pl-5 text-muted">
            <li>Put the phone in a holder with a clear view of the sky, not in a pocket.</li>
            <li>Keep the screen on and the app open for the whole drive. A phone that turns the screen off may stop sending its position.</li>
            <li>Give GPS a minute outdoors before starting. The Start button waits for it.</li>
            <li>Phone GPS is good to about a tenth of a second, not race-transponder precision.</li>
          </ul>
          <p className="mt-2 text-xs text-muted">Keeping the screen on: {ScreenWakeLock.supported ? 'supported in this browser' : 'not supported in this browser, so turn off auto-lock'}.</p>
        </section>
        <section>
          <h2 className="mb-2 text-base font-bold">Leaderboards</h2>
          <p className="text-muted">
            Official tracks have a leaderboard. Sign in with a nickname and car, and your best lap with real GPS is published automatically. Tap any driver to compare their lap with yours.
          </p>
        </section>
        <section>
          <h2 className="mb-2 text-base font-bold">Drive legally</h2>
          <p className="text-muted">Public roads are not race tracks. Only drive within the law, or on closed courses.</p>
        </section>
      </div>
    </div>
  );
}
