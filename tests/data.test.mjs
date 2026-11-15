import test from 'node:test';
import assert from 'node:assert/strict';
import { readDataset, idFor } from '../scripts/lib/files.mjs';
import { validateDataset, validateSnapshots } from '../scripts/lib/validate.mjs';
import { scopedSection, mergeDataset, parseEquipment } from '../scripts/lib/importer.mjs';
import { createSeed } from '../scripts/import-seed.mjs';
import { prepareTranslations } from '../scripts/prepare-translations.mjs';

const data = await readDataset();
test('all linked data conforms to the schema and unchanged source snapshots', async () => {
  assert.deepEqual(validateDataset(data).errors, []);
  assert.deepEqual(await validateSnapshots(data), []);
});
test('equipment importer requires an explicit Resurrection boundary', () => {
  assert.throws(() => scopedSection('God Eater Burst', 'God Eater Burst'), /Resurrection/);
  assert.throws(
    () =>
      scopedSection(
        '## God Eater Resurrection\n## God Eater Burst\n',
        '## God Eater Resurrection\n',
      ),
    /Mixed/,
  );
  assert.throws(() => scopedSection('wrong page', '## God Eater Resurrection\n'), /Missing/);
  assert.throws(
    () =>
      parseEquipment(' | Knife\nRank 1  | 350 Fc\nMatPlaceholder1  | Skill  | Slash 55', {
        category: 'short_blade',
        family: 'test',
        expectedCount: 1,
      }),
    /Ambiguous/,
  );
});
test('initial recipes and reward table are reproducible, with source context', async () => {
  const { dataset: seed, issues } = await createSeed();
  assert.deepEqual((await createSeed()).dataset, seed);
  for (const collection of [
    'materials',
    'items',
    'recipes',
    'missions',
    'aragami',
    'locations',
    'drops',
    'evidence',
    'sources',
  ])
    for (const row of seed[collection])
      assert.ok(
        data[collection].some((current) => current.id === row.id),
        `${collection}: preserved ${row.id}`,
      );
  const knifeP = seed.items.find((i) => i.name_en === 'Knife P');
  const knife = seed.items.find((i) => i.name_en === 'Knife');
  const first = seed.recipes.find((r) => r.item_id === knifeP.id);
  const upgrade = seed.recipes.find((r) => r.item_id === knife.id);
  assert.equal(first.cost_fc, 350);
  assert.equal(first.operation, 'craft');
  assert.equal(upgrade.operation, 'upgrade');
  assert.equal(upgrade.from_item_id, knifeP.id);
  assert.equal(upgrade.cost_fc, 280);
  assert.equal(seed.drops.length, 24);
  assert.ok(issues.some((i) => i.code === 'CROSS_GAME_REJECTED'));
  assert.ok(issues.some((i) => i.code === 'AMBIGUOUS_INGREDIENT'));
  assert.ok(!seed.items.some((i) => i.name_en === 'DEF'));
  assert.ok(!seed.aragami.some((a) => a.name_en === 'Vajratail (Freeze)'));
  assert.ok(!seed.drops.some((d) => d.method === 'devour'));
  for (let rank = 1; rank <= 14; rank++)
    assert.ok(
      seed.missions.some((m) => m.rank === rank),
      `rank ${rank}`,
    );
});
test('ambiguous reward slots stay unknown; distinct conditions stay separate', () => {
  const grease = data.materials.find((m) => m.name_en === 'Impure Grease');
  const greaseDrops = data.drops.filter((d) => d.material_id === grease.id);
  assert.equal(greaseDrops.length, 1);
  assert.equal(greaseDrops[0].drop_rate, null);
  const mana = data.materials.find((m) => m.name_en === 'Mana Stone Chip');
  const manaDrops = data.drops.filter((d) => d.material_id === mana.id);
  assert.deepEqual(
    manaDrops.map((d) => d.drop_rate).sort((a, b) => a - b),
    [36, 100],
  );
  const pixie = data.materials.find((m) => m.name_en === 'Pixie Thorn');
  const pixieDrop = data.drops.find((d) => d.material_id === pixie.id);
  assert.equal(data.missions.find((m) => m.id === pixieDrop.mission_id).name_en, 'Mayflies');
  assert.equal(pixieDrop.drop_rate, null);
});
test('bad links, duplicate IDs, negative quantities and impossible probabilities fail', () => {
  for (const mutate of [
    (d) => {
      d.recipes[0].materials[0].material_id = idFor('m', 'does not exist');
    },
    (d) => d.materials.push(d.materials[0]),
    (d) => {
      d.recipes[0].materials[0].quantity = -1;
    },
    (d) => {
      d.recipes[0].materials[0].quantity = 1.5;
    },
    (d) => {
      d.drops[0].drop_rate = 100.01;
    },
    (d) => {
      d.items[0].game = 'geb';
    },
    (d) => {
      d.missions[0].rank = 15;
    },
    (d) => {
      d.evidence[0].snapshot = '../../package.json';
    },
  ]) {
    const changed = structuredClone(data);
    mutate(changed);
    assert.ok(validateDataset(changed).errors.length);
  }
});
test('search-index copies cannot be promoted to verified by changing a status', async () => {
  const changed = structuredClone((await createSeed()).dataset);
  Object.assign(changed.items[0], {
    verification_status: 'verified',
    missing_fields: [],
    reviewed_by: 'Example reviewer',
    reviewed_at: '2026-11-14',
  });
  assert.ok(validateDataset(changed).errors.some((e) => e.includes('search-index-only')));
});
test('new original-source review may retain the historical search-copy reference', async () => {
  const changed = structuredClone((await createSeed()).dataset);
  const record = changed.items[0];
  const oldEvidence = changed.evidence.find((e) => e.id === record.references[0]);
  const source = changed.sources.find((s) => s.id === oldEvidence.source_id);
  const originalSource = { ...source, id: 'test-original-source', acquisition: 'manual_original' };
  const originalEvidence = {
    ...oldEvidence,
    id: 'ev-0000000000000000',
    source_id: originalSource.id,
  };
  // Synthetic review metadata is confined to this in-memory validation fixture.
  changed.sources.push(originalSource);
  changed.evidence.push(originalEvidence);
  Object.assign(record, {
    verification_status: 'verified',
    missing_fields: [],
    reviewed_by: 'Test reviewer',
    reviewed_at: '2026-11-14',
    references: [...record.references, originalEvidence.id],
  });
  assert.deepEqual(validateDataset(changed).errors, []);
});
test('upgrade cycles fail before publication', () => {
  const changed = structuredClone(data);
  const a = changed.recipes.find(
    (r) =>
      r.operation === 'craft' &&
      changed.items.find((i) => i.id === r.item_id).name_en === 'Knife P',
  );
  const knife = changed.items.find((i) => i.name_en === 'Knife');
  a.operation = 'upgrade';
  a.from_item_id = knife.id;
  assert.ok(validateDataset(changed).errors.some((e) => e.includes('cycle')));
});
test('identity keeps game suffixes; translations cannot merge source records', () => {
  assert.notEqual(idFor('m', 'Armor+'), idFor('m', 'Armor'));
  assert.notEqual(idFor('i', 'Knife II'), idFor('i', 'Knife EX'));
  const changed = structuredClone(data);
  changed.translations[0].name_en = 'Different item';
  assert.ok(validateDataset(changed).errors.some((e) => e.includes('English name mismatch')));
});
test('conflicting imports return a reviewable diff and preserve existing facts', () => {
  const original = structuredClone(data);
  const changed = { ...data.items[0], rank: 14 };
  changed.name_en += ' conflicting';
  const result = mergeDataset(data, { items: [changed] });
  assert.equal(result.conflicts.length, 1);
  assert.deepEqual(data, original);
  assert.deepEqual(result.dataset.items, original.items);
});
test('translation preparation preserves confirmed editorial choices', async () => {
  const changed = structuredClone(data);
  changed.translations[0] = {
    ...changed.translations[0],
    name_ru: 'Проверенный вариант',
    status: 'verified',
    source: 'editorial-review',
    reviewed_by: 'Editor',
    references: [changed.materials[0].references[0]],
  };
  const prepared = await prepareTranslations(changed);
  assert.deepEqual(
    prepared.find((t) => t.id === changed.translations[0].id),
    changed.translations[0],
  );
});

test('game import preserves legacy IDs and leaves mission and drop facts untouched', async () => {
  const seed=(await createSeed()).dataset;
  for(const collection of ['materials','items','recipes']) for(const row of seed[collection]) assert.ok(data[collection].some((r)=>r.id===row.id));
  for(const collection of ['missions','aragami','locations','drops']) assert.deepEqual(data[collection],seed[collection]);
  assert.ok(data.sources.some((s)=>s.acquisition==='game_files'&&s.app_id==='460870'));
});
test('game recipe corrections use the existing Pixie Elastomer ID and retain unresolved Wiki data',()=>{
  const target=data.items.find((r)=>r.name_en==='Dama de Ferro II');
  const recipe=data.recipes.find((r)=>r.item_id===target.id);
  const pixie=data.materials.find((r)=>r.name_en==='Pixie Elastomer');
  const legacy=data.materials.find((r)=>r.name_en==='Elastomer');
  assert.ok(recipe.materials.some((r)=>r.material_id===pixie.id));
  assert.ok(!recipe.materials.some((r)=>r.material_id===legacy.id));
  assert.ok(legacy.missing_fields.includes('native_identity'));
  assert.equal(recipe.game_origin.row_id,942);
});
