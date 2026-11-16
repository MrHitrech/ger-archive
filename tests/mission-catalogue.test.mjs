import test from 'node:test';
import assert from 'node:assert/strict';
import { readDataset } from '../scripts/lib/files.mjs';
import {
  missionCatalogueDrafts,
  MISSION_CATALOGUE_VERSION,
} from '../scripts/lib/mission-catalogue.mjs';
import { validateDataset } from '../scripts/lib/validate.mjs';

function row(id, type = 0) {
  const b = Buffer.alloc(312);
  b.writeUInt16LE(id);
  b.writeUInt16LE(1800, 2);
  b[4] = type;
  b[6] = 3;
  return {
    id,
    name: 'Fixture Mission',
    rank: 3,
    description: 'Defeat the target Aragami.',
    context: ['Fixture Location'],
    raw_hex: b.toString('hex'),
    rewards: [{ slot: 0, article_id: 10001, rate_percent: 100, condition_code: 0 }],
  };
}
function fixture() {
  return {
    current: {
      missions: [],
      evidence: [],
      locations: [{ id: 'location', name_en: 'Fixture Location' }],
      aragami: [{ id: 'enemy' }],
    },
    exported: {
      manifest: { mission_bundles: [{ native_id: 20042 }] },
      decoded: {
        mission_en: [row(42), row(20042), { ...row(20377, 3), name: 'Fixture Urgent' }],
        mission_042_base_en: [
          {
            id: 2,
            en_base_family_id: 3,
            en_base_display_name: 'Ogretail',
            en_base_res_name: 'MS_101N_ouga',
          },
        ],
        mission_042_quest: [
          { quest_flow_enemy_entry_class_id: 2, quest_flow_enemy_entry_number: 1 },
        ],
        mission_042_entries: [],
      },
    },
    options: {
      scope: {
        game: 'ger',
        app_id: '460870',
        format_version: 1,
        native_type_code: 0,
        ranks: [3],
        expected_counts: { 3: 1 },
      },
      aragamiMappings: [
        { family_id: 3, native_name: 'Ogretail', res_name: 'MS_101N_ouga', site_id: 'enemy' },
      ],
    },
  };
}
test('native ordinary catalogue merges story/free resources and excludes urgent missions', () => {
  const f = fixture(),
    before = structuredClone(f.current),
    result = missionCatalogueDrafts(f.current, f.exported, f.options);
  assert.deepEqual(f.current, before);
  assert.equal(result.additions.length, 1);
  assert.deepEqual(result.report.coverage[0].excluded_urgent_rows, [20377]);
  const m = result.additions[0];
  assert.equal(m.type, 'standard');
  assert.equal(m.time_limit_seconds, 1800);
  assert.equal(m.objectives_en, 'Defeat the target Aragami.');
  assert.deepEqual(m.aragami_ids, ['enemy']);
  f.current.missions = [
    { ...m, id: 'preserved-site-id', game_origin: { resource: 'mission_en', row_id: 20042 } },
  ];
  assert.equal(missionCatalogueDrafts(f.current, f.exported, f.options).additions.length, 0);
  assert.equal(f.current.missions[0].id, 'preserved-site-id');
});
test('catalogue stops on inconsistent native variants, missing bundles or unknown enemy variants', () => {
  for (const change of [
    (f) => {
      f.exported.decoded.mission_en[0].rewards[0].rate_percent = 99;
    },
    (f) => {
      f.exported.manifest.mission_bundles = [];
    },
    (f) => {
      f.options.aragamiMappings[0].res_name = 'Different enemy';
    },
    (f) => {
      f.options.scope.expected_counts[3] = 24;
    },
  ]) {
    const f = fixture();
    change(f);
    assert.throws(() => missionCatalogueDrafts(f.current, f.exported, f.options));
  }
});

const data = await readDataset();
test('difficulty 3 has all 24 ordinary missions and difficulty 4 has all 21', () => {
  assert.equal(data.missions.filter((m) => m.rank === 3 && m.type === 'standard').length, 24);
  assert.equal(data.missions.filter((m) => m.rank === 4 && m.type === 'standard').length, 21);
  const names = [
    'Rusted Edge',
    'Black Trojan',
    'Red Antares',
    "Winter's Dawn",
    'Flame Shield',
    'Iron Blizzard',
    'Tyrant Breath',
    'Monkey Guts',
    'Salty Dog',
    'Snow Mouse',
    'Scarlet Charger',
    'Picnic Fields',
    'Rabbit Hunt',
    'Symbol of Swords',
  ];
  for (const name of names) {
    const matches = data.missions.filter((m) => m.name_en === name);
    assert.equal(matches.length, 1, name);
    const m = matches[0],
      translation = data.translations.find((t) => t.id === m.id);
    assert.ok(/[\u0400-\u04ff]/u.test(translation?.name_ru ?? ''));
    assert.ok(
      m.references.some((ref) =>
        data.evidence.find((e) => e.id === ref)?.excerpt.includes(MISSION_CATALOGUE_VERSION),
      ),
    );
    assert.ok(m.aragami_ids.length > 0);
    assert.ok(m.time_limit_seconds > 0);
    assert.ok(data.drops.some((d) => d.mission_id === m.id && d.method === 'mission_reward'));
    assert.ok(data.drops.some((d) => d.mission_id === m.id && d.method === 'gather'));
  }
});
test('new mission descriptions, time limits and enemy lists are checked against source evidence', () => {
  const target = data.missions.find((m) => m.name_en === 'Symbol of Swords');
  for (const mutate of [
    (m) => {
      m.time_limit_seconds++;
    },
    (m) => {
      m.objectives_en = 'Unproven objective';
    },
    (m) => {
      m.aragami_ids = [];
    },
    (m) => {
      m.type = 'urgent';
    },
  ]) {
    const d = structuredClone(data);
    mutate(d.missions.find((m) => m.id === target.id));
    assert.ok(validateDataset(d).errors.length);
  }
});
