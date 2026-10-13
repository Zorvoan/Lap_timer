import { useMemo, useState } from 'react';
import { PageHeader } from '../components/AppShell';
import { Empty, LinkButton, Notice, Panel, Select, Spinner } from '../components/ui/primitives';
import { useData } from '../hooks/useData';
import { listCircuits, listSessions } from '../lib/repo';
import { SessionRows } from './Dashboard';

export function Sessions() {
  const { data, loading, error } = useData(async () => ({ sessions: await listSessions(), circuits: await listCircuits() }), []);
  const [circuit, setCircuit] = useState('');
  const sessions = useMemo(() => (data?.sessions ?? []).filter((s) => !circuit || s.circuitId === circuit), [data, circuit]);
  const circuitNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of data?.sessions ?? []) m.set(s.circuitId, s.circuitName);
    for (const c of data?.circuits ?? []) m.set(c.id, c.name);
    return [...m.entries()];
  }, [data]);

  return (
    <div className="pb-8">
      <PageHeader title="Sessions" subtitle="Every recorded session, newest first." />
      <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
        {error && <Notice tone="error">{error.message}</Notice>}
        {loading && !data ? (
          <Spinner />
        ) : data && data.sessions.length === 0 ? (
          <Empty title="No sessions recorded" action={<LinkButton to="/live" variant="primary">Start a session</LinkButton>} />
        ) : (
          <Panel
            title={`${sessions.length} session${sessions.length === 1 ? '' : 's'}`}
            bodyClass="p-0"
            actions={
              <Select aria-label="Filter by circuit" value={circuit} onChange={(e) => setCircuit(e.target.value)} className="h-8 w-48 text-xs">
                <option value="">All circuits</option>
                {circuitNames.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </Select>
            }
          >
            <SessionRows sessions={sessions} />
          </Panel>
        )}
      </div>
    </div>
  );
}
