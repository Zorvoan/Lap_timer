/** One sector time; the best of its sector is highlighted (purple, as in motorsport timing). */
export function SectorCell({ ms, best }: { ms: number | undefined; best: boolean }) {
  return (
    <td className={`px-3 py-2 text-right font-mono tabular ${best ? 'font-bold text-[#b36bff]' : ''}`}>{ms !== undefined && Number.isFinite(ms) ? (ms / 1000).toFixed(3) : '—'}</td>
  );
}
