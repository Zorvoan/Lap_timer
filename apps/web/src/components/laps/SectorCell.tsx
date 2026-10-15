/** One sector time; the best of its sector is highlighted (purple, as in motorsport timing). */
export function SectorCell({ ms, best }: { ms: number | undefined; best: boolean }) {
  return (
    <td className={`px-1.5 py-2 text-right font-mono text-xs tabular sm:px-3 sm:text-sm ${best ? 'font-bold text-[#b36bff]' : ''}`}>{ms !== undefined && Number.isFinite(ms) ? (ms / 1000).toFixed(2) : '—'}</td>
  );
}
