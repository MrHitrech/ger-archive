import { parseKst, kstString } from './game-formats.mjs';
import { hash, idFor } from './files.mjs';
import {
  MISSION_CONDITIONS,
  CONDITIONAL_REWARDS_DECODER,
  RUSSIAN_MISSION_NAME_CODEC,
  decodeRussianMissionName,
} from './mission-conditions.mjs';
import { missionCatalogueDrafts, catalogueMetadata } from './mission-catalogue.mjs';
import { MISSION_LOCATION_CODEC, RU_MISSION_LOCATION_CODEC } from './full-mission-catalogue.mjs';

export const MISSION_REWARDS_DECODER = 'ger-mission-rewards-v1';
const unique = (values) => [...new Set(values)];

export function missionRewardFields(rawHex, id) {
  if (!/^[a-f0-9]{624}$/.test(rawHex)) throw new Error('Invalid 312-byte mission record');
  const b = Buffer.from(rawHex, 'hex');
  if (b.readUInt16LE(0) !== id) throw new Error('Mission key mismatch');
  const rewards = Array.from({ length: 32 }, (_, slot) => ({
    slot,
    article_id: b.readInt16LE(28 + slot * 2),
    rate_percent: b[92 + slot],
    condition_code: b[124 + slot],
  }));
  if (rewards.some((r) => r.rate_percent > 100)) throw new Error('Invalid reward percentage');
  return { rank: b[6], rewards };
}

export function decodeMissionResource(bytes) {
  const table = parseKst(bytes);
  if (table.stride !== 312) throw new Error(`Unsupported mission layout: ${table.stride}`);
  return table.rows.map((row) => {
    const raw_hex = row.bytes.toString('hex');
    return {
      id: row.key,
      name: kstString(bytes, row.bytes.readUInt32LE(292), table.record_end),
      description: kstString(bytes, row.bytes.readUInt32LE(296), table.record_end),
      context: [300, 304, 308].map((offset) =>
        kstString(bytes, row.bytes.readUInt32LE(offset), table.record_end),
      ),
      ...missionRewardFields(raw_hex, row.key),
      record_offset: row.offset,
      raw_hex,
    };
  });
}

