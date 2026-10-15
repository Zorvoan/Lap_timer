import { useEffect, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { formatDelta, formatDistance, formatLapTime, formatSpeed, speedLabel, splitTimes, type LapRecord, type Session } from '@laptimer/core';
import { PageHeader } from '../components/AppShell';
import { Button, Notice, Panel, Select, Spinner } from '../components/ui/primitives';
import { IconPlay, IconSwap } from '../components/ui/icons';
import { ComparisonCharts, ReplayPanel, useComparisonRows } from '../components/laps/LapComparison';
import { COLOR_A, COLOR_B } from '../components/charts/Charts';
import { useAccount, useData } from '../hooks/useData';
import { useSettings } from '../hooks/useSettings';
import { ensureLocalCircuit, leaderboardTracks, refreshFeatured } from '../lib/cloud/account';
import { lapFromPublished, type LeaderboardEntry } from '../lib/cloud/leaderboard';
import type { FeaturedCircuit } from '../lib/cloud/community';
import { circuitLapNumbers, lapKey } from '../lib/lapNumbers';
import { lapLength } from '../lib/references';
import { listSessions } from '../lib/repo';

const community = () => import('../lib/cloud/community');

/** One lap that can be compared: a driver's published leaderboard lap or one of the user's own laps. */
interface Option {
  /** `lb:<uid>` for a leaderboard lap, `me:<sessionId>#<lap>` for an own lap. */
  key: string;
  label: string;
  timeMs: number;
  /** Own laps are available right away; leaderboard laps load their telemetry on demand. */
  lap?: LapRecord;
  entry?: LeaderboardEntry;
}

/**
 * Telemetry of a leaderboard lap compared with another lap: the user's own laps or other
 * drivers' leaderboard laps, with the same charts, gain/loss map and replay as the circuit page.
 * URL: `?a=<key>&b=<key>` (see {@link Option.key}); without `a`, A is the user's own best lap.
 */
export function LeaderboardCompare() {
  const { id = '' } = useParams();
  const acc = useAccount();
  const { settings } = useSettings();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  useEffect(() => {
    if (!acc.featured.length) void refreshFeatured();
  }, [acc.featured.length]);

  const track = leaderboardTracks(acc).find((f) => f.id === id) ?? null;
  const lengthM = useMemo(() => {
    if (!track) return 0;
    try {
      return lapLength(track);
    } catch {
      return track.lengthM;
    }
  }, [track]);

  const { data: board, error: boardError } = useData(async () => (await community()).getLeaderboard(id, 200), [id]);
  const { data: sessions } = useData(() => listSessions(id), [id]);

  const options = useMemo(() => buildOptions(board ?? [], sessions ?? [], acc.user?.uid ?? null, settings.includeSimulatedInBests), [board, sessions, acc.user?.uid, settings.includeSimulatedInBests]);
  // A is the user's own lap unless the URL says otherwise; a lap opened from the leaderboard
  // (`?b=`) only becomes A when the user has no lap of their own on this track.
  const ownKey = ownLapKey(options, acc.user?.uid ?? null);
  const keyA = params.get('a') ?? ownKey ?? params.get('b') ?? options.drivers[0]?.key ?? null;
  const keyB = params.get('b') ?? defaultB(keyA, options, acc.user?.uid ?? null);
  const optA = findOption(options, keyA);
  const optB = keyB && keyB !== keyA ? findOption(options, keyB) : null;

  const a = useOptionLap(optA, track, lengthM);
  const b = useOptionLap(optB, track, lengthM);
  const rows = useComparisonRows(a.lap, b.lap, lengthM);
  // Thirds of the track by distance: the same split points for every driver.
  const splitsA = useMemo(() => (a.lap ? splitTimes(a.lap.trace, a.lap.timeMs, lengthM, 3) : []), [a.lap, lengthM]);
  const splitsB = useMemo(() => (b.lap ? splitTimes(b.lap.trace, b.lap.timeMs, lengthM, 3) : []), [b.lap, lengthM]);

  function choose(next: { a?: string | null; b?: string | null }) {
    const p: Record<string, string> = {};
    const na = next.a === undefined ? keyA : next.a;
    const nb = next.b === undefined ? keyB : next.b;
    if (na) p.a = na;
    p.b = nb ?? '';
    setParams(p, { replace: true });
  }

  if (!track) {
    return <div className="p-6">{acc.featured.length ? <Notice tone="error">This track is not on the leaderboard.</Notice> : <Spinner />}</div>;
  }

  // Lap B from someone else on the leaderboard can be raced live: it becomes the lap to beat.
  const raceUid = keyB?.startsWith('lb:') && keyB !== `lb:${acc.user?.uid}` ? keyB.slice(3) : null;
  async function race() {
    if (!track || !raceUid) return;
    await ensureLocalCircuit(track);
    navigate(`/live?circuit=${track.id}&ref=${encodeURIComponent(`lb:${raceUid}`)}`);
  }

  const labelA = optA ? shortLabel(optA) : 'A';
  const labelB = optB ? shortLabel(optB) : null;
  const sectorCount = splitsA.length && splitsA.length === splitsB.length ? splitsA.length : 0;

  return (
    <div className="pb-10">
      <PageHeader
        title="Compare laps"
        back={{ to: `/tracks/${track.id}`, label: track.name }}
        subtitle={`${track.name} · ${formatDistance(track.lengthM, settings.distanceUnit)} · aligned by distance along the track`}
      />
      <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
        {boardError && <Notice tone="error">Could not load the leaderboard: {boardError.message}</Notice>}

        <Panel bodyClass="p-4">
          <div className="grid items-end gap-3 md:grid-cols-[1fr_auto_1fr]">
            <LapPicker letter="A" color={COLOR_A} value={keyA} options={options} onChange={(k) => choose({ a: k })} />
            <Button className="md:mb-0.5" onClick={() => choose({ a: keyB, b: keyA })} disabled={!keyB} aria-label="Swap A and B" title="Swap A and B">
              <IconSwap width={18} height={18} /> <span className="md:hidden">Swap</span>
            </Button>
            <LapPicker letter="B" color={COLOR_B} value={optB ? keyB : ''} options={options} onChange={(k) => choose({ b: k || '' })} allowNone />
          </div>
          {!options.mine.length && (
            <p className="mt-3 text-sm text-muted">Drive this track with real GPS and your laps appear here to compare against the leaderboard.</p>
          )}
        </Panel>

        {raceUid && (
          <Button variant="primary" size="xl" className="w-full" onClick={() => void race()}>
            <IconPlay width={20} height={20} /> Race {board?.find((e) => e.uid === raceUid)?.nickname ?? 'this time'}
          </Button>
        )}

        {a.loading || b.loading ? (
          <Spinner label="Loading telemetry" />
        ) : a.error || b.error ? (
          <Notice tone="error">{a.error ?? b.error}</Notice>
        ) : a.lap ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <TimeCard letter="A" color={COLOR_A} label={labelA} lap={a.lap} />
              {b.lap ? <TimeCard letter="B" color={COLOR_B} label={labelB ?? ''} lap={b.lap} /> : <div className="hidden sm:block" />}
              <div className="rounded border border-line bg-panel p-4">
                <div className="label">Gap A − B</div>
                {b.lap ? (
                  <>
                    <div className={`mt-1 font-mono text-2xl tabular ${a.lap.timeMs <= b.lap.timeMs ? 'text-gain' : 'text-loss'}`}>{formatDelta(a.lap.timeMs - b.lap.timeMs)} s</div>
                    <div className="mt-0.5 text-xs text-muted">{a.lap.timeMs <= b.lap.timeMs ? `${labelA} is faster` : `${labelB} is faster`}</div>
                  </>
                ) : (
                  <div className="mt-1 text-sm text-muted">Pick a lap B to compare.</div>
                )}
              </div>
            </div>

            {sectorCount > 0 && b.lap && (
              <Panel title="Sectors" bodyClass="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left">
                      <th className="label px-4 py-2 font-semibold">Sector</th>
                      <th className="label px-4 py-2 text-right font-semibold" style={{ color: COLOR_A }}>A</th>
                      <th className="label px-4 py-2 text-right font-semibold" style={{ color: COLOR_B }}>B</th>
                      <th className="label px-4 py-2 text-right font-semibold">A − B</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {Array.from({ length: sectorCount }, (_, i) => {
                      const diff = splitsA[i] - splitsB[i];
                      return (
                        <tr key={i}>
                          <td className="px-4 py-2">S{i + 1}</td>
                          <td className="px-4 py-2 text-right font-mono tabular">{(splitsA[i] / 1000).toFixed(3)}</td>
                          <td className="px-4 py-2 text-right font-mono tabular">{(splitsB[i] / 1000).toFixed(3)}</td>
                          <td className={`px-4 py-2 text-right font-mono tabular ${diff <= 0 ? 'text-gain' : 'text-loss'}`}>{formatDelta(diff)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Panel>
            )}

            <ComparisonCharts A={a.lap} B={b.lap} labelA={labelA} labelB={labelB} rows={rows} speedUnit={settings.speedUnit} distanceUnit={settings.distanceUnit} />
            <ReplayPanel circuit={track} lapA={a.lap} lapB={b.lap} labelA={labelA} labelB={labelB} rows={rows} lengthM={lengthM} speedUnit={settings.speedUnit} chooseFollow />
            <p className="text-xs text-muted">
              Leaderboard laps are published with up to 2000 points of time, distance and speed; positions are placed on the track by distance. Times come from each driver&apos;s phone GPS.
            </p>
          </>
        ) : (
          <Notice>Pick a lap A.</Notice>
        )}
      </div>
    </div>
  );
}

function LapPicker({
  letter,
  color,
  value,
  options,
  onChange,
  allowNone = false,
}: {
  letter: string;
  color: string;
  value: string | null;
  options: { drivers: Option[]; mine: Option[] };
  onChange: (key: string) => void;
  allowNone?: boolean;
}) {
  return (
    <label className="block min-w-0">
      <span className="label flex items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} aria-hidden="true" /> Lap {letter}
      </span>
      <Select className="mt-1.5 h-11 text-base" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {allowNone && <option value="">— none —</option>}
        {options.mine.length > 0 && (
          <optgroup label="Your laps">
            {options.mine.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="Leaderboard">
          {options.drivers.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </optgroup>
      </Select>
    </label>
  );
}

function TimeCard({ letter, color, label, lap }: { letter: string; color: string; label: string; lap: LapRecord }) {
  const { settings } = useSettings();
  return (
    <div className="rounded border border-line bg-panel p-4">
      <div className="label flex items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} aria-hidden="true" /> {letter} · <span className="truncate normal-case tracking-normal">{label}</span>
      </div>
      <div className="mt-1 font-mono text-2xl tabular">{formatLapTime(lap.timeMs)}</div>
      <div className="mt-0.5 text-xs text-muted">
        avg {formatSpeed(lap.avgSpeedMs, settings.speedUnit)} · max {formatSpeed(lap.maxSpeedMs, settings.speedUnit)} {speedLabel(settings.speedUnit)}
      </div>
    </div>
  );
}

function buildOptions(board: LeaderboardEntry[], sessions: Session[], myUid: string | null, includeSimulated: boolean): { drivers: Option[]; mine: Option[] } {
  const drivers = board.map((e, i) => ({
    key: `lb:${e.uid}`,
    label: `P${i + 1} ${e.nickname}${e.uid === myUid ? ' (you)' : ''} · ${formatLapTime(e.timeMs)} · ${e.car}`,
    timeMs: e.timeMs,
    entry: e,
  }));
  const numbers = circuitLapNumbers(sessions);
  const mine = sessions
    .filter((s) => s.endedAt !== null && (s.source === 'gps' || includeSimulated))
    .flatMap((s) =>
      s.laps
        .filter((l) => l.valid)
        .map((l) => ({
          key: `me:${s.id}#${l.lap}`,
          label: `You · ${formatLapTime(l.timeMs)} · lap ${numbers.get(lapKey(s.id, l.lap)) ?? l.lap}${s.source === 'simulated' ? ' (sim)' : ''}, ${new Date(s.startedAt).toLocaleDateString()}`,
          timeMs: l.timeMs,
          lap: l,
        })),
    )
    .sort((x, y) => x.timeMs - y.timeMs)
    .slice(0, 30);
  return { drivers, mine };
}

function findOption(options: { drivers: Option[]; mine: Option[] }, key: string | null): Option | null {
  if (!key) return null;
  return options.drivers.find((o) => o.key === key) ?? options.mine.find((o) => o.key === key) ?? null;
}

/** The user's best lap here: a lap on this device, else their published leaderboard lap. */
function ownLapKey(options: { drivers: Option[]; mine: Option[] }, myUid: string | null): string | null {
  if (options.mine[0]) return options.mine[0].key;
  if (myUid && options.drivers.some((o) => o.key === `lb:${myUid}`)) return `lb:${myUid}`;
  return null;
}

/** B defaults to "you" when comparing someone else, and to the leader when looking at your own lap. */
function defaultB(keyA: string | null, options: { drivers: Option[]; mine: Option[] }, myUid: string | null): string | null {
  if (!keyA) return null;
  const aIsMine = keyA.startsWith('me:') || (myUid !== null && keyA === `lb:${myUid}`);
  if (!aIsMine) {
    const own = ownLapKey(options, myUid);
    if (own) return own;
  }
  return options.drivers.find((o) => o.key !== keyA)?.key ?? null;
}

function shortLabel(o: Option): string {
  if (o.entry) return `${o.entry.nickname} ${formatLapTime(o.timeMs)}`;
  return `You ${formatLapTime(o.timeMs)}`;
}

/** The lap behind an option; a leaderboard lap's telemetry is fetched when it is first picked. */
function useOptionLap(opt: Option | null, track: FeaturedCircuit | null, lengthM: number): { lap: LapRecord | null; loading: boolean; error: string | null } {
  const entry = opt?.entry ?? null;
  const { data, loading, error } = useData(async () => {
    if (!entry || !track || lengthM <= 0) return null;
    const trace = await (await community()).getPublishedTrace(track.id, entry.uid);
    return trace ? lapFromPublished(entry, trace, track, lengthM) : 'missing';
  }, [entry?.uid, entry?.timeMs, track, lengthM]);
  if (!opt) return { lap: null, loading: false, error: null };
  if (opt.lap) return { lap: opt.lap, loading: false, error: null };
  if (error) return { lap: null, loading: false, error: `Could not load ${opt.entry?.nickname}'s telemetry: ${error.message}` };
  if (data === 'missing') return { lap: null, loading: false, error: `${opt.entry?.nickname}'s lap has no telemetry published.` };
  return { lap: data ?? null, loading: loading || data === undefined, error: null };
}
