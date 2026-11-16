import type { Item } from '../types';

export const equipmentStatLabels: Record<string, string> = {
  slash: 'Резание',
  crush: 'Дробление',
  pierce: 'Прокол',
  def: 'Защита',
};
export const isGun = (item: Pick<Item, 'category'>) =>
  ['sniper', 'assault', 'blast', 'shotgun'].includes(item.category);
export const hasCombatStats = (item: Pick<Item, 'category'>) =>
  !['clothing_top', 'clothing_bottom', 'upgrade'].includes(item.category);
export function formatEquipmentStat(item: Pick<Item, 'category'>, value: number) {
  return isGun(item)
    ? `×${value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : value.toLocaleString('ru-RU');
}

/** Localize the existing family keys through their root item translations. */
export function equipmentFamilies(items: Item[], name: (id: string) => string, category = '') {
  const roots = new Map<string, Item[]>();
  for (const item of items) roots.set(item.name_en, [...(roots.get(item.name_en) ?? []), item]);
  return [...new Set(items.map((item) => item.family))]
    .map((value) => {
      const candidates = roots.get(value) ?? [];
      const preferred = category
        ? candidates.filter((item) => item.category === category)
        : candidates;
      const selected = preferred.length ? preferred : candidates;
      return {
        value,
        label: [...new Set(selected.map((item) => name(item.id)))].join(' / ') || value,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
}
