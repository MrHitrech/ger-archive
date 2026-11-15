import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Progress, Translation, SearchEntry, QualityReport, Source, Recipe } from './types';
import { loadData } from './lib/data';
import { createSearch } from './lib/search';
import { emptyProgress, sanitizeProgress, STORAGE_KEY } from './lib/storage';

interface ContextValue {
  progress: Progress;
  update: (fn: (s: Progress) => Progress) => void;
  storageError: boolean;
  translations: Map<string, Translation>;
  entries: SearchEntry[];
  report: QualityReport;
  sources: Source[];
  search: ReturnType<typeof createSearch>;
  name: (id: string) => string;
  english: (id: string) => string;
  addTarget: (recipe: Recipe) => void;
  toggleFavorite: (id: string) => void;
  visit: (id: string) => void;
  notice: string;
}
const Context = createContext<ContextValue | null>(null);
export const useApp = () => {
  const value = useContext(Context);
  if (!value) throw new Error('App context unavailable');
  return value;
};
export function AppProvider({ children }: { children: ReactNode }) {
  const [progress, setProgress] = useState<Progress>(() => {
    try {
      return sanitizeProgress(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'));
    } catch {
      return emptyProgress();
    }
  });
  const [storageError, setStorageError] = useState(false);
  const [payload, setPayload] = useState<{
    translations: Translation[];
    entries: SearchEntry[];
    report: QualityReport;
    sources: Source[];
  } | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    Promise.all([
      loadData('translations'),
      loadData('search'),
      loadData('report'),
      loadData('sources'),
    ])
      .then(([translations, entries, report, sources]) => {
        if (active) setPayload({ translations, entries, report, sources });
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [progress]);
  useEffect(() => {
    const handle = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        try {
          setProgress(sanitizeProgress(JSON.parse(e.newValue || 'null')));
        } catch {
          /* keep current state */
        }
      }
    };
    window.addEventListener('storage', handle);
    return () => window.removeEventListener('storage', handle);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 3000);
    return () => clearTimeout(timer);
  }, [notice]);
  const translations = useMemo(
    () => new Map(payload?.translations.map((t) => [t.id, t]) || []),
    [payload],
  );
  const search = useMemo(() => createSearch(payload?.entries || []), [payload]);
  const original = (id: string) =>
    translations.get(id)?.name_en || payload?.entries.find((e) => e.id === id)?.name_en || id;
  const name = (id: string) =>
    progress.language === 'en' ? original(id) : translations.get(id)?.name_ru || original(id);
  if (error && !payload)
    return (
      <div className="boot">
        <p>{error}</p>
        <button
          className="button"
          onClick={() => {
            setError('');
            setAttempt((v) => v + 1);
          }}
        >
          Повторить загрузку
        </button>
      </div>
    );
  if (!payload)
    return (
      <div className="boot" role="status">
        <span className="loading-mark" />
        <p>Открываем архив…</p>
      </div>
    );
  const value: ContextValue = {
    progress,
    update: setProgress,
    storageError,
    translations,
    entries: payload.entries,
    report: payload.report,
    sources: payload.sources,
    search,
    name,
    english: original,
    notice,
    toggleFavorite: (id) =>
      setProgress((s) => ({
        ...s,
        favorites: s.favorites.includes(id)
          ? s.favorites.filter((x) => x !== id)
          : [...s.favorites, id],
      })),
    visit: (id) =>
      setProgress((s) =>
        s.recent[0] === id
          ? s
          : { ...s, recent: [id, ...s.recent.filter((x) => x !== id)].slice(0, 12) },
      ),
    addTarget: (recipe) => {
      setProgress((s) => ({
        ...s,
        targets: [
          ...s.targets,
          {
            id: crypto.randomUUID(),
            recipe_id: recipe.id,
            quantity: 1,
            mode: 'step',
            from_item_id: null,
            shared_instance: null,
            choices: {},
            completed: false,
          },
        ],
      }));
      setNotice('Рецепт добавлен в план крафта');
    },
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
