import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { loadRegionData, type RegionData } from '../data/load';
import type { Region } from '../data/types';

interface RegionDataState {
  region: Region;
  setRegion: (r: Region) => void;
  data: RegionData | null;
  loading: boolean;
  error: string | null;
}

const Ctx = createContext<RegionDataState | null>(null);
const REGION_KEY = 'fgo-solver:region';

function initialRegion(): Region {
  try {
    return localStorage.getItem(REGION_KEY) === 'JP' ? 'JP' : 'NA';
  } catch {
    return 'NA';
  }
}

export function RegionDataProvider({ children }: { children: ReactNode }) {
  const [region, setRegionState] = useState<Region>(initialRegion);
  const [data, setData] = useState<RegionData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    loadRegionData(region).then(
      (d) => { if (alive) setData(d); },
      (e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)); },
    );
    return () => { alive = false; };
  }, [region]);

  const setRegion = (r: Region) => {
    try { localStorage.setItem(REGION_KEY, r); } catch { /* storage unavailable */ }
    setRegionState(r);
  };

  return (
    <Ctx.Provider value={{ region, setRegion, data, loading: !data && !error, error }}>
      {children}
    </Ctx.Provider>
  );
}

export function useRegionData(): RegionDataState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useRegionData outside RegionDataProvider');
  return v;
}
