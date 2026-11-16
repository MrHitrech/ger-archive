import { hash, idFor } from './files.mjs';
import { missionBundlePaths } from './mission-resources.mjs';

export const FIELD_ACQUISITION_DECODER = 'ger-field-acquisition-v1';
export const asArray = (value) => (Array.isArray(value) ? value : value == null ? [] : [value]);
const unique = (values) => [...new Set(values)];
export function activeEnemyClasses(quest, entries) {
  const active = new Set(
    quest
      .filter((r) => r.quest_flow_enemy_entry_number > 0)
      .map((r) => r.quest_flow_enemy_entry_class_id),
  );
  for (const row of entries)
    if (row.ENEMY_ENTRY_MAX_COUNT > 0)
      for (const i of [0, 1])
        if (row[`ENEMY_ENTRY_ENEMY${i}_PER`] > 0) active.add(row[`ENEMY_ENTRY_ENEMY${i}_ID`]);
  return active;
}
export function weightedEntries(ids, weights) {
  const items = asArray(ids),
    values = asArray(weights);
  if (items.length !== values.length || values.some((v) => !Number.isSafeInteger(v) || v < 0))
    throw new Error('Invalid weighted material pool');
  const total = values.reduce((a, b) => a + b, 0);
  return items
    .map((id, slot) => ({ id, slot, weight: values[slot], total }))
    .filter((r) => r.id > 0 && r.weight > 0 && r.total > 0);
}

