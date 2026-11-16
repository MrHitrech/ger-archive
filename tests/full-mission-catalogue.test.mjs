import test from 'node:test';
import assert from 'node:assert/strict';
import { readDataset, readJson, dataDir } from '../scripts/lib/files.mjs';
import {
  fullMissionCatalogueDrafts,
  survivalStage,
} from '../scripts/lib/full-mission-catalogue.mjs';
import { validateDataset, qualityReport } from '../scripts/lib/validate.mjs';
import {
  isMissionRoot,
  matchesMissionRank,
  matchesMissionType,
  missionPhases,
} from '../src/lib/missions.ts';

const data = await readDataset();
const scope = await readJson(`${dataDir}/import-mappings/game-mission-catalogue.json`);
const expectedOrdinary = [7, 18, 24, 21, 23, 28, 28, 22, 23, 21, 12, 11, 14, 81];
test('every difficulty covers all native mission keys and each player mission is counted once', () => {
  assert.deepEqual(
    data.missions.map((m) => m.game_origin.row_id).sort((a, b) => a - b),
    scope.expected_native_ids,
  );
  assert.equal(data.missions.length, 384);
  assert.equal(data.missions.filter(isMissionRoot).length, 363);
  for (let rank = 1; rank <= 14; rank++) {
    const missions = data.missions.filter((m) => m.rank === rank);
    assert.equal(
      missions.filter((m) => isMissionRoot(m) && matchesMissionType(m, '')).length,
      expectedOrdinary[rank - 1],
      `ordinary rank ${rank}`,
    );
    for (const [kind, type] of [
      [0, 'ordinary'],
      [3, 'urgent'],
      [4, 'extra'],
    ]) {
      assert.equal(
        missions.filter((m) =>
          kind === 0 ? ['standard', 'tutorial', 'challenge'].includes(m.type) : m.type === type,
        ).length,
        scope.expected_counts[rank][kind],
        `${rank}/${kind}`,
      );
    }
  }
  for (const m of data.missions)
    assert.ok(
      data.translations.some((t) => t.id === m.id && /[\u0400-\u04ff]/u.test(t.name_ru ?? '')),
      m.name_en,
    );
  const coverage = qualityReport(data).coverage.missions;
  assert.equal(coverage.total, 363);
  assert.equal(coverage.records_total, 384);
  assert.equal(coverage.missing_from_universe, 0);
});

test('Drosera and all three trainings have native names and the correct targets', () => {
  const drosera = data.missions.find((m) => m.game_origin.row_id === 20082);
  assert.equal(drosera.rank, 5);
  assert.equal(data.translations.find((t) => t.id === drosera.id).name_ru, 'Росянка');
  for (const [native, rank, title] of [
    [20016, 1, 'Обучение 1'],
    [20017, 1, 'Обучение 2'],
    [20156, 2, 'Практическое обучение'],
  ]) {
    const m = data.missions.find((m) => m.game_origin.row_id === native);
    assert.equal(m.type, 'tutorial');
    assert.equal(m.rank, rank);
    assert.deepEqual(m.aragami_ids, []);
    assert.equal(data.translations.find((t) => t.id === m.id).name_ru, title);
    assert.equal(data.locations.find((l) => l.id === m.location_id).name_en, 'Training Grounds');
    assert.ok(
      !data.drops.some((d) => d.mission_id === m.id && ['break', 'devour'].includes(d.method)),
    );
  }
  assert.ok(data.aragami.some((a) => a.name_en === 'Heavenly Father'));
});

test('survival chains keep stage rewards and reversed native IDs in the correct order', () => {
  const root = data.missions.find((m) => m.game_origin.row_id === 20432);
  const phases = missionPhases(root, data.missions);
  assert.deepEqual(
    phases.map((m) => m.game_origin.row_id),
    [20432, 20431, 20430],
  );
  for (const phase of phases) {
    assert.equal(phase.phase_count, 3);
    assert.deepEqual(
      missionPhases(phase, data.missions).map((m) => m.id),
      phases.map((m) => m.id),
    );
    assert.ok(data.drops.some((d) => d.mission_id === phase.id));
  }
  assert.equal(data.missions.filter((m) => m.phase_index === 1).length, 13);
  assert.equal(data.missions.filter((m) => m.parent_mission_id).length, 21);
  assert.ok(matchesMissionRank(root, '14'));
  assert.ok(
    data.missions
      .filter((m) => m.type === 'challenge')
      .every((m) => matchesMissionRank(m, 'challenge') && m.rank === 14),
  );
  assert.deepEqual(
    survivalStage({ id: 20431, name: 'Spiritus 2', context: ['Survival Phase 2/3'] }),
    { index: 2, count: 3, name: 'Spiritus' },
  );
});

