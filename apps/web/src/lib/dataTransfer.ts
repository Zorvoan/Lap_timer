import { buildExport, type ExportFile } from './exportImport';
import { getCircuit, getSamples, getSession, listCircuits, listSessions, putSampleChunk, saveCircuit, saveSession } from './repo';

export async function exportAll(includeSamples: boolean): Promise<string> {
  const circuits = await listCircuits();
  const sessions = await listSessions();
  const samples = includeSamples
    ? await Promise.all(sessions.map(async (s) => ({ sessionId: s.id, samples: await getSamples(s.id) })))
    : [];
  return buildExport(circuits, sessions, samples.filter((s) => s.samples.length));
}

export async function exportSession(sessionId: string, includeSamples: boolean): Promise<string> {
  const session = await getSession(sessionId);
  if (!session) throw new Error('Session not found');
  const circuit = await getCircuit(session.circuitId);
  const samples = includeSamples ? await getSamples(sessionId) : [];
  return buildExport(circuit ? [circuit] : [], [session], samples.length ? [{ sessionId, samples }] : []);
}

export interface ImportSummary {
  circuits: { added: number; updated: number; skipped: number };
  sessions: { added: number; updated: number; skipped: number };
}

/** Merges an export into local data. Existing records are replaced only by newer versions. */
export async function importFile(file: ExportFile): Promise<ImportSummary> {
  const summary: ImportSummary = {
    circuits: { added: 0, updated: 0, skipped: 0 },
    sessions: { added: 0, updated: 0, skipped: 0 },
  };
  for (const c of file.circuits) {
    const existing = await getCircuit(c.id);
    if (existing && existing.updatedAt >= c.updatedAt) {
      summary.circuits.skipped++;
      continue;
    }
    await saveCircuit(c, { touch: false });
    summary.circuits[existing ? 'updated' : 'added']++;
  }
  for (const s of file.sessions) {
    const existing = await getSession(s.id);
    if (existing && existing.updatedAt >= s.updatedAt) {
      summary.sessions.skipped++;
      continue;
    }
    await saveSession(s, { touch: false });
    summary.sessions[existing ? 'updated' : 'added']++;
    const samples = file.samples.find((x) => x.sessionId === s.id);
    if (samples) {
      const CHUNK = 2000;
      for (let i = 0; i * CHUNK < samples.samples.length; i++) {
        await putSampleChunk(s.id, i, samples.samples.slice(i * CHUNK, (i + 1) * CHUNK));
      }
    }
  }
  return summary;
}
