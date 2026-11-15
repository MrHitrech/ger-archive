import type { Progress, CraftTarget } from '../types.ts';

export const STORAGE_KEY = 'ger-archive:progress:v1';
export const emptyProgress = (): Progress => ({
  version: 1,
  language: 'both',
  favorites: [],
  recent: [],
  inventory: {},
  targets: [],
});
const isId = (v: unknown): v is string =>
  typeof v === 'string' && /^ger-[a-z]-[a-f0-9]{12}$/.test(v);
export function sanitizeProgress(input: unknown): Progress {
  const state = emptyProgress();
  if (!input || typeof input !== 'object' || (input as { version?: unknown }).version !== 1)
    return state;
  const raw = input as Record<string, unknown>;
  if (['both', 'ru', 'en'].includes(raw.language as string))
    state.language = raw.language as Progress['language'];
  for (const key of ['favorites', 'recent'] as const)
    if (Array.isArray(raw[key]))
      state[key] = [...new Set(raw[key].filter(isId))].slice(0, key === 'recent' ? 12 : 1000);
  if (raw.inventory && typeof raw.inventory === 'object')
    for (const [key, n] of Object.entries(raw.inventory))
      if (isId(key) && Number.isSafeInteger(n) && n >= 0 && n <= 999999) state.inventory[key] = n;
  const targets = Array.isArray(raw.targets) ? raw.targets : [];
  const ids = new Set<string>();
  for (const t of targets.slice(0, 100)) {
    if (
      !t ||
      typeof t !== 'object' ||
      typeof t.id !== 'string' ||
      !/^[a-zA-Z0-9-]{1,80}$/.test(t.id) ||
      ids.has(t.id) ||
      !isId(t.recipe_id)
    )
      continue;
    ids.add(t.id);
    const choices: Record<string, string> = {};
    if (t.choices && typeof t.choices === 'object')
      for (const [id, recipe] of Object.entries(t.choices))
        if (isId(id) && isId(recipe)) choices[id] = recipe;
    state.targets.push({
      id: t.id,
      recipe_id: t.recipe_id,
      quantity:
        Number.isSafeInteger(t.quantity) && t.quantity >= 1 && t.quantity <= 99 ? t.quantity : 1,
      mode: t.mode === 'chain' ? 'chain' : 'step',
      from_item_id: isId(t.from_item_id) ? t.from_item_id : null,
      shared_instance:
        typeof t.shared_instance === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(t.shared_instance)
          ? t.shared_instance
          : null,
      choices,
      completed: t.completed === true,
    } as CraftTarget);
  }
  return state;
}