/** Automatic and explicitly supported condition codes only; unknown conditions remain excluded. */
export function createMissionRewardImport(
  current,
  { manifest, decoded },
  { checkedAt, missionMappings = [], catalogueScope = null, aragamiMappings = [] },
) {
  if (manifest.app_id !== '460870' || !decoded.mission_en || !manifest.resources.mission_en)
    throw new Error('GER mission export required');
  const data = structuredClone(current);
  const mappingChanges = [];
  for (const mapping of missionMappings) {
    const mission = data.missions.find((m) => m.id === mapping.existing_id);
    if (!mission) throw new Error(`Mapped mission missing: ${mapping.existing_id}`);
    const native = decoded.mission_en.find((r) => r.id === mapping.native_id);
    const location = data.locations.find((l) => l.id === mapping.location_id);
    if (
      !native ||
      native.name !== mapping.canonical_name ||
      !native.context.includes(location?.name_en) ||
      (mission.rank !== 'challenge' && mission.rank !== native.rank) ||
      ![mapping.previous_name, mapping.canonical_name].includes(mission.name_en) ||
      ![mapping.previous_location_id, mapping.location_id].includes(mission.location_id)
    )
      throw new Error(`Invalid explicit mission mapping: ${mission.id}`);
    if (mission.name_en !== native.name || mission.location_id !== mapping.location_id)
      mappingChanges.push({
        id: mission.id,
        before_name: mission.name_en,
        after_name: native.name,
        before_location_id: mission.location_id,
        after_location_id: mapping.location_id,
      });
    const translation = data.translations.find((t) => t.id === mission.id);
    if (translation && translation.name_en !== native.name) {
      translation.aliases = unique([...translation.aliases, translation.name_en]);
      translation.name_en = native.name;
    }
    mission.name_en = native.name;
    mission.location_id = mapping.location_id;
  }
  const sourceId = `game-mission-rewards-460870-${manifest.build_id}`;
  const metadata = manifest.resources.mission_en;
  const { local_file, ...resource } = metadata;
  const source = {
    id: sourceId,
    title: `God Eater Resurrection — награды миссий, Steam ${manifest.build_id}`,
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
    resources: {
      mission_en: resource,
      ...(manifest.resources.mission_ru
        ? {
            mission_ru: Object.fromEntries(
              Object.entries(manifest.resources.mission_ru).filter(([k]) => k !== 'local_file'),
            ),
          }
        : {}),
    },
    ...(catalogueScope?.format_version === 2 ? { catalogue_scope: catalogueScope } : {}),
    note_ru:
      'Из mission.kst извлечены основные награды и подтверждённые бонусы за время и выносливость. Русские имена присоединяются по игровым ID с сохранением заполненных переводов. Процент относится к отдельной позиции; количество и зависимость позиций не установлены.',
  };
  const oldSource = data.sources.findIndex((s) => s.id === sourceId);
  if (oldSource < 0) data.sources.push(source);
  else data.sources[oldSource] = source;
  const evidence = new Map(data.evidence.map((r) => [r.id, r]));
  const snapshot = `game-${manifest.build_id}-mission-en-${metadata.sha256.slice(0, 12)}-${MISSION_REWARDS_DECODER}.json`;
  const snapshotRows = new Map(
    data.evidence
      .filter((ev) => ev.snapshot === snapshot)
      .map((ev) => {
        const f = JSON.parse(ev.excerpt);
        return [`${f.row_id}:${f.slot ?? 'mission'}`, ev.excerpt];
      }),
  );
  const issues = [],
    idMap = [],
    unmatched = [],
    changes = [];
  const extraSnapshots = new Map();
  const ruRows = new Map((decoded.mission_ru ?? []).map((r) => [r.id, r]));
  if (
    decoded.mission_ru &&
    (ruRows.size !== decoded.mission_en.length ||
      decoded.mission_en.some(
        (r) =>
          !ruRows.has(r.id) ||
          JSON.stringify(r.rewards) !== JSON.stringify(ruRows.get(r.id).rewards),
      ))
  )
    throw new Error('EN/RU mission IDs or reward fields differ');
  const translationSummary = { filled: 0, preserved_existing: 0 };
  const catalogue = catalogueScope
    ? missionCatalogueDrafts(
        data,
        { manifest, decoded },
        { scope: catalogueScope, aragamiMappings },
      )
    : null;
  if (catalogue) {
    for (const update of catalogue.updates ?? [])
      Object.assign(
        data.missions.find((m) => m.id === update.id),
        update.fields,
      );
    for (const enemy of catalogue.aragamiAdds ?? [])
      data.aragami.push({ ...enemy, checked_at: checkedAt });
    for (const { record, row, ru, name_ru, code } of catalogue.locationAdds ?? []) {
      const enRef = extraProof(
        'mission_en',
        row,
        {
          context_kind: 'mission_location',
          entity_id: record.id,
          name_en: record.name_en,
          location_code: code,
          context: row.context,
          raw_hex: row.raw_hex,
        },
        MISSION_LOCATION_CODEC,
      );
      const ruRef = extraProof(
        'mission_ru',
        ru,
        {
          context_kind: 'mission_location',
          entity_id: record.id,
          name_en: record.name_en,
          name_ru,
          location_code: code,
          context: ru.context,
          raw_hex: ru.raw_hex,
        },
        RU_MISSION_LOCATION_CODEC,
      );
      data.locations.push({ ...record, checked_at: checkedAt, references: [enRef, ruRef] });
      data.translations.push({
        id: record.id,
        name_en: record.name_en,
        name_ru,
        aliases: [],
        source: sourceId,
        status: 'unverified',
        references: [ruRef],
      });
    }
    for (const mission of catalogue.additions)
      data.missions.push({ ...mission, checked_at: checkedAt });
  }
  const drops = new Map(data.drops.map((r) => [r.id, r]));
  const materials = new Map(
    data.materials
      .filter((r) => r.game_origin?.resource === 'article_en')
      .map((r) => [r.game_origin.row_id, r]),
  );
  const used = new Set(),
    covered = new Set();
  let mapped = 0,
    imported = 0,
    skippedBonus = 0,
    skippedNonMaterial = 0,
    bonusImported = 0;
  function origin(row, slot) {
    return {
      source_id: sourceId,
      resource: 'mission_en',
      row_id: row.id,
      resource_sha256: metadata.sha256,
      byte_offset: row.record_offset,
      ...(slot !== undefined ? { slot } : {}),
    };
  }
  function proof(row, facts, slot) {
    const excerpt = JSON.stringify({
      resource: 'mission_en',
      row_id: row.id,
      decoder: MISSION_REWARDS_DECODER,
      ...facts,
    });
    const id = `ev-${hash(`${sourceId}|${metadata.sha256}|${excerpt}`).slice(0, 16)}`;
    snapshotRows.set(`${row.id}:${slot ?? 'mission'}`, excerpt);
    evidence.set(id, {
      id,
      source_id: sourceId,
      game: 'ger',
      section: `God Eater Resurrection / ${resource.resource_path} / row ${row.id}${slot === undefined ? '' : ` / slot ${slot}`}`,
      excerpt,
      snapshot,
      snapshot_sha256: '',
      game_origin: origin(row, slot),
    });
    return id;
  }
  function extraProof(resourceKey, row, facts, decoder, slot) {
    const meta = manifest.resources[resourceKey];
    const file = `game-${manifest.build_id}-${resourceKey.replaceAll('_', '-')}-${meta.sha256.slice(0, 12)}-${decoder}.json`;
    if (!extraSnapshots.has(file))
      extraSnapshots.set(file, {
        resource: resourceKey,
        decoder,
        rows: new Map(
          data.evidence
            .filter((e) => e.snapshot === file)
            .map((e) => {
              const f = JSON.parse(e.excerpt);
              return [`${f.row_id}:${f.slot ?? 'mission'}`, e.excerpt];
            }),
        ),
      });
    const excerpt = JSON.stringify({ resource: resourceKey, row_id: row.id, decoder, ...facts });
    const id = `ev-${hash(`${sourceId}|${meta.sha256}|${excerpt}`).slice(0, 16)}`;
    extraSnapshots.get(file).rows.set(`${row.id}:${slot ?? 'mission'}`, excerpt);
    evidence.set(id, {
      id,
      source_id: sourceId,
      game: 'ger',
      section: `God Eater Resurrection / ${meta.resource_path} / row ${row.id}${slot === undefined ? '' : ` / slot ${slot}`}`,
      excerpt,
      snapshot: file,
      snapshot_sha256: '',
      game_origin: {
        source_id: sourceId,
        resource: resourceKey,
        row_id: row.id,
        resource_sha256: meta.sha256,
        byte_offset: row.record_offset,
        ...(slot === undefined ? {} : { slot }),
      },
    });
    return id;
  }
  // Reject same-name variants with different reward profiles instead of selecting an arbitrary one.
  for (const mission of data.missions) {
    const location = data.locations.find((l) => l.id === mission.location_id)?.name_en;
    const candidates = decoded.mission_en.filter(
      (r) =>
        r.name === mission.name_en &&
        (mission.rank === 'challenge' || mission.rank === r.rank) &&
        r.context.includes(location),
    );
    const profiles = new Set(candidates.map((r) => JSON.stringify(r.rewards)));
    if (!candidates.length || profiles.size !== 1) {
      unmatched.push({
        id: mission.id,
        name_en: mission.name_en,
        candidates: candidates.map((r) => r.id),
      });
      issues.push({
        code: 'GAME_MISSION_UNMATCHED',
        source_id: sourceId,
        name: mission.name_en,
        detail: candidates.length
          ? 'Совпадающие варианты имеют разные награды; требуется ручное сопоставление.'
          : 'Точное сочетание названия, ранга и локации не найдено. Игровые награды не присоединены.',
      });
      continue;
    }
    const row = [...candidates].sort((a, b) => b.id - a.id)[0];
    if (mission.verification_status === 'verified')
      throw new Error(`Reviewed mission requires explicit review: ${mission.id}`);
    const ref = proof(row, {
      name_en: row.name,
      rank: row.rank,
      context: row.context,
      equivalent_row_ids: candidates.map((r) => r.id).sort((a, b) => a - b),
      raw_hex: row.raw_hex,
      rewards: row.rewards,
      ...(catalogue?.managed.has(mission.id)
        ? { catalogue: catalogue.metadata?.get(mission.id) ?? catalogueMetadata(row) }
        : {}),
    });
    Object.assign(mission, {
      checked_at: checkedAt,
      verification_status: 'partial',
      game_origin: origin(row),
      references: unique([...mission.references, ref]),
      reward_table_status: 'partial',
      missing_fields: unique([
        ...mission.missing_fields.filter((f) => f !== 'rewards'),
        'bonus_reward_conditions',
        'reward_quantities',
        'reward_roll_semantics',
      ]),
    });
    mapped++;
    const existingTranslation = data.translations.find((t) => t.id === mission.id);
    if (existingTranslation?.name_ru != null) translationSummary.preserved_existing++;
    else if (ruRows.has(row.id)) {
      const ruRow = ruRows.get(row.id),
        nameRu = decodeRussianMissionName(ruRow.name);
      const ruRef = extraProof(
        'mission_ru',
        ruRow,
        { name_ru: nameRu, raw_name_ru: ruRow.name },
        RUSSIAN_MISSION_NAME_CODEC,
      );
      const translation = {
        ...(existingTranslation ?? {}),
        id: mission.id,
        name_en: mission.name_en,
        name_ru: nameRu,
        aliases: existingTranslation?.aliases ?? [],
        source: sourceId,
        status: 'unverified',
        references: unique([...(existingTranslation?.references ?? []), ruRef]),
      };
      if (existingTranslation) Object.assign(existingTranslation, translation);
      else data.translations.push(translation);
      translationSummary.filled++;
    }
    idMap.push({
      collection: 'missions',
      game_id: row.id,
      site_id: mission.id,
      preserved_existing_id: current.missions.some((m) => m.id === mission.id),
    });
    for (const reward of row.rewards) {
      if (!reward.article_id || !reward.rate_percent) continue;
      const material = materials.get(reward.article_id);
      const condition = MISSION_CONDITIONS[reward.condition_code];
      if (!condition) {
        skippedBonus++;
        continue;
      }
      if (!material) {
        skippedNonMaterial++;
        continue;
      }
      const native = data.drops.filter(
        (r) =>
          r.game_origin?.resource === 'mission_en' &&
          r.mission_id === mission.id &&
          r.game_origin.row_id === row.id &&
          r.game_origin.slot === reward.slot,
      );
      if (native.length > 1) throw new Error('Duplicate native reward identity');
      const legacy = data.drops
        .filter(
          (r) =>
            !r.game_origin &&
            !used.has(r.id) &&
            r.method === condition.method &&
            r.mission_id === mission.id &&
            r.material_id === material.id &&
            (r.drop_rate === null || r.drop_rate === reward.rate_percent),
        )
        .sort(
          (a, b) =>
            Number(a.drop_rate === null) - Number(b.drop_rate === null) || a.id.localeCompare(b.id),
        );
      const old = native[0] ?? legacy[0];
      if (old?.verification_status === 'verified') throw new Error(`Reviewed reward: ${old.id}`);
      const id = old?.id ?? idFor('d', `steam:460870:mission:${row.id}:reward:${reward.slot}`);
      if (used.has(id)) throw new Error(`Reward ID reused: ${id}`);
      used.add(id);
      const facts = {
        ...reward,
        mission_name_en: row.name,
        material_name_en: material.name_en,
        condition_en: condition.en,
        raw_hex: row.raw_hex,
      };
      const evidenceId =
        reward.condition_code === 0
          ? proof(row, facts, reward.slot)
          : extraProof('mission_en', row, facts, CONDITIONAL_REWARDS_DECODER, reward.slot);
      const record = {
        ...(old ?? {}),
        id,
        game: 'ger',
        name_en: `${material.name_en} / ${mission.name_en} / ${condition.en} / slot ${reward.slot + 1}`,
        verification_status: 'partial',
        checked_at: checkedAt,
        references: unique([...(old?.references ?? []), evidenceId]),
        missing_fields: ['quantity', 'reward_roll_semantics', 'in_game_review'],
        game_origin: origin(row, reward.slot),
        material_id: material.id,
        mission_id: mission.id,
        aragami_id: null,
        location_id: mission.location_id,
        method: condition.method,
        condition_ru: condition.ru,
        condition_en: condition.en,
        drop_rate: reward.rate_percent,
        quantity: null,
        slot: `mission_reward_${reward.slot}`,
        source_url: null,
      };
      if (old && JSON.stringify(old) !== JSON.stringify(record))
        changes.push({
          id,
          before_rate: old.drop_rate,
          after_rate: record.drop_rate,
          slot: reward.slot,
        });
      drops.set(id, record);
      if (reward.condition_code === 0) imported++;
      else bonusImported++;
      covered.add(material.id);
    }
  }
  const content = `{
  "app_id": "460870",
  "build_id": "${manifest.build_id}",
  "resource_path": ${JSON.stringify(resource.resource_path)},
  "resource_sha256": "${metadata.sha256}",
  "decoder": "${MISSION_REWARDS_DECODER}",
  "rows": [
${[...snapshotRows]
  .sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))
  .map(([, line]) => `    ${line}`)
  .join(',\n')}
  ]
}
`;
  const checksum = hash(content);
  for (const ev of evidence.values()) if (ev.snapshot === snapshot) ev.snapshot_sha256 = checksum;
  const snapshots = new Map([[snapshot, content]]);
  for (const [file, entry] of extraSnapshots) {
    const text = `{"app_id":"460870","build_id":"${manifest.build_id}","resource_path":${JSON.stringify(manifest.resources[entry.resource].resource_path)},"resource_sha256":"${manifest.resources[entry.resource].sha256}","decoder":"${entry.decoder}","rows":[\n${[
      ...entry.rows,
    ]
      .sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))
      .map(([, line]) => line)
      .join(',\n')}\n]}\n`;
    snapshots.set(file, text);
    const textChecksum = hash(text);
    for (const ev of evidence.values()) if (ev.snapshot === file) ev.snapshot_sha256 = textChecksum;
  }
  data.evidence = [...evidence.values()].sort((a, b) => a.id.localeCompare(b.id));
  data.drops = [...drops.values()].sort((a, b) => a.id.localeCompare(b.id));
  issues.push({
    code: 'GAME_REWARD_SCOPE_REVIEW',
    source_id: sourceId,
    name: 'Неполная таблица способов получения',
    detail:
      'Импортированы основные награды и поддержанные бонусы за время и выносливость (коды 0, 2–5). Остальные коды условий, количество наград и зависимость позиций ещё требуют проверки.',
  });
  return {
    dataset: data,
    snapshots,
    issues,
    idMap,
    report: {
      decoder: MISSION_REWARDS_DECODER,
      matched_missions: mapped,
      total_missions: data.missions.length,
      automatic_reward_slots: imported,
      bonus_reward_slots: bonusImported,
      translation_import: translationSummary,
      mission_mapping_changes: mappingChanges,
      ...(catalogue ? { catalogue: catalogue.report } : {}),
      covered_materials: covered.size,
      skipped_bonus_slots: skippedBonus,
      skipped_non_material_slots: skippedNonMaterial,
      unmatched_missions: unmatched,
      corrected_existing_rewards: changes,
    },
  };
}
