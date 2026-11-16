import { parseTr2 } from './game-formats.mjs';

export function missionBundlePaths(entry) {
  const base = entry.native_id >= 20000 ? entry.native_id - 20000 : entry.native_id;
  const prefix = `mission_${String(base).padStart(3, '0')}`;
  if (
    !new RegExp(`^${String(base).padStart(3, '0')}_[A-Za-z0-9_]+$`).test(entry.folder) ||
    entry.container_path !== `bin/resconv_pc/src/god_g000_Mission/${entry.folder}.res`
  )
    throw new Error('Invalid mission resource mapping');
  const paths = {};
  for (const lang of ['en', 'ru']) {
    paths[`${prefix}_base_${lang}`] =
      `data/Locale/exported/${lang}/data-GameData-mission-${entry.folder}-db-enemy-Tr2-en_base.tr2`;
    paths[`${prefix}_parts_${lang}`] =
      `data/Locale/exported/${lang}/data-GameData-mission-${entry.folder}-db-enemy-Tr2-en_trig_group.tr2`;
  }
  for (const [key, directory, table] of [
    ['materials', 'enemy', 'en_mat'],
    ['dig', 'dig', 'dig'],
    ['quest', 'quest', 'quest_flow'],
    ['entries', 'enemy_entry', 'enemy_entry_table'],
  ])
    paths[`${prefix}_${key}`] =
      `data/GameData/mission/${entry.folder}/db/${directory}/Tr2/${table}.tr2`;
  return paths;
}

export function decodeMissionTable(key, bytes) {
  const match = key.match(
    /^mission_\d+_(base_(?:en|ru)|parts_(?:en|ru)|materials|dig|quest|entries)$/,
  );
  if (!match) throw new Error(`Unknown mission table ${key}`);
  const expected = {
    base: 'en_base',
    parts: 'en_trig_group',
    materials: 'en_mat',
    dig: 'dig',
    quest: 'quest_flow',
    entries: 'enemy_entry_table',
  }[match[1].split('_')[0]];
  const selectedFields = {
    en_base: [
      'en_base_display_name',
      'en_base_family_id',
      'en_base_res_name',
      'en_base_material_acquirable_count',
      'en_base_append_material_id',
      'en_base_append_material_weight',
    ],
    en_trig_group: [
      'en_trig_group_enemy_class_id',
      'en_trig_group_display_name',
      'en_trig_group_mat_id_array',
      'en_trig_group_weight_group_id_array',
      'en_trig_group_break_count',
    ],
    en_mat: ['en_mat_enemy_class_id', 'en_mat_article_id', 'en_mat_wait'],
    dig: ['dig_volume_name', 'dig_id_array', 'dig_weight_array'],
    quest_flow: [
      'quest_flow_enemy_entry_class_id',
      'quest_flow_enemy_entry_number',
      'quest_flow_is_mission_goal',
    ],
    enemy_entry_table: [
      'ENEMY_ENTRY_MAX_COUNT',
      'ENEMY_ENTRY_ENEMY0_ID',
      'ENEMY_ENTRY_ENEMY0_PER',
      'ENEMY_ENTRY_ENEMY1_ID',
      'ENEMY_ENTRY_ENEMY1_PER',
    ],
  }[expected];
  const table = parseTr2(bytes, { selectedFields });
  if (table.name !== expected) throw new Error(`Unexpected mission table: ${table.name}`);
  return table.rows;
}