export function validateFieldAcquisition(drop, index, mappings) {
  try {
    const evidence = drop.references.map((ref) => index.evidence.get(ref));
    const own = evidence.find(
      (e) => JSON.stringify(e?.game_origin) === JSON.stringify(drop.game_origin),
    );
    const facts = JSON.parse(own?.excerpt ?? '{}'),
      row = facts.row;
    const match = drop.game_origin.resource.match(/^(mission_\d+)_(parts_en|materials|dig)$/);
    if (!match || facts.decoder !== FIELD_ACQUISITION_DECODER || row.id !== drop.game_origin.row_id)
      throw Error('Unknown field acquisition proof');
    const prefix = match[1],
      mission = index.missions.get(drop.mission_id);
    if (prefix !== `mission_${String(mission?.game_origin?.row_id % 20000).padStart(3, '0')}`)
      throw Error('Field acquisition mission mismatch');
    if (
      drop.drop_rate !== null ||
      drop.quantity !== null ||
      !drop.missing_fields.includes('drop_rate') ||
      !drop.missing_fields.includes('weight_selection_model')
    )
      throw Error('Raw weights cannot be asserted as percentages');
    const material = index.materials.get(drop.material_id)?.game_origin?.row_id;
    const related = (suffix, id) =>
      evidence
        .filter(
          (e) => e?.game_origin?.resource === `${prefix}_${suffix}` && e.game_origin.row_id === id,
        )
        .map((e) => JSON.parse(e.excerpt))
        .find((f) => f.decoder === FIELD_ACQUISITION_DECODER)?.row;
    let pool, enemyClass;
    if (match[2] === 'dig') {
      if (
        drop.method !== 'gather' ||
        drop.aragami_id !== null ||
        drop.part_en !== null ||
        drop.part_ru !== null
      )
        throw Error('Gather category/context mismatch');
      pool = weightedEntries(row.dig_id_array, row.dig_weight_array).find(
        (r) => r.slot === drop.game_origin.slot,
      );
      if (drop.condition_en !== `Gather at ${row.dig_volume_name}`)
        throw Error('Gather point mismatch');
    } else {
      enemyClass =
        match[2] === 'parts_en' ? row.en_trig_group_enemy_class_id : row.en_mat_enemy_class_id;
      const base = related('base_en', enemyClass),
        ruBase = related('base_ru', enemyClass);
      const mapping = mappings.find(
        (m) =>
          m.family_id === base?.en_base_family_id &&
          m.res_name === base.en_base_res_name &&
          m.native_name === base.en_base_display_name,
      );
      if (
        !mapping ||
        mapping.site_id !== drop.aragami_id ||
        !ruBase ||
        ruBase.en_base_family_id !== base.en_base_family_id ||
        ruBase.en_base_res_name !== base.en_base_res_name
      )
        throw Error('Enemy variant differs from native evidence');
      const spawnFacts = evidence
        .filter(
          (e) =>
            e?.game_origin?.resource === `${prefix}_quest` ||
            e?.game_origin?.resource === `${prefix}_entries`,
        )
        .map((e) => ({ resource: e.game_origin.resource, facts: JSON.parse(e.excerpt) }));
      const quest = spawnFacts
        .filter(
          (e) => e.resource.endsWith('_quest') && e.facts.decoder === FIELD_ACQUISITION_DECODER,
        )
        .map((e) => e.facts.row);
      const entries = spawnFacts
        .filter(
          (e) => e.resource.endsWith('_entries') && e.facts.decoder === FIELD_ACQUISITION_DECODER,
        )
        .map((e) => e.facts.row);
      if (!activeEnemyClasses(quest, entries).has(enemyClass)) throw Error('Inactive enemy class');
      if (match[2] === 'parts_en') {
        const ru = related('parts_ru', row.id);
        if (
          drop.method !== 'break' ||
          !ru ||
          ru.en_trig_group_enemy_class_id !== enemyClass ||
          drop.part_en !== row.en_trig_group_display_name ||
          drop.part_ru !== ru.en_trig_group_display_name ||
          JSON.stringify(asArray(ru.en_trig_group_mat_id_array)) !==
            JSON.stringify(asArray(row.en_trig_group_mat_id_array)) ||
          JSON.stringify(asArray(ru.en_trig_group_weight_group_id_array)) !==
            JSON.stringify(asArray(row.en_trig_group_weight_group_id_array))
        )
          throw Error('Broken part differs from native evidence');
        if (
          drop.condition_en !==
          `Unbound ${row.en_trig_group_display_name} / ${base.en_base_display_name}`
        )
          throw Error('Break condition mismatch');
        pool = weightedEntries(
          row.en_trig_group_mat_id_array,
          row.en_trig_group_weight_group_id_array,
        ).find((r) => r.slot === drop.game_origin.slot);
      } else {
        if (
          drop.method !== 'devour' ||
          drop.game_origin.slot !== undefined ||
          drop.part_en !== null ||
          drop.part_ru !== null
        )
          throw Error('Devour category/context mismatch');
        const poolRows = evidence
          .filter((e) => e?.game_origin?.resource === `${prefix}_materials`)
          .map((e) => JSON.parse(e.excerpt))
          .filter((f) => f.decoder === FIELD_ACQUISITION_DECODER)
          .map((f) => f.row)
          .filter((r) => r.en_mat_enemy_class_id === enemyClass);
        const uniqueRows = [...new Map(poolRows.map((r) => [r.id, r])).values()];
        const values = weightedEntries(
          uniqueRows.map((r) => r.en_mat_article_id),
          uniqueRows.map((r) => r.en_mat_wait),
        );
        const selected = uniqueRows.findIndex((r) => r.id === row.id);
        pool = values.find((r) => r.slot === selected);
        if (drop.condition_en !== `Devour defeated ${base.en_base_display_name}`)
          throw Error('Devour condition mismatch');
      }
    }
    if (
      !pool ||
      pool.id !== material ||
      drop.pool_weight !== pool.weight ||
      drop.pool_total_weight !== pool.total ||
      drop.source_url !== null
    )
      throw Error('Material pool differs from native evidence');
    return [];
  } catch (error) {
    return [`invalid field acquisition: ${error.message}`];
  }
}

