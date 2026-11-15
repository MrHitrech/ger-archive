import Fuse from 'fuse.js';
import type { SearchEntry } from '../types.ts';
export const normalize = (value: string) =>
  value.normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g, 'е').trim();
export function createSearch(entries: SearchEntry[]) {
  const normalized = entries.map((entry) => ({
    ...entry,
    search_en: normalize(entry.name_en),
    search_ru: normalize(entry.name_ru || ''),
    search_aliases: entry.aliases.map(normalize),
  }));
  const fuse = new Fuse(normalized, {
    keys: [
      { name: 'search_ru', weight: 2 },
      { name: 'search_en', weight: 2 },
      { name: 'search_aliases', weight: 1.5 },
    ],
    threshold: 0.32,
    ignoreLocation: true,
    minMatchCharLength: 2,
    includeScore: true,
  });
  return (query: string, kind?: SearchEntry['kind']) => {
    const q = normalize(query);
    if (!q) return entries.filter((e) => !kind || e.kind === kind);
    const ranked = fuse
      .search(q)
      .map((r) => r.item)
      .filter((e) => !kind || e.kind === kind);
    const exact = normalized.filter(
      (e) =>
        (!kind || e.kind === kind) &&
        [e.search_en, e.search_ru, ...e.search_aliases].some((s) => s.includes(q)),
    );
    return [...new Map([...exact, ...ranked].map((e) => [e.id, e])).values()];
  };
}
