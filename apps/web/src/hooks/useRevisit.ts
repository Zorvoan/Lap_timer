import { createContext, useContext } from 'react';

/** Pages opened since the app started (by path). */
const visited = new Set<string>();

/**
 * Whether this page has been shown before since the app started. Entrance animations (charts
 * drawing in, numbers rolling up, gauges filling) play on the first visit only; coming back,
 * everything is simply there.
 */
export const RevisitContext = createContext(false);

export function useRevisit(): boolean {
  return useContext(RevisitContext);
}

/** Decides once per arrival on a page, before it renders, then remembers the page. */
export function wasVisited(path: string): boolean {
  return visited.has(path);
}

export function markVisited(path: string): void {
  visited.add(path);
}