test('missing missions, altered rank/type, broken survival links and training targets block publication', () => {
  for (const mutate of [
    (d) => {
      d.missions = d.missions.filter((m) => m.game_origin.row_id !== 20082);
    },
    (d) => {
      d.missions.find((m) => m.game_origin.row_id === 20082).type = 'extra';
    },
    (d) => {
      d.missions.find((m) => m.type === 'challenge').rank = 'challenge';
    },
    (d) => {
      d.missions.find((m) => m.game_origin.row_id === 20431).parent_mission_id = null;
    },
    (d) => {
      d.missions.find((m) => m.game_origin.row_id === 20016).aragami_ids = [d.aragami[0].id];
    },
    (d) => {
      d.translations.find(
        (t) => t.id === d.locations.find((l) => l.name_en === 'Training Grounds').id,
      ).name_ru = 'Неизвестная локация';
    },
  ]) {
    const changed = structuredClone(data);
    mutate(changed);
    assert.ok(validateDataset(changed).errors.length);
  }
});

test('full catalogue rejects changed universes before importing unsupported records', () => {
  assert.throws(
    () =>
      fullMissionCatalogueDrafts(
        { missions: [], evidence: [], locations: [], aragami: [] },
        { manifest: {}, decoded: { mission_en: [] } },
        { scope },
      ),
    /universe changed/,
  );
});

test('v2 import derives reversed stage chains, preserves IDs and excludes training props', () => {
  function native(id, name, rank, kind, context = []) {
    const bytes = Buffer.alloc(312);
    bytes.writeUInt16LE(id);
    bytes.writeUInt16LE(1800, 2);
    bytes[4] = kind;
    bytes[6] = rank;
    return {
      id,
      name,
      rank,
      raw_hex: bytes.toString('hex'),
      description: 'Fixture mission objective.',
      rewards: [],
      context: ['Fixture Location', ...context],
    };
  }
  const nativeRows = [
    native(16, 'Tutorial 1', 1, 0),
    native(20016, 'Tutorial 1', 1, 0),
    ...[1, 2, 3].map((i) =>
      native(20433 - i, `Spiritus${i === 1 ? '' : ` ${i}`}`, 14, 4, [`Survival Phase ${i}/3`]),
    ),
  ];
  const fixtureScope = {
    game: 'ger',
    app_id: '460870',
    format_version: 2,
    expected_native_row_count: 5,
    ranks: [1, 14],
    native_type_codes: [0, 3, 4],
    expected_native_ids: [20016, 20430, 20431, 20432],
    expected_root_count: 2,
    expected_counts: { 1: { 0: 1, 3: 0, 4: 0 }, 14: { 0: 0, 3: 0, 4: 3 } },
    tutorial_native_ids: [20016],
    training_location: { name_en: 'Fixture Location' },
    non_aragami_targets: [{ family_id: 3, native_name: 'Move Target', res_name: 'target' }],
  };
  const exported = {
    manifest: {
      mission_bundles: fixtureScope.expected_native_ids.map((native_id) => ({ native_id })),
    },
    decoded: { mission_en: nativeRows },
  };
  for (const id of fixtureScope.expected_native_ids) {
    const prefix = `mission_${String(id - 20000).padStart(3, '0')}`;
    const base = {
      id: 1,
      en_base_family_id: id === 20016 ? 3 : 1,
      en_base_display_name: id === 20016 ? 'Move Target' : 'Vajra',
      en_base_res_name: id === 20016 ? 'target' : 'tora',
    };
    exported.decoded[`${prefix}_base_en`] = [base];
    exported.decoded[`${prefix}_base_ru`] = [base];
    exported.decoded[`${prefix}_quest`] = [
      { id: 1, quest_flow_enemy_entry_number: 1, quest_flow_enemy_entry_class_id: 1 },
    ];
    exported.decoded[`${prefix}_entries`] = [];
  }
  const current = {
    missions: [
      {
        id: 'preserved-tutorial-id',
        name_en: 'Tutorial 1',
        game_origin: { resource: 'mission_en', row_id: 20016 },
        location_id: 'location',
        rank: 1,
        type: 'tutorial',
        references: [],
      },
    ],
    locations: [{ id: 'location', name_en: 'Fixture Location' }],
    aragami: [{ id: 'enemy' }],
    evidence: [],
  };
  const options = {
    scope: fixtureScope,
    aragamiMappings: [{ family_id: 1, native_name: 'Vajra', res_name: 'tora', site_id: 'enemy' }],
  };
  const first = fullMissionCatalogueDrafts(current, exported, options);
  assert.equal(first.additions.length, 3);
  assert.equal(first.updates.length, 0);
  const root = first.additions.find((m) => m.phase_index === 1);
  assert.deepEqual(
    first.additions.filter((m) => m.parent_mission_id).map((m) => m.parent_mission_id),
    [root.id, root.id],
  );
  assert.ok(first.additions.every((m) => m.aragami_ids[0] === 'enemy'));
  assert.equal(first.report.coverage.find((r) => r.rank === 1).ordinary, 1);
  current.missions.push(
    ...first.additions.map((m) => ({
      ...m,
      game_origin: {
        resource: 'mission_en',
        row_id: nativeRows.find((r) => r.name === m.name_en).id,
      },
    })),
  );
  const again = fullMissionCatalogueDrafts(current, exported, options);
  assert.deepEqual(again.additions, []);
  assert.deepEqual(again.updates, []);
  assert.equal(current.missions[0].id, 'preserved-tutorial-id');
  exported.decoded.mission_432_base_en[0].en_base_res_name = 'unknown-variant';
  assert.throws(() => fullMissionCatalogueDrafts(current, exported, options), /Unmapped enemy/);
});
