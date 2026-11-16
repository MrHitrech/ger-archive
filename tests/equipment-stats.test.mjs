import test from 'node:test';
import assert from 'node:assert/strict';
import { readDataset } from '../scripts/lib/files.mjs';
import { decodeArticleStats, ARTICLE_STATS_DECODER } from '../scripts/lib/game-stats.mjs';
import { validateDataset } from '../scripts/lib/validate.mjs';
import {
  equipmentFamilies,
  formatEquipmentStat,
  hasCombatStats,
  isGun,
} from '../src/lib/equipment.ts';

function row(category_code, values, id = 12345) {
  const bytes = Buffer.alloc(76);
  bytes.writeUInt16LE(id);
  bytes.writeUInt16LE(category_code, 2);
  values.forEach((value, i) => bytes.writeInt16LE(value, 32 + i * 2));
  return { id, category_code, raw_hex: bytes.toString('hex') };
}
test('base stats distinguish melee points, gun hundredths, shield defence and non-combat items', () => {
  for (const category of [14, 270, 526, 782, 1038, 1294])
    assert.deepEqual(decodeArticleStats(row(category, [55, 0, 24])).stats, {
      slash: 55,
      crush: 0,
      pierce: 24,
    });
  for (const category of [15, 271, 527, 783]) {
    const decoded = decodeArticleStats(row(category, [0, 60, 91]));
    assert.deepEqual(decoded.stats, { crush: 0.6, pierce: 0.91 });
    assert.equal(decoded.scale, 100);
  }
  for (const category of [16, 272, 528])
    assert.deepEqual(decodeArticleStats(row(category, [123, 123, 123])).stats, { def: 123 });
  for (const category of [12, 268, 524, 13, 269, 525, 17]) {
    const decoded = decodeArticleStats(row(category, [0, 0, 0]));
    assert.deepEqual(decoded.stats, {});
    assert.equal(decoded.meaning, 'not_applicable');
  }
  assert.deepEqual(decodeArticleStats(row(14, [0, 0, 0])).stats, { slash: 0, crush: 0, pierce: 0 });
  assert.equal(decodeArticleStats({ id: 1, category_code: 14 }), null);
  assert.equal(decodeArticleStats(row(10, [0, 0, 0])), null);
});
test('a mismatched identity or unsupported stat layout stops decoding', () => {
  for (const value of [
    { ...row(14, [55, 0, 24]), id: 1 },
    row(14, [-1, 0, 24]),
    row(15, [1, 60, 91]),
    row(16, [123, 124, 123]),
    row(12, [1, 0, 0]),
  ])
    assert.throws(() => decodeArticleStats(value));
});

const data = await readDataset();
test('all 2186 weapons and shields have base stats proven by native ID; 601 other items are non-combat', () => {
  const evidence = new Map(data.evidence.map((e) => [e.id, e]));
  assert.equal(data.items.filter(hasCombatStats).length, 2186);
  assert.equal(data.items.filter((i) => !hasCombatStats(i)).length, 601);
  for (const item of data.items) {
    assert.ok(!item.missing_fields.includes('stats'), item.name_en);
    assert.equal(Object.keys(item.stats).length > 0, hasCombatStats(item), item.name_en);
    assert.ok(
      item.references.some(
        (ref) =>
          evidence.get(ref).game_origin?.resource === 'article_en' &&
          JSON.parse(evidence.get(ref).excerpt).decoder === ARTICLE_STATS_DECODER,
      ),
      item.name_en,
    );
  }
  for (const [name, stats] of [
    ['Knife P', { slash: 55, crush: 0, pierce: 24 }],
    ['Blade P', { slash: 97, crush: 0, pierce: 0 }],
    ['Claymore P', { slash: 46, crush: 69, pierce: 0 }],
    ['Hammer P', { slash: 0, crush: 109, pierce: 0 }],
    ['Halberd P', { slash: 0, crush: 0, pierce: 97 }],
    ['Harvest', { slash: 242, crush: 0, pierce: 0 }],
    ['Falcon P', { crush: 0.6, pierce: 0.91 }],
    ['Rice Lily EX', { crush: 3.2, pierce: 5.96 }],
    ['Type50 Auto-Gun P', { crush: 0.85, pierce: 0.7 }],
    ['Type79 Cannon P', { crush: 1, pierce: 0.66 }],
    ['Type20 Gat P', { crush: 0.91, pierce: 0.6 }],
    ['Standard Buckler P', { def: 63 }],
    ['Support Shield P', { def: 63 }],
    ['Fireproof Tower P', { def: 63 }],
  ])
    assert.deepEqual(data.items.find((i) => i.name_en === name).stats, stats, name);
  const gun = data.items.find((i) => i.name_en === 'Falcon P');
  assert.ok(isGun(gun));
  assert.equal(formatEquipmentStat(gun, gun.stats.crush), '×0,60');
});

test('invented stats, wrong gun scale, missing proof and stale missing flags block publication', () => {
  for (const mutate of [
    (d) => {
      d.items.find((i) => i.name_en === 'Blade P').stats.slash++;
    },
    (d) => {
      d.items.find((i) => i.name_en === 'Falcon P').stats.crush = 60;
    },
    (d) => {
      const item = d.items.find((i) => i.name_en === 'Falcon P');
      item.references = item.references.filter(
        (ref) =>
          JSON.parse(d.evidence.find((e) => e.id === ref).excerpt).decoder !==
          ARTICLE_STATS_DECODER,
      );
    },
    (d) => {
      d.items.find((i) => i.name_en === 'Blade P').missing_fields.push('stats');
    },
    (d) => {
      d.items.find((i) => i.category === 'clothing_top').stats = { def: 10 };
    },
  ]) {
    const changed = structuredClone(data);
    mutate(changed);
    assert.ok(validateDataset(changed).errors.some((e) => e.includes('base stats')));
  }
});

test('all 892 family labels use existing Russian roots while English URL keys stay stable', () => {
  const translations = new Map(data.translations.map((t) => [t.id, t]));
  const ru = equipmentFamilies(data.items, (id) => translations.get(id)?.name_ru ?? id);
  const en = equipmentFamilies(data.items, (id) => translations.get(id)?.name_en ?? id);
  assert.equal(ru.length, 892);
  assert.deepEqual(ru.map((f) => f.value).sort(), en.map((f) => f.value).sort());
  assert.ok(ru.every((f) => /[\u0400-\u04ff]/u.test(f.label)));
  assert.equal(ru.find((f) => f.value === 'Knife P').label, 'Нож P');
  assert.equal(en.find((f) => f.value === 'Knife P').label, 'Knife P');
  const bottoms = equipmentFamilies(
    data.items,
    (id) => translations.get(id)?.name_ru ?? id,
    'clothing_bottom',
  );
  assert.equal(bottoms.find((f) => f.value === 'Amagahara Uniform').label, 'Форма Амагахары (низ)');
});
