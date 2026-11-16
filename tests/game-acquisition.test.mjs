import test from 'node:test';
import assert from 'node:assert/strict';
import { readDataset } from '../scripts/lib/files.mjs';
import { decodeArticleElements, ARTICLE_ELEMENTS_DECODER } from '../scripts/lib/game-elements.mjs';
import { createMissionRewardImport, missionRewardFields } from '../scripts/lib/mission-rewards.mjs';
import { validateDataset } from '../scripts/lib/validate.mjs';

const data = await readDataset();
function article(category_code, values) {
  const b = Buffer.alloc(76);
  b.writeUInt16LE(12345);
  b.writeUInt16LE(category_code, 2);
  values.forEach((v, i) => b.writeInt16LE(v, 38 + i * 2));
  return { id: 12345, category_code, raw_hex: b.toString('hex') };
}
test('element decoding respects melee, gun, shield and clothing baselines', () => {
  assert.deepEqual(decodeArticleElements(article(14, [0, 1, 0, 2])).elements, ['freeze', 'divine']);
  assert.deepEqual(decodeArticleElements(article(15, [2, 3, 3, 4])).elements, ['divine']);
  assert.deepEqual(decodeArticleElements(article(16, [2, 2, 3, 4])).elements, ['spark', 'divine']);
  assert.deepEqual(decodeArticleElements(article(12, [0, 0, 0, 0])).elements, []);
  assert.throws(() => decodeArticleElements(article(15, [0, 3, 3, 3])), /Unsupported/);
  assert.throws(
    () => decodeArticleElements({ ...article(14, [0, 0, 0, 1]), id: 12346 }),
    /identity/,
  );
});

function missionRow(id = 24, name = 'Fixture Mission') {
  const b = Buffer.alloc(312);
  b.writeUInt16LE(id);
  b[6] = 1;
  const entries = [
    [-35, 100, 0],
    [13508, 25, 0],
    [13508, 25, 0],
    [13508, 100, 4],
    [42, 50, 0],
  ];
  entries.forEach(([article, rate, condition], slot) => {
    b.writeInt16LE(article, 28 + slot * 2);
    b[92 + slot] = rate;
    b[124 + slot] = condition;
  });
  return {
    id,
    name,
    context: ['Fixture Location'],
    raw_hex: b.toString('hex'),
    record_offset: 2048,
    ...missionRewardFields(b.toString('hex'), id),
  };
}
function fixture() {
  const current = Object.fromEntries(
    [
      'materials',
      'items',
      'recipes',
      'missions',
      'aragami',
      'locations',
      'drops',
      'sources',
      'evidence',
      'translations',
    ].map((k) => [k, []]),
  );
  current.materials = [
    {
      id: 'material',
      name_en: 'Fixture Material',
      game_origin: { resource: 'article_en', row_id: 13508 },
    },
  ];
  current.locations = [{ id: 'location', name_en: 'Fixture Location' }];
  current.missions = [
    {
      id: 'mission',
      name_en: 'Fixture Mission',
      rank: 1,
      location_id: 'location',
      references: [],
      missing_fields: ['rewards'],
    },
  ];
  current.drops = [
    {
      id: 'legacy-reward',
      mission_id: 'mission',
      material_id: 'material',
      method: 'mission_reward',
      drop_rate: null,
      references: ['legacy-proof'],
    },
  ];
  return {
    current,
    exported: {
      manifest: {
        app_id: '460870',
        build_id: '1',
        archives: [],
        resources: { mission_en: { sha256: 'a'.repeat(64), resource_path: 'fixture/mission.kst' } },
      },
      decoded: { mission_en: [missionRow(24), missionRow(20024)] },
    },
  };
}
test('mission fields decode signed currency IDs, separate percentages and condition codes', () => {
  const row = missionRow();
  assert.deepEqual(
    row.rewards.slice(0, 4).map((r) => [r.article_id, r.rate_percent, r.condition_code]),
    [
      [-35, 100, 0],
      [13508, 25, 0],
      [13508, 25, 0],
      [13508, 100, 4],
    ],
  );
  const broken = Buffer.from(row.raw_hex, 'hex');
  broken[93] = 101;
  assert.throws(() => missionRewardFields(broken.toString('hex'), 24), /percentage/);
  assert.throws(() => missionRewardFields(row.raw_hex, 25), /key/);
});
test('mission import preserves IDs and imports automatic material positions without summing duplicates', () => {
  const { current, exported } = fixture(),
    before = structuredClone(current);
  const first = createMissionRewardImport(current, exported, { checkedAt: '2026-11-16' });
  assert.deepEqual(current, before);
  assert.equal(first.dataset.drops.length, 2);
  assert.ok(
    first.dataset.drops.some(
      (d) => d.id === 'legacy-reward' && d.references.includes('legacy-proof'),
    ),
  );
  assert.deepEqual(
    first.dataset.drops.map((d) => d.drop_rate),
    [25, 25],
  );
  assert.ok(
    first.dataset.drops.every((d) => d.quantity === null && d.game_origin.row_id === 20024),
  );
  assert.equal(first.report.skipped_bonus_slots, 1);
  assert.equal(first.report.skipped_non_material_slots, 2);
  const repeat = createMissionRewardImport(first.dataset, exported, { checkedAt: '2026-11-16' });
  assert.deepEqual(repeat.dataset, first.dataset);
  assert.deepEqual(repeat.snapshots, first.snapshots);
});
test('ambiguous mission variants and mismatching ranks or locations receive no automatic rewards', () => {
  for (const change of [
    (f) => {
      f.exported.decoded.mission_en[0].rewards[1].rate_percent = 26;
    },
    (f) => {
      f.current.missions[0].rank = 2;
    },
    (f) => {
      f.current.locations[0].name_en = 'Other Location';
    },
  ]) {
    const f = fixture();
    change(f);
    const result = createMissionRewardImport(f.current, f.exported, { checkedAt: '2026-11-16' });
    assert.equal(result.report.matched_missions, 0);
    assert.deepEqual(result.dataset.drops, f.current.drops);
    assert.ok(result.issues.some((i) => i.code === 'GAME_MISSION_UNMATCHED'));
  }
});
test('published element coverage and native reward percentages are checked against raw evidence', () => {
  assert.equal(data.items.filter((i) => i.missing_fields.includes('elements')).length, 0);
  const immunity = data.items.find((i) => i.name_en === 'Immunity Buckler');
  assert.deepEqual(immunity.elements, ['blaze', 'freeze', 'spark', 'divine']);
  const light = data.items.filter((i) => i.elements.includes('divine'));
  assert.ok(light.length > 200);
  assert.ok(data.evidence.some((e) => e.excerpt.includes(ARTICLE_ELEMENTS_DECODER)));
  const nativeDrops = data.drops.filter((d) => d.game_origin?.resource === 'mission_en');
  assert.equal(nativeDrops.length, 3390);
  assert.equal(new Set(nativeDrops.map((d) => d.material_id)).size, 544);
  for (const mutate of [
    (d) => {
      d.items.find((i) => i.elements.includes('divine')).elements = [];
    },
    (d) => {
      d.drops.find((i) => i.game_origin).drop_rate = 99;
    },
    (d) => {
      d.drops.find((i) => i.game_origin).game_origin.slot = 31;
    },
    (d) => {
      d.drops.find((i) => i.game_origin).quantity = 1;
    },
  ]) {
    const changed = structuredClone(data);
    mutate(changed);
    assert.ok(validateDataset(changed).errors.length);
  }
});
