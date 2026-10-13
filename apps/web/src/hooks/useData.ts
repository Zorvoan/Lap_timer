import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type DependencyList } from 'react';
import { dataEvents } from '../lib/repo';
import { liveController, type LiveState } from '../lib/liveController';
import { account, type AccountState } from '../lib/cloud/account';

export interface AsyncData<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
  reload: () => void;
}

/** Loads data from local storage and reloads it whenever local data changes. */
export function useData<T>(loader: () => Promise<T>, deps: DependencyList): AsyncData<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    const onChange = () => setVersion((v) => v + 1);
    dataEvents.addEventListener('change', onChange);
    return () => dataEvents.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loaderRef
      .current()
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, loading, reload };
}

export function useLive(): LiveState {
  return useSyncExternalStore(liveController.subscribe, liveController.getState);
}

/** Re-renders at display rate while `active`, returning a timestamp from `clock`. */
export function useTicker(active: boolean, clock: () => number): number {
  const [now, setNow] = useState(() => clock());
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const loop = () => {
      setNow(clock());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active, clock]);
  return now;
}

export function useAccount(): AccountState {
  return useSyncExternalStore(account.subscribe, account.getState);
}
