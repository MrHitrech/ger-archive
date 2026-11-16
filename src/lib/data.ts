import { useEffect, useState } from 'react';
import type {
  Collections,
  CollectionKey,
  QualityReport,
  Translation,
  SearchEntry,
  Source,
  GameImages,
} from '../types.ts';

interface Payloads extends Collections {
  images: GameImages;
  report: QualityReport;
  translations: Translation[];
  search: SearchEntry[];
  sources: Source[];
}
interface Manifest {
  version: string;
  checked_at: string;
  files: Record<string, string>;
}
const base = `${import.meta.env.BASE_URL}data/`;
let manifest: Promise<Manifest> | null = null;
const cache = new Map<string, Promise<unknown>>();
async function fetchJson<T>(url: string, fresh = false): Promise<T> {
  const response = await fetch(url, fresh ? { cache: 'no-cache' } : undefined);
  if (!response.ok)
    throw new Error(`Не удалось загрузить локальную базу (HTTP ${response.status}).`);
  return response.json() as Promise<T>;
}
export async function loadData<K extends keyof Payloads>(key: K): Promise<Payloads[K]> {
  if (!cache.has(key)) {
    if (!manifest)
      manifest = fetchJson<Manifest>(`${base}manifest.json`, true).catch((error) => {
        manifest = null;
        throw error;
      });
    const promise = manifest
      .then((m) => {
        if (!m.files[key]) throw new Error(`Нет раздела ${key} в локальной базе.`);
        return fetchJson<Payloads[K]>(`${base}${key}.json?v=${m.files[key]}`);
      })
      .catch((error) => {
        cache.delete(key);
        throw error;
      });
    cache.set(key, promise);
  }
  return cache.get(key) as Promise<Payloads[K]>;
}
export function useCollections<K extends CollectionKey>(...keys: K[]) {
  const signature = keys.join(',');
  const [state, setState] = useState<{ data: Pick<Collections, K> | null; error: string | null }>({
    data: null,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setState({ data: null, error: null });
    Promise.all(signature.split(',').map(async (k) => [k, await loadData(k as K)] as const))
      .then((values) => {
        if (active)
          setState({ data: Object.fromEntries(values) as Pick<Collections, K>, error: null });
      })
      .catch((error) => {
        if (active) setState({ data: null, error: (error as Error).message });
      });
    return () => {
      active = false;
    };
  }, [signature, attempt]);
  return { ...state, retry: () => setAttempt((a) => a + 1) };
}
export const dataUrl = (file: string) => `${base}${file}`;
