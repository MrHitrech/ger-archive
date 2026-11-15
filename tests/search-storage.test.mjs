import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearch, normalize } from '../src/lib/search.ts';
import { emptyProgress, sanitizeProgress } from '../src/lib/storage.ts';
import { readDataset, idFor } from '../scripts/lib/files.mjs';

test('Russian ё, case, partial English, aliases and typos find the same ID', () => {
  const entries = [
    {
      id: 'one',
      kind: 'material',
      name_en: 'Ashen Wing',
      name_ru: 'Пепельное крыло',
      aliases: ['Обожжённое крыло'],
    },
    { id: 'two', kind: 'item', name_en: 'Knife EX', name_ru: 'Нож EX', aliases: [] },
  ];
  const search = createSearch(entries);
  for (const q of ['ПЕПЕЛЬНОЕ КРЫЛО', 'ashen', 'Ashen Wing', 'Обожженное', 'Пепелное крыло'])
    assert.equal(search(q)[0].id, 'one', q);
  assert.equal(normalize(' Обожжённое '), 'обожженное');
  assert.equal(search('Knife', 'material').length, 0);
});
test('all real imported names remain searchable without an online service', async () => {
  const data = await readDataset();
  const tr = new Map(data.translations.map((t) => [t.id, t]));
  const entries = ['materials', 'items', 'missions', 'aragami'].flatMap((k) =>
    data[k].map((r) => ({
      id: r.id,
      kind: { materials: 'material', items: 'item', missions: 'mission', aragami: 'aragami' }[k],
      name_en: r.name_en,
      name_ru: tr.get(r.id)?.name_ru,
      aliases: tr.get(r.id)?.aliases || [],
    })),
  );
  const search = createSearch(entries);
  for (const entry of entries)
    assert.ok(
      search(entry.name_en, entry.kind).some((e) => e.id === entry.id),
      entry.name_en,
    );
});
test('corrupt and unsupported progress falls back to a safe empty state', () => {
  for (const input of [null, 'invalid', [], { version: 99 }])
    assert.deepEqual(sanitizeProgress(input), emptyProgress());
  const id = idFor('m', 'material');
  const input = {
    version: 1,
    language: 'invalid',
    favorites: [id, id, '__proto__'],
    inventory: { [id]: -3 },
    recent: [],
    targets: [{ id: 'bad!', recipe_id: 'missing' }],
  };
  const result = sanitizeProgress(input);
  assert.deepEqual(result.favorites, [id]);
  assert.deepEqual(result.inventory, {});
  assert.deepEqual(result.targets, []);
  assert.equal(result.language, 'both');
});
test('progress preserves valid physical-instance links and caps malformed counts', () => {
  const recipe = idFor('r', 'recipe');
  const material = idFor('m', 'material');
  const result = sanitizeProgress({
    version: 1,
    language: 'ru',
    targets: [
      {
        id: 'a',
        recipe_id: recipe,
        quantity: 1.2,
        mode: 'chain',
        shared_instance: 'b',
        choices: {},
      },
      { id: 'a', recipe_id: recipe },
    ],
    inventory: { [material]: 2 },
  });
  assert.equal(result.targets.length, 1);
  assert.equal(result.targets[0].quantity, 1);
  assert.equal(result.targets[0].shared_instance, 'b');
  assert.equal(result.inventory[material], 2);
});
