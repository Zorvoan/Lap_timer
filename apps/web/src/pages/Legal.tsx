/**
 * Privacy policy, terms of use and cookie policy. Open without signing in: the sign-up screen links
 * to them before anyone has an account.
 */
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { IconChevronRight } from '../components/ui/icons';
import { LEGAL_UPDATED, OPERATOR } from '../lib/legal';

function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="h-full overflow-y-auto bg-bg pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <article className="mx-auto max-w-2xl px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))]">
        <button type="button" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))} className="press -ml-1 flex items-center gap-1 text-sm text-muted">
          <IconChevronRight width={16} height={16} className="rotate-180" /> Back
        </button>
        <h1 className="mt-4 font-display text-[2.1rem] font-black leading-tight tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted">Last updated {LEGAL_UPDATED}</p>
        <div className="legal mt-6 space-y-4 text-[15px] leading-relaxed">{children}</div>
        <nav className="mt-10 flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-5 text-sm text-muted">
          <LegalLinks />
        </nav>
      </article>
    </div>
  );
}

/** Links to the three pages, for footers. */
export function LegalLinks() {
  return (
    <>
      <Link to="/privacy" className="underline underline-offset-4 hover:text-fg">
        Privacy
      </Link>
      <Link to="/terms" className="underline underline-offset-4 hover:text-fg">
        Terms
      </Link>
      <Link to="/cookies" className="underline underline-offset-4 hover:text-fg">
        Cookies
      </Link>
    </>
  );
}

const H = ({ children }: { children: ReactNode }) => <h2 className="pt-3 font-display text-xl font-black">{children}</h2>;
const Ul = ({ children }: { children: ReactNode }) => <ul className="list-disc space-y-1.5 pl-5">{children}</ul>;
const Mail = () => (
  <a href={`mailto:${OPERATOR.email}`} className="underline underline-offset-4">
    {OPERATOR.email}
  </a>
);

export function PrivacyPolicy() {
  return (
    <LegalPage title="Privacy policy">
      <p>
        Lap Timer times your drives with your phone&apos;s GPS and keeps leaderboards for roads. This policy explains what personal data the app uses, why, who else sees it,
        and what you can do about it.
      </p>

      <H>Who is responsible</H>
      <p>
        The controller of your personal data is {OPERATOR.name}, {OPERATOR.country}. Contact: <Mail />.
      </p>

      <H>What we collect and why</H>
      <Ul>
        <li>
          <strong>Account:</strong> your e-mail address and password (stored by our sign-in provider, never readable by us), or your Google or Apple sign-in. To give you an
          account and keep it secure.
        </li>
        <li>
          <strong>Profile:</strong> the nickname and car you choose. Shown next to your times on leaderboards.
        </li>
        <li>
          <strong>Location:</strong> while the app is open and you allow it, your phone&apos;s GPS position, speed and accuracy, to find roads near you, to time your drive and to
          show where you gain or lose time. The app does not track you in the background.
        </li>
        <li>
          <strong>Drives and roads:</strong> the roads you create and the drives you time: lap times, sector times and each lap&apos;s trace (position and speed along the road).
          Saved to your account so they are on every device you sign in on. The raw GPS fixes recorded during a drive stay on your device.
        </li>
        <li>
          <strong>Leaderboards:</strong> your best real-GPS lap on official roads and public roads is published: nickname, car, time, sector and split times, date, and that
          lap&apos;s trace, so others can compare with it and race against it.
        </li>
        <li>
          <strong>Public roads:</strong> a road you make public is shown to everyone with your nickname.
        </li>
        <li>
          <strong>Notifications:</strong> if you switch them on, a device token so we can tell you when someone beats your time.
        </li>
      </Ul>
      <p>
        We process this data to provide the service you signed up for (Art. 6(1)(b) GDPR), to keep it secure and free of forged times (our legitimate interest, Art. 6(1)(f)),
        and, for location and notifications, with your consent given in your browser or phone (Art. 6(1)(a)), which you can withdraw there at any time. We do not use analytics,
        advertising or tracking, and we do not sell your data.
      </p>

      <H>Who else receives data</H>
      <Ul>
        <li>
          <strong>Google Firebase</strong> (Google Ireland Ltd. and Google LLC): sign-in, database, hosting and notifications. Data may be processed in the USA under the EU-U.S.
          Data Privacy Framework and the European Commission&apos;s standard contractual clauses.
        </li>
        <li>
          <strong>Map tiles</strong> from CARTO and OpenStreetMap: your device asks them for the map area you look at, which tells them your IP address and that area.
        </li>
        <li>
          <strong>Route planning</strong> (OSRM, project-osrm.org) when you create a road: the points you tap.
        </li>
        <li>
          <strong>Place search</strong> (Nominatim, OpenStreetMap Foundation): what you type in the search.
        </li>
        <li>
          <strong>Elevation</strong> (Open-Meteo): the coordinates of a road, to show its climb.
        </li>
        <li>
          <strong>Navigation</strong>: when you tap “Navigate to the start”, Apple Maps or Google Maps opens with the start&apos;s position.
        </li>
        <li>Other drivers see what is on leaderboards and public roads, as described above.</li>
      </Ul>

      <H>How long we keep it</H>
      <p>
        For as long as you have an account. When you delete your account, your profile, nickname, drives, roads, public roads and leaderboard entries are deleted at once.
        Data on your device stays until you remove it (Account › Sign out and remove data from this device) or delete the account.
      </p>

      <H>Your rights</H>
      <p>
        You can access your data, have it corrected or deleted, restrict or object to its processing, and take it with you. In the app: edit your nickname and car in Account,
        export your drives in Settings, and delete everything in Account › Delete account. For anything else write to <Mail />. You can also complain to the Czech data
        protection authority, the Úřad pro ochranu osobních údajů (uoou.gov.cz).
      </p>

      <H>Age</H>
      <p>Lap Timer is for drivers. You must be at least 18 years old, or hold a driving licence where you drive, to use it.</p>

      <H>Changes</H>
      <p>If this policy changes, the new version is published here with a new date. For important changes we will tell you in the app.</p>
    </LegalPage>
  );
}