/** Import named TR2 facts; weights remain separate from measured/encoded percentages. */
export function createFieldAcquisitionImport(
  current,
  { manifest, decoded },
  { checkedAt, aragamiMappings = [], nonAragamiTargets = [] },
) {
  const data = structuredClone(current),
    sourceId = `game-field-acquisition-460870-${manifest.build_id}`;
  const resources = Object.fromEntries(
    Object.entries(manifest.resources)
      .filter(([key]) => /^mission_\d+_/.test(key))
      .map(([key, value]) => [
        key,
        Object.fromEntries(Object.entries(value).filter(([k]) => k !== 'local_file')),
      ]),
  );
  const source = {
    id: sourceId,
    title: `God Eater Resurrection — раскол защиты, пожирание и сбор, Steam ${manifest.build_id}`,
    url: null,
    authors_url: null,
    game_scope: 'ger',
    acquisition: 'game_files',
    checked_at: checkedAt,
    revision: manifest.build_id,
    license: 'game_resources: no license assigned by the project',
    app_id: '460870',
    build_id: manifest.build_id,
    archives: manifest.archives,
    resources,
    note_ru:
      'Именованные поля en_trig_group, en_mat, dig, en_base и таблиц появления врагов. Веса сохранены отдельно: их доля в таблице не объявляется подтверждённой вероятностью. Неактивные классы и неоднозначные варианты не импортируются.',
  };
  const at = data.sources.findIndex((s) => s.id === sourceId);
  if (at < 0) data.sources.push(source);
  else data.sources[at] = source;
  const evidence = new Map(data.evidence.map((e) => [e.id, e]));
  const digest = hash(
    JSON.stringify(Object.entries(resources).map(([k, v]) => [k, v.sha256])),
  ).slice(0, 12);
  const snapshot = `game-${manifest.build_id}-field-acquisition-${digest}-${FIELD_ACQUISITION_DECODER}.json`;
  const rows = new Map(
    data.evidence
      .filter((e) => e.snapshot === snapshot)
      .map((e) => {
        const f = JSON.parse(e.excerpt);
        return [`${f.resource}:${f.row_id}:${f.slot ?? 'row'}`, e.excerpt];
      }),
  );
  const origins = (resource, row, slot) => ({
    source_id: sourceId,
    resource,
    row_id: row.id,
    resource_sha256: resources[resource].sha256,
    ...(slot === undefined ? {} : { slot }),
  });
  function proof(resource, row, slot) {
    const excerpt = JSON.stringify({
      resource,
      row_id: row.id,
      decoder: FIELD_ACQUISITION_DECODER,
      row,
      ...(slot === undefined ? {} : { slot }),
    });
    const id = `ev-${hash(`${sourceId}|${resources[resource].sha256}|${excerpt}`).slice(0, 16)}`;
    rows.set(`${resource}:${row.id}:${slot ?? 'row'}`, excerpt);
    evidence.set(id, {
      id,
      source_id: sourceId,
      game: 'ger',
      section: `God Eater Resurrection / ${resources[resource].resource_path} / row ${row.id}${slot === undefined ? '' : ` / slot ${slot}`}`,
      excerpt,
      snapshot,
      snapshot_sha256: '',
      game_origin: origins(resource, row, slot),
    });
    return id;
  }
  const materials = new Map(
    data.materials
      .filter((m) => m.game_origin?.resource === 'article_en')
      .map((m) => [m.game_origin.row_id, m]),
  );
  const drops = new Map(data.drops.map((d) => [d.id, d]));
  const nativeKey = (origin) => `${origin.resource}|${origin.row_id}|${origin.slot ?? 'row'}`;
  const oldNative = new Map(
    data.drops
      .filter((d) => /^mission_\d+_/.test(d.game_origin?.resource ?? ''))
      .map((d) => [nativeKey(d.game_origin), d]),
  );
  let secondaryPoolDifferences = 0;
  const issues = [],
    counts = { break: 0, devour: 0, gather: 0 },
    covered = new Set();
  function put({
    mission,
    material,
    method,
    resource,
    row,
    slot,
    pool,
    enemy = null,
    partEn = null,
    partRu = null,
    refs = [],
    conditionEn,
    conditionRu,
  }) {
    if (!material) return;
    const native = origins(resource, row, slot);
    const old = oldNative.get(nativeKey(native));
    if (old?.verification_status === 'verified') throw new Error(`Reviewed acquisition ${old.id}`);
    const id = old?.id ?? idFor('d', `steam:460870:${resource}:${row.id}:slot:${slot ?? 'row'}`);
    const ref = proof(resource, row, slot);
    const record = {
      ...(old ?? {}),
      id,
      game: 'ger',
      name_en: `${material.name_en} / ${mission.name_en} / ${method} / ${row.id}:${slot ?? 'row'}`,
      verification_status: 'partial',
      checked_at: checkedAt,
      references: unique([...(old?.references ?? []), ref, ...refs]),
      missing_fields: ['drop_rate', 'quantity', 'weight_selection_model', 'in_game_review'],
      game_origin: native,
      material_id: material.id,
      mission_id: mission.id,
      aragami_id: enemy?.site_id ?? null,
      location_id: mission.location_id,
      method,
      condition_en: conditionEn,
      condition_ru: conditionRu,
      drop_rate: null,
      quantity: null,
      slot: `${method}_${row.id}_${slot ?? 'row'}`,
      source_url: null,
      pool_weight: pool.weight,
      pool_total_weight: pool.total,
      part_en: partEn,
      part_ru: partRu,
    };
    drops.set(id, record);
    counts[method]++;
    covered.add(material.id);
  }
  for (const bundle of manifest.mission_bundles ?? []) {
    const mission = data.missions.find(
      (m) => m.game_origin?.resource === 'mission_en' && m.game_origin.row_id === bundle.native_id,
    );
    if (!mission) continue;
    const paths = missionBundlePaths(bundle),
      prefix = Object.keys(paths)[0].replace(/_base_en$/, '');
    const key = (suffix) => `${prefix}_${suffix}`,
      table = (suffix) => decoded[key(suffix)];
    if (Object.keys(paths).some((k) => !decoded[k] || !resources[k]))
      throw new Error(`Incomplete field bundle ${bundle.folder}`);
    const base = table('base_en'),
      russian = table('base_ru'),
      partsRu = table('parts_ru');
    const active = activeEnemyClasses(table('quest'), table('entries'));
    if (!active.size) {
      for (const row of table('quest')) proof(key('quest'), row);
      for (const row of table('entries')) proof(key('entries'), row);
    }
    const enemies = new Map();
    for (const row of base.filter((r) => active.has(r.id))) {
      const matches = aragamiMappings.filter(
        (m) =>
          m.family_id === row.en_base_family_id &&
          m.res_name === row.en_base_res_name &&
          m.native_name === row.en_base_display_name,
      );
      const trainingTarget =
        mission.type === 'tutorial' &&
        nonAragamiTargets.some(
          (m) =>
            m.family_id === row.en_base_family_id &&
            m.res_name === row.en_base_res_name &&
            m.native_name === row.en_base_display_name,
        );
      if (
        !trainingTarget &&
        (matches.length !== 1 || !data.aragami.some((a) => a.id === matches[0].site_id))
      ) {
        issues.push({
          code: 'GAME_ENEMY_UNMATCHED',
          source_id: sourceId,
          name: `${mission.name_en}: ${row.en_base_display_name}`,
          detail: `Класс ${row.id}, семейство ${row.en_base_family_id} не сопоставлены однозначно; добыча врага пропущена.`,
        });
        continue;
      }
      const mapping = matches[0];
      const ru = russian.find((r) => r.id === row.id);
      if (
        !ru ||
        ru.en_base_family_id !== row.en_base_family_id ||
        ru.en_base_res_name !== row.en_base_res_name
      )
        throw new Error('EN/RU enemy identity mismatch');
      const spawnRefs = [
        ...table('quest')
          .filter(
            (q) =>
              q.quest_flow_enemy_entry_number > 0 && q.quest_flow_enemy_entry_class_id === row.id,
          )
          .map((q) => proof(key('quest'), q)),
        ...table('entries')
          .filter(
            (q) =>
              q.ENEMY_ENTRY_MAX_COUNT > 0 &&
              [0, 1].some(
                (i) =>
                  q[`ENEMY_ENTRY_ENEMY${i}_ID`] === row.id && q[`ENEMY_ENTRY_ENEMY${i}_PER`] > 0,
              ),
          )
          .map((q) => proof(key('entries'), q)),
      ];
      const baseRefs = [proof(key('base_en'), row), proof(key('base_ru'), ru), ...spawnRefs];
      if (trainingTarget) continue;
      if (mapping.create_record) {
        const enemy = data.aragami.find((a) => a.id === mapping.site_id);
        Object.assign(enemy, {
          game_origin: origins(key('base_en'), row),
          checked_at: checkedAt,
          references: unique([...enemy.references, ...baseRefs]),
        });
        if (!data.translations.some((t) => t.id === enemy.id && t.name_ru)) {
          const nameRu = ru.en_base_display_name;
          if (!nameRu || /[\x00-\x1f\x7f\ufffd]/.test(nameRu))
            throw new Error('Invalid native enemy translation');
          const old = data.translations.find((t) => t.id === enemy.id);
          const translated = {
            ...(old ?? {}),
            id: enemy.id,
            name_en: enemy.name_en,
            name_ru: nameRu,
            aliases: old?.aliases ?? [],
            source: sourceId,
            status: 'unverified',
            references: unique([...(old?.references ?? []), baseRefs[1]]),
          };
          if (old) Object.assign(old, translated);
          else data.translations.push(translated);
        }
      }
      enemies.set(row.id, {
        ...mapping,
        nameEn: row.en_base_display_name,
        nameRu: ru.en_base_display_name,
        refs: baseRefs,
      });
      const pool = table('materials').filter((r) => r.en_mat_enemy_class_id === row.id);
      const weights = weightedEntries(
        pool.map((r) => r.en_mat_article_id),
        pool.map((r) => r.en_mat_wait),
      );
      // en_mat is the dedicated mission material pool. en_base's append pool is kept distinct.
      const append = weightedEntries(
        row.en_base_append_material_id,
        row.en_base_append_material_weight,
      );
      const signature = (list) =>
        JSON.stringify(
          list.map((r) => [r.id, r.weight]).sort((a, b) => a[0] - b[0] || a[1] - b[1]),
        );
      if (signature(weights) !== signature(append)) {
        secondaryPoolDifferences++;
      }
      const poolRefs = pool.map((r) => proof(key('materials'), r));
      for (const reward of weights) {
        const matRow = pool[reward.slot];
        put({
          mission,
          material: materials.get(reward.id),
          method: 'devour',
          resource: key('materials'),
          row: matRow,
          pool: reward,
          enemy: mapping,
          refs: [...enemies.get(row.id).refs, ...poolRefs],
          conditionEn: `Devour defeated ${row.en_base_display_name}`,
          conditionRu: `Пожрать поверженного арагами: ${ru.en_base_display_name}`,
        });
      }
    }
    for (const row of table('parts_en')) {
      const enemy = enemies.get(row.en_trig_group_enemy_class_id);
      if (!enemy) continue;
      const ru = partsRu.find((r) => r.id === row.id);
      if (
        !ru ||
        ru.en_trig_group_enemy_class_id !== row.en_trig_group_enemy_class_id ||
        JSON.stringify(asArray(ru.en_trig_group_mat_id_array)) !==
          JSON.stringify(asArray(row.en_trig_group_mat_id_array)) ||
        JSON.stringify(asArray(ru.en_trig_group_weight_group_id_array)) !==
          JSON.stringify(asArray(row.en_trig_group_weight_group_id_array))
      )
        throw new Error('EN/RU break reward mismatch');
      for (const reward of weightedEntries(
        row.en_trig_group_mat_id_array,
        row.en_trig_group_weight_group_id_array,
      ))
        put({
          mission,
          material: materials.get(reward.id),
          method: 'break',
          resource: key('parts_en'),
          row,
          slot: reward.slot,
          pool: reward,
          enemy,
          partEn: row.en_trig_group_display_name,
          partRu: ru.en_trig_group_display_name,
          refs: [...enemy.refs, proof(key('parts_ru'), ru)],
          conditionEn: `Unbound ${row.en_trig_group_display_name} / ${enemy.nameEn}`,
          conditionRu: `Раскол защиты: ${ru.en_trig_group_display_name} · ${enemy.nameRu}`,
        });
    }
    for (const row of table('dig'))
      for (const reward of weightedEntries(row.dig_id_array, row.dig_weight_array))
        put({
          mission,
          material: materials.get(reward.id),
          method: 'gather',
          resource: key('dig'),
          row,
          slot: reward.slot,
          pool: reward,
          conditionEn: `Gather at ${row.dig_volume_name}`,
          conditionRu: `Подобрать в точке ${row.id}`,
        });
  }
  const content = `{"app_id":"460870","build_id":"${manifest.build_id}","decoder":"${FIELD_ACQUISITION_DECODER}","rows":[\n${[
    ...rows,
  ]
    .sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))
    .map(([, line]) => line)
    .join(',\n')}\n]}\n`;
  const checksum = hash(content);
  for (const ev of evidence.values()) if (ev.snapshot === snapshot) ev.snapshot_sha256 = checksum;
  data.evidence = [...evidence.values()].sort((a, b) => a.id.localeCompare(b.id));
  data.drops = [...drops.values()].sort((a, b) => a.id.localeCompare(b.id));
  issues.push({
    code: 'GAME_WEIGHT_MODEL_REVIEW',
    source_id: sourceId,
    name: 'Веса наград требуют проверки механики',
    detail:
      'Веса раскола, пожирания и сбора сохранены отдельно от процентов. Суммы могут отличаться от 100; точная вероятность и модификаторы не установлены.',
  });
  if (secondaryPoolDifferences)
    issues.push({
      code: 'GAME_SECONDARY_POOL_REVIEW',
      source_id: sourceId,
      name: 'Отдельные дополнительные пулы материалов',
      detail: `В ${secondaryPoolDifferences} классах en_base.append_material отличается от en_mat. Эти дополнительные пулы не объединены с основной таблицей материалов миссии и не используются для подстановки весов.`,
    });
  return {
    dataset: data,
    snapshots: new Map([[snapshot, content]]),
    issues,
    report: {
      counts,
      covered_materials: covered.size,
      unmatched_enemy_classes: issues.filter((i) => i.code === 'GAME_ENEMY_UNMATCHED').length,
      secondary_pool_differences: secondaryPoolDifferences,
    },
  };
}
