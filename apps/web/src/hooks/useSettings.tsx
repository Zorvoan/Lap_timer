import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getSettings, saveSettings } from '../lib/repo';
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from '../lib/settings';
import { log } from '../lib/log';

interface SettingsContextValue {
  settings: Settings;
  loaded: boolean;
  update: (patch: Partial<Settings>) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getSettings()
      .then(setSettings)
      .catch((e) => log.error('loading settings failed', e))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  const current = useRef(settings);
  current.current = settings;
  const update = useCallback(async (patch: Partial<Settings>) => {
    const next = normalizeSettings({ ...current.current, ...patch });
    current.current = next;
    setSettings(next);
    await saveSettings(next);
  }, []);

  const value = useMemo(() => ({ settings, loaded, update }), [settings, loaded, update]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider');
  return ctx;
}