export function Terms() {
  return (
    <LegalPage title="Terms of use">
      <p>
        These terms apply to the Lap Timer app at laptimer-okwph.web.app, run by {OPERATOR.name}, {OPERATOR.country} (contact: <Mail />). By creating an account you agree to
        them.
      </p>

      <H>Drive legally, at your own risk</H>
      <Ul>
        <li>
          Official roads and public roads are ordinary public roads unless they are closed for an event. Keep to speed limits and all traffic rules. Drive flat out only on
          closed roads or tracks.
        </li>
        <li>Never handle the phone while driving. Mount it in a holder and set the drive up before you go.</li>
        <li>
          Lap Timer measures time; it does not make any road safe or legal to drive fast on. You are solely responsible for how you drive, and for any accident, damage, fine or
          other consequence.
        </li>
      </Ul>

      <H>Your account</H>
      <Ul>
        <li>You must be at least 18 years old, or hold a driving licence where you drive. One account per person.</li>
        <li>Keep your sign-in safe. You are responsible for what happens in your account.</li>
        <li>Your nickname and car must not be offensive, impersonate anyone or infringe anyone&apos;s rights.</li>
      </Ul>

      <H>Leaderboards and public roads</H>
      <Ul>
        <li>Only real drives count. Do not forge, alter or simulate times, or drive anyone else&apos;s phone.</li>
        <li>We may remove times that look implausible or forged, and suspend accounts that cheat or break these terms.</li>
        <li>
          Make a road public only if it is a public road anyone may drive. You keep the rights to what you publish and allow us to show it in the app for as long as it is
          public.
        </li>
      </Ul>

      <H>The service</H>
      <Ul>
        <li>
          Lap Timer is free and provided as it is. GPS is not always accurate, so times may be wrong, and the service may change, be interrupted or end. We will try to tell you
          ahead of bigger changes.
        </li>
        <li>
          To the extent the law allows, we are not liable for indirect damage, lost data or anything resulting from driving. Nothing in these terms limits rights you have as a
          consumer that cannot be limited.
        </li>
        <li>You can stop using Lap Timer and delete your account at any time (Account › Delete account).</li>
      </Ul>

      <H>Law and changes</H>
      <p>
        These terms are governed by Czech law. If they change, the new version is published here with a new date; for important changes we will ask you to agree again in the
        app.
      </p>
    </LegalPage>
  );
}

export function CookiePolicy() {
  return (
    <LegalPage title="Cookie policy">
      <p>Lap Timer does not use cookies for tracking, analytics or advertising, so there is nothing to accept.</p>

      <H>What the app stores on your device</H>
      <p>So that it works, the app keeps some data in your browser&apos;s storage (IndexedDB and local storage), which is strictly necessary and needs no consent:</p>
      <Ul>
        <li>Your sign-in, so you stay signed in (stored by Firebase Authentication).</li>
        <li>Your roads, drives and settings, so they work offline.</li>
        <li>The app itself and map tiles you have seen, so it starts quickly and maps open without signal.</li>
        <li>Small notes such as which tips you have seen.</li>
      </Ul>
      <p>
        You can remove it in Account › Sign out and remove data from this device, or by clearing this site&apos;s data in your browser. Map tile servers (CARTO,
        OpenStreetMap) receive your IP address when the app loads tiles; see the <Link to="/privacy" className="underline underline-offset-4">privacy policy</Link>.
      </p>
    </LegalPage>
  );
}
