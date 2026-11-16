import test from 'node:test';
import assert from 'node:assert/strict';
import { readDataset } from '../scripts/lib/files.mjs';
import { activeEnemyClasses, weightedEntries } from '../scripts/lib/field-acquisition.mjs';
import { validateDataset } from '../scripts/lib/validate.mjs';
import { decodeRussianMissionName } from '../scripts/lib/mission-conditions.mjs';

const data = await readDataset();
test('TR2 scalar and array pools retain raw weights including totals other than 100', () => {
  assert.deepEqual(weightedEntries(10001, 100), [{ id: 10001, slot: 0, weight: 100, total: 100 }]);
  assert.deepEqual(weightedEntries([10001, 10002], [33, 33]), [
    { id: 10001, slot: 0, weight: 33, total: 66 },
    { id: 10002, slot: 1, weight: 33, total: 66 },
  ]);
  assert.deepEqual(weightedEntries(null, null), []);
  assert.throws(() => weightedEntries([10001, 10002], [100]), /Invalid/);
  assert.throws(() => weightedEntries([10001], [-1]), /Invalid/);
});
test('enemy pools require an actual quest or random-entry spawn', () => {
  assert.deepEqual(
    [
      ...activeEnemyClasses(
        [
          { quest_flow_enemy_entry_class_id: 2, quest_flow_enemy_entry_number: 1 },
          { quest_flow_enemy_entry_class_id: 3, quest_flow_enemy_entry_number: 0 },
        ],
        [
          {
            ENEMY_ENTRY_MAX_COUNT: 2,
            ENEMY_ENTRY_ENEMY0_ID: 4,
            ENEMY_ENTRY_ENEMY0_PER: 20,
            ENEMY_ENTRY_ENEMY1_ID: 5,
            ENEMY_ENTRY_ENEMY1_PER: 0,
          },
        ],
      ),
    ],
    [2, 4],
  );
});
test('all catalogue missions have readable Russian translations linked by native IDs', () => {
  assert.equal(data.missions.length, 245);
  for (const mission of data.missions) {
    const translation = data.translations.find((t) => t.id === mission.id);
    assert.ok(translation?.name_ru, mission.name_en);
    assert.equal(decodeRussianMissionName(translation.name_ru), translation.name_ru);
    assert.ok(mission.game_origin);
  }
  assert.throws(() => decodeRussianMissionName('Неверная\u000eстрока'), /Unreadable/);
});
test('part, devour and gather contexts are distinct and weights never silently become drop rates', () => {
  for (const method of ['break', 'devour', 'gather']) {
    const rows = data.drops.filter((d) => d.method === method);
    assert.ok(rows.length > 100, method);
    assert.ok(
      rows.every(
        (d) => d.drop_rate === null && d.pool_weight > 0 && d.pool_total_weight >= d.pool_weight,
      ),
    );
    if (method === 'break') assert.ok(rows.every((d) => d.part_en && d.part_ru && d.aragami_id));
  }
  const mission = data.missions.find((m) => m.name_en === 'Kongou Giant');
  const kongou = data.aragami.find((a) => a.name_en === 'Kongou');
  const tail = data.drops.filter(
    (d) =>
      d.mission_id === mission.id &&
      d.aragami_id === kongou.id &&
      d.method === 'break' &&
      d.part_en === 'Tail',
  );
  assert.deepEqual(
    tail.map((d) => d.pool_weight).sort((a, b) => a - b),
    [18, 82],
  );
});
test('native validation rejects changed body parts, enemy variants, weights and invented percentages', () => {
  for (const mutate of [
    (d) => {
      d.drops.find((d) => d.method === 'break').part_en = 'Other part';
    },
    (d) => {
      d.drops.find((d) => d.method === 'break').pool_weight++;
    },
    (d) => {
      d.drops.find((d) => d.method === 'devour').pool_total_weight++;
    },
    (d) => {
      d.drops.find((d) => d.method === 'gather').drop_rate = 33;
    },
    (d) => {
      d.drops.find((d) => d.method === 'break').aragami_id = d.aragami.find(
        (a) => a.name_en === 'Zygote',
      ).id;
    },
  ]) {
    const changed = structuredClone(data);
    mutate(changed);
    assert.ok(validateDataset(changed).errors.length);
  }
});
