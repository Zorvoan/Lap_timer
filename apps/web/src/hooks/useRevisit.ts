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

/** Entrance animations already played since the app started, by key. */
const played = new Set<string>();

/**
 * Whether the entrance with this key has played already. Lists that are rebuilt (switching tabs
 * and back) would otherwise play their numbers' entrances again.
 */
export function hasPlayed(key: string): boolean {
  return played.has(key);
}

export function markPlayed(key: string): void {
  played.add(key);
}
