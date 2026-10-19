import { useRef, useState } from 'react';
import { PageHeader } from '../components/AppShell';
import { Button, ConfirmButton, Field, Input, Notice, Panel, Select, Toggle, buttonClass } from '../components/ui/primitives';
import { IconDownload, IconUpload } from '../components/ui/icons';
import { useSettings } from '../hooks/useSettings';
import { exportAll, importFile } from '../lib/dataTransfer';
import { ImportError, downloadText, parseExport } from '../lib/exportImport';
import { clearAllData } from '../lib/repo';
import { resetSync, syncNow } from '../lib/sync';
import { config } from '../lib/config';
import { simulatorAllowed } from '../lib/developer';
import { cloudEnabled } from '../lib/cloud/account';
import { InstallCard } from '../components/InstallCard';
import { useAccount } from '../hooks/useData';
import { SyncLine } from './Account';
import { Link } from 'react-router-dom';

export function SettingsPage() {
  const acc = useAccount();
  const { settings, update } = useSettings();
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function doExport(includeSamples: boolean) {
    const text = await exportAll(includeSamples);
    downloadText(`laptimer-export-${new Date().toISOString().slice(0, 10)}.json`, text, 'application/json');
  }

  async function doImport(file: File) {
    setMessage(null);
    if (file.size > 200 * 1024 * 1024) return setMessage({ tone: 'error', text: 'File is too large (max 200 MB).' });
    try {
      const parsed = parseExport(await file.text());
      const r = await importFile(parsed);
      setMessage({
        tone: 'info',
        text: `Imported ${r.circuits.added} new and ${r.circuits.updated} updated circuits, ${r.sessions.added} new and ${r.sessions.updated} updated sessions. ${r.circuits.skipped + r.sessions.skipped} items were already up to date.`,
      });
    } catch (e) {
      setMessage({ tone: 'error', text: e instanceof ImportError ? e.message : 'Import failed.' });
    }
  }

  async function doSync() {
    setSyncing(true);
    setMessage(null);
    try {
      const r = await syncNow(settings.syncUrl || config.syncUrl);
      setMessage({ tone: 'info', text: `Sync complete: ${r.pushed} sent, ${r.pulled} received, ${r.deleted} deleted${r.superseded ? `, ${r.superseded} local edits superseded by newer server versions` : ''}.` });
    } catch (e) {
      setMessage({ tone: 'error', text: e instanceof Error ? e.message : 'Sync failed.' });
    } finally {
      setSyncing(false);
    }
  }

  async function wipe() {
    await clearAllData();
    window.location.href = '/';
  }

  return (
    <div className="pb-10">
      <PageHeader title="Settings" />
      <div className="mx-auto grid max-w-5xl gap-4 p-4 md:grid-cols-2 md:p-6">
        {cloudEnabled && (
          <div className="md:col-span-2">
            <AccountSummary />
          </div>
        )}
        <div className="empty:hidden md:col-span-2">
          <InstallCard />
        </div>
        {message && (
          <div className="md:col-span-2">
            <Notice tone={message.tone}>{message.text}</Notice>
          </div>
        )}
        <Panel title="Units & display">
          <div className="space-y-4">
            <Field label="Speed">
              <Select value={settings.speedUnit} onChange={(e) => void update({ speedUnit: e.target.value as 'kmh' | 'mph' })}>
                <option value="kmh">km/h</option>
                <option value="mph">mph</option>
              </Select>
            </Field>
            <Field label="Distance">
              <Select value={settings.distanceUnit} onChange={(e) => void update({ distanceUnit: e.target.value as 'km' | 'mi' })}>
                <option value="km">Kilometres</option>
                <option value="mi">Miles</option>
              </Select>
            </Field>
            <Field label="Theme">
              <Select value={settings.theme} onChange={(e) => void update({ theme: e.target.value as 'dark' | 'light' })}>
                <option value="dark">Dark</option>
                <option value="light">Light (bright sunlight)</option>
              </Select>
            </Field>
            <Field label="Map style">
              <Select value={settings.mapStyle} onChange={(e) => void update({ mapStyle: e.target.value as 'dark' | 'standard' })}>
                <option value="dark">Dark</option>
                <option value="standard">Light</option>
              </Select>
            </Field>
          </div>
        </Panel>

        <Panel title="Timing & GPS">
          <div className="space-y-4">
            <Field label={`Minimum GPS quality: ${settings.gpsMaxAccuracyM} m`} hint="Fixes with a worse accuracy radius are recorded but ignored for timing and delta.">
              <input type="range" min={5} max={50} value={settings.gpsMaxAccuracyM} onChange={(e) => void update({ gpsMaxAccuracyM: Number(e.target.value) })} className="w-full accent-[rgb(var(--c-accent))]" />
            </Field>
            <Field label="Minimum lap time (seconds)" hint="Crossings sooner than this after the lap start are ignored.">
              <Input type="number" min={5} max={3600} value={settings.minLapSeconds} onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v >= 5 && v <= 3600) void update({ minLapSeconds: v });
              }} />
            </Field>
            <Field label="Default reference lap">
              <Select value={settings.referenceMode} onChange={(e) => void update({ referenceMode: e.target.value as typeof settings.referenceMode })}>
                <option value="personal_best">Personal best on the circuit</option>
                <option value="session_best">Best lap of the current session</option>
                <option value="none">None</option>
              </Select>
            </Field>
            {simulatorAllowed(acc.user?.uid) && (
              <Toggle checked={settings.includeSimulatedInBests} onChange={(v) => void update({ includeSimulatedInBests: v })} label="Count simulated laps as personal bests" hint="Off: only real GPS laps are used." />
            )}
          </div>
        </Panel>

        <Panel title="During a session">
          <Toggle checked={settings.audioLapBeep} onChange={(v) => void update({ audioLapBeep: v })} label="Lap beep" hint="High tone when faster than the reference." />
          <Toggle checked={settings.voiceAnnouncements} onChange={(v) => void update({ voiceAnnouncements: v })} label="Announce lap times" hint="Spoken lap time and delta." />
          <Toggle checked={settings.keepScreenOn} onChange={(v) => void update({ keepScreenOn: v })} label="Keep screen on" hint="Uses the Screen Wake Lock API where available." />
          <Toggle
            checked={settings.autoStopSprint}
            onChange={(v) => void update({ autoStopSprint: v })}
            label="Finish sprints automatically"
            hint="A sprint session stops and saves itself after the finish line. Off: keep timing for more runs."
          />
        </Panel>

        <Panel title="Privacy">
          <Toggle
            checked={settings.storeRawSamples}
            onChange={(v) => void update({ storeRawSamples: v })}
            label="Keep raw GPS fixes after a session"
            hint="Off: only lap traces are kept once a session is saved. Raw fixes are always stored while recording so a session can be recovered."
          />
          <p className="mt-2 text-sm text-muted">
            All data is stored only in this browser unless you enable sync. Location data is never written to logs or sent to analytics. Map tiles, routing and place search
            are requested from the configured providers.
          </p>
          <div className="mt-4">
            <ConfirmButton onConfirm={wipe} confirmLabel="Tap again: delete everything (cannot be undone)">
              Delete all data on this device
            </ConfirmButton>
          </div>
        </Panel>

        <Panel title="Data export & import">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void doExport(true)}>
              <IconDownload width={18} height={18} /> Export all (with GPS fixes)
            </Button>
            <Button onClick={() => void doExport(false)}>
              <IconDownload width={18} height={18} /> Export without raw fixes
            </Button>
            <Button onClick={() => fileRef.current?.click()}>
              <IconUpload width={18} height={18} /> Import
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void doImport(f);
                e.target.value = '';
              }}
            />
          </div>
          <p className="mt-2 text-xs text-muted">Format: laptimer-export v1 JSON (documented in docs/DATA_FORMAT.md). Imports merge by record; newer versions win.</p>
        </Panel>

        {!cloudEnabled && (
        <Panel title="Sync (optional)">
          <Toggle checked={settings.syncEnabled} onChange={(v) => void update({ syncEnabled: v })} label="Enable sync with a Lap Timer server" hint="Circuits and sessions (including lap traces) are uploaded. Raw GPS fixes are not." />
          {settings.syncEnabled && (
            <div className="mt-3 space-y-3">
              <Field label="Server URL">
                <Input value={settings.syncUrl} placeholder={config.syncUrl || 'http://localhost:8787'} onChange={(e) => void update({ syncUrl: e.target.value.trim() })} />
              </Field>
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => void doSync()} disabled={syncing || !(settings.syncUrl || config.syncUrl)}>
                  {syncing ? 'Syncing…' : 'Sync now'}
                </Button>
                <Button onClick={() => void resetSync().then(() => setMessage({ tone: 'info', text: 'Sync identity reset. The next sync registers this device again.' }))}>Reset sync</Button>
              </div>
            </div>
          )}
        </Panel>
        )}

        <Panel title="About" className="md:col-span-2">
          <p className="text-sm text-muted">
            Map data © OpenStreetMap contributors. Routing: OSRM ({config.osrmUrl}). Consumer GPS typically updates at 1–10 Hz with 3–10 m accuracy; lap times are interpolated
            between fixes and are estimates, not certified timing.
          </p>
          {simulatorAllowed(acc.user?.uid) && <p className="mt-2 text-sm text-warn">Developer GPS simulator is enabled for this account.</p>}
        </Panel>
      </div>
    </div>
  );
}

function AccountSummary() {
  const acc = useAccount();
  const signedIn = acc.status === 'signed_in';
  return (
    <Panel title="Account">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold">{signedIn ? acc.user?.email : 'Not signed in'}</div>
          {signedIn ? <SyncLine /> : <div className="text-sm text-muted">Sign in to keep your laps in your account and see them on other devices.</div>}
        </div>
        <Link to="/account" className={buttonClass(signedIn ? 'secondary' : 'primary', 'md')}>
          {signedIn ? 'Manage account' : 'Sign in / Register'}
        </Link>
      </div>
    </Panel>
  );
}
