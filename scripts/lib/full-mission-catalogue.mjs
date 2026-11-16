import { idFor } from './files.mjs';
import { activeEnemyClasses, FIELD_ACQUISITION_DECODER } from './field-acquisition.mjs';

export const FULL_MISSION_CATALOGUE_VERSION = 'ger-mission-catalogue-v2';
export const MISSION_LOCATION_CODEC = 'ger-mission-location-v1';
export const RU_MISSION_LOCATION_CODEC = 'ger-ru-mission-location-v1';
const legacyVersion = 'ger-mission-catalogue-v1';
const unique = (values) => [...new Set(values)];
export const missionBaseId = (id) => (id >= 20000 ? id - 20000 : id);
export const missionPrefix = (id) => `mission_${String(missionBaseId(id)).padStart(3, '0')}`;

export function survivalStage(row) {
  const text = row.context.find((s) => /Survival Phase/i.test(s));
  if (!text) return null;
  const match = text.match(/Survival Phase (\d+)\/(\d+)/);
  if (!match) throw new Error(`Unknown survival stage: ${row.id}`);
  const index = Number(match[1]),
    count = Number(match[2]);
  if (index < 1 || index > count || count < 2) throw new Error('Invalid survival stage');
  const suffix = ` ${index}`;
  if (index > 1 && !row.name.endsWith(suffix)) throw new Error(`Stage title mismatch: ${row.name}`);
  return { index, count, name: index === 1 ? row.name : row.name.slice(0, -suffix.length) };
}

export function nativeMissionType(row, scope) {
  const kind = Buffer.from(row.raw_hex, 'hex')[4];
  if (scope.tutorial_native_ids.includes(row.id)) return 'tutorial';
  if (kind === 3) return 'urgent';
  if (kind === 4) return 'extra';
  if (kind === 0) return row.rank === 14 ? 'challenge' : 'standard';
  throw new Error(`Unreviewed mission kind ${kind}`);
}

function rawMetadata(row, version = FULL_MISSION_CATALOGUE_VERSION) {
  const b = Buffer.from(row.raw_hex, 'hex');
  if (
    b.length !== 312 ||
    b.readUInt16LE(0) !== row.id ||
    typeof row.description !== 'string' ||
    !row.description.trim()
  )
    throw new Error('Incomplete native mission export');
  return {
    version,
    native_type_code: b[4],
    time_limit_seconds: b.readUInt16LE(2),
    description_en: row.description,
  };
}

export function fullMissionCatalogueDrafts(
  data,
  { manifest, decoded },
  { scope, aragamiMappings = [] },
) {
  if (scope.format_version !== 2 || scope.game !== 'ger' || scope.app_id !== '460870')
    throw new Error('Unsupported full mission catalogue scope');
  if (decoded.mission_en.length !== scope.expected_native_row_count)
    throw new Error('Native mission row universe changed');
  const grouped = new Map();
  for (const row of decoded.mission_en) {
    const b = Buffer.from(row.raw_hex, 'hex');
    if (!scope.ranks.includes(row.rank) || !scope.native_type_codes.includes(b[4]))
      throw new Error(`Unreviewed native mission: ${row.id}`);
    const base = missionBaseId(row.id);
    grouped.set(base, [...(grouped.get(base) ?? []), row]);
  }
  const selected = [...grouped.values()].map((variants) => {
    const row = [...variants].sort((a, b) => b.id - a.id)[0];
    if (
      new Set(variants.map((r) => r.name)).size !== 1 ||
      new Set(variants.map((r) => JSON.stringify(r.rewards))).size !== 1
    )
      throw new Error(`Conflicting native mission variants: ${row.id}`);
    return { row, variants, type: nativeMissionType(row, scope), stage: survivalStage(row) };
  });
  if (
    JSON.stringify(selected.map((d) => d.row.id).sort((a, b) => a - b)) !==
    JSON.stringify(scope.expected_native_ids)
  )
    throw new Error('Native mission universe changed; review full catalogue scope');
  const stageGroups = new Map();
  for (const item of selected.filter((x) => x.stage)) {
    const key = `${item.type}|${item.row.rank}|${item.stage.name}`;
    stageGroups.set(key, [...(stageGroups.get(key) ?? []), item]);
  }
  for (const chain of stageGroups.values()) {
    const count = chain[0].stage.count;
    if (
      chain.length !== count ||
      new Set(chain.map((x) => x.stage.index)).size !== count ||
      chain.some((x) => x.stage.count !== count)
    )
      throw new Error('Incomplete survival mission chain');
    const root = chain.find((x) => x.stage.index === 1);
    for (const item of chain) item.parentNativeId = item.stage.index === 1 ? null : root.row.id;
  }
  const expectedRootCount = selected.filter((x) => !x.parentNativeId).length;
  if (expectedRootCount !== scope.expected_root_count)
    throw new Error('Distinct mission count changed');
  const evidence = new Map(data.evidence.map((e) => [e.id, e]));
  const oldByBase = new Map();
  for (const m of data.missions) {
    const base = missionBaseId(m.game_origin?.row_id);
    if (oldByBase.has(base)) throw new Error('Duplicate existing native mission');
    oldByBase.set(base, m);
  }
  const ids = new Map(
    selected.map((x) => [
      x.row.id,
      oldByBase.get(missionBaseId(x.row.id))?.id ?? idFor('q', `steam:460870:mission:${x.row.id}`),
    ]),
  );
  const locationAdds = [],
    locations = [...data.locations];
  const training = scope.training_location;
  if (!locations.some((l) => l.name_en === training.name_en)) {
    const row = decoded.mission_en.find((r) => r.id === training.native_id),
      ru = decoded.mission_ru?.find((r) => r.id === training.native_id);
    if (
      !row?.context.includes(training.name_en) ||
      !ru?.context.includes(training.name_ru) ||
      Buffer.from(row.raw_hex, 'hex')[7] !== training.code
    )
      throw new Error('Training location is not proven');
    const location = {
      id: idFor('l', `steam:460870:mission-location:${training.code}`),
      game: 'ger',
      name_en: training.name_en,
      verification_status: 'partial',
      checked_at: null,
      references: [],
      missing_fields: ['manual_location_review'],
    };
    locations.push(location);
    locationAdds.push({
      record: location,
      row,
      ru,
      name_ru: training.name_ru,
      code: training.code,
    });
  }
  const additions = [],
    updates = [],
    metadata = new Map(),
    aragamiAdds = [],
    knownAragami = new Set(data.aragami.map((a) => a.id));
  const coverage = scope.ranks.map((rank) => ({
    rank,
    ordinary: 0,
    urgent: 0,
    extra: 0,
    phases: 0,
    records: 0,
    added: 0,
    classification_updates: 0,
  }));
  for (const item of selected) {
    const { row, variants, type, stage } = item,
      rankCoverage = coverage.find((c) => c.rank === row.rank),
      kind = Buffer.from(row.raw_hex, 'hex')[4];
    rankCoverage.records++;
    if (item.parentNativeId) rankCoverage.phases++;
    else if (kind === 0) rankCoverage.ordinary++;
    else if (kind === 3) rankCoverage.urgent++;
    else rankCoverage.extra++;
    const matchingLocations = locations.filter((l) => row.context.includes(l.name_en));
    if (
      matchingLocations.length !== 1 ||
      variants.some((r) => !r.context.includes(matchingLocations[0].name_en))
    )
      throw new Error(`Unproven mission location: ${row.name}`);
    const old = oldByBase.get(missionBaseId(row.id)),
      id = ids.get(row.id),
      bundle = manifest.mission_bundles?.find((b) => b.native_id === row.id);
    if (!bundle) throw new Error(`Missing bundle: ${row.id}`);
    const prefix = missionPrefix(row.id),
      base = decoded[`${prefix}_base_en`],
      ruBase = decoded[`${prefix}_base_ru`],
      quest = decoded[`${prefix}_quest`],
      entries = decoded[`${prefix}_entries`];
    if (!base || !quest || !entries || !ruBase) throw new Error('Mission enemy tables missing');
    const active = activeEnemyClasses(quest, entries),
      enemies = [],
      nonAragami = [];
    for (const classId of active) {
      const b = base.find((r) => r.id === classId);
      if (!b) throw new Error('Spawned class absent from enemy table');
      const isTarget =
        type === 'tutorial' &&
        scope.non_aragami_targets.some(
          (m) =>
            m.family_id === b.en_base_family_id &&
            m.native_name === b.en_base_display_name &&
            m.res_name === b.en_base_res_name,
        );
      if (isTarget) {
        nonAragami.push(classId);
        continue;
      }
      const matches = aragamiMappings.filter(
        (m) =>
          m.family_id === b.en_base_family_id &&
          m.native_name === b.en_base_display_name &&
          m.res_name === b.en_base_res_name,
      );
      if (matches.length !== 1) throw new Error(`Unmapped enemy ${row.name}/${classId}`);
      const map = matches[0];
      if (!knownAragami.has(map.site_id)) {
        if (!map.create_record) throw new Error('Aragami record missing');
        knownAragami.add(map.site_id);
        aragamiAdds.push({
          id: map.site_id,
          game: 'ger',
          name_en: map.native_name,
          variant: map.variant ?? 'standard',
          size: null,
          breakable_parts: null,
          verification_status: 'partial',
          checked_at: null,
          references: [],
          missing_fields: ['size', 'breakable_parts', 'manual_game_review'],
        });
      }
      enemies.push(map.site_id);
    }
    if (!active.size && !scope.non_combat_native_ids?.includes(row.id))
      throw new Error(`Mission has no proved target context: ${row.name}`);
    if (
      !active.size &&
      (!quest.some((q) => q.quest_flow_is_mission_goal === 1) ||
        !row.description.includes('Mission will complete automatically.'))
    )
      throw new Error('Unproven non-combat mission');
    const fields = {
      rank: row.rank,
      type,
      ...(stage
        ? {
            phase_index: stage.index,
            phase_count: stage.count,
            parent_mission_id: item.parentNativeId ? ids.get(item.parentNativeId) : null,
          }
        : {}),
    };
    if (old) {
      if (old.name_en !== row.name || old.location_id !== matchingLocations[0].id)
        throw new Error(`Existing native mission differs: ${row.name}`);
      const changed = Object.entries(fields).some(
        ([k, v]) => JSON.stringify(old[k]) !== JSON.stringify(v),
      );
      if (changed) {
        updates.push({
          id: old.id,
          fields,
          before: { rank: old.rank, type: old.type },
          after: fields,
        });
        rankCoverage.classification_updates++;
      }
      const previous = old.references
        .map((ref) => evidence.get(ref))
        .filter((e) => e?.excerpt.includes('"catalogue":'))
        .map((e) => JSON.parse(e.excerpt))
        .find((f) =>
          [legacyVersion, FULL_MISSION_CATALOGUE_VERSION].includes(f.catalogue?.version),
        );
      if (previous) {
        metadata.set(
          id,
          previous.catalogue.version === legacyVersion
            ? rawMetadata(row, legacyVersion)
            : {
                ...rawMetadata(row),
                mission_type: type,
                non_aragami_classes: nonAragami,
                ...(stage
                  ? {
                      phase_index: stage.index,
                      phase_count: stage.count,
                      parent_native_id: item.parentNativeId,
                    }
                  : {}),
              },
        );
      }
      continue;
    }
    additions.push({
      id,
      game: 'ger',
      name_en: row.name,
      verification_status: 'partial',
      checked_at: null,
      references: [],
      missing_fields: ['story_availability', 'unlock_conditions', 'manual_mission_review'],
      ...fields,
      variant: stage ? `survival_phase_${stage.index}_of_${stage.count}` : 'standard',
      location_id: matchingLocations[0].id,
      aragami_ids: unique(enemies),
      objectives_en: row.description,
      reward_table_status: 'missing',
      time_limit_seconds: rawMetadata(row).time_limit_seconds,
    });
    metadata.set(id, {
      ...rawMetadata(row),
      mission_type: type,
      non_aragami_classes: nonAragami,
      ...(stage
        ? {
            phase_index: stage.index,
            phase_count: stage.count,
            parent_native_id: item.parentNativeId,
          }
        : {}),
    });
    rankCoverage.added++;
  }
  for (const rank of scope.ranks)
    for (const kind of scope.native_type_codes) {
      const actual = selected.filter(
        (x) => x.row.rank === rank && Buffer.from(x.row.raw_hex, 'hex')[4] === kind,
      ).length;
      if (actual !== scope.expected_counts[String(rank)][String(kind)])
        throw new Error(`Mission count changed: ${rank}/${kind}`);
    }
  return {
    additions,
    updates,
    locationAdds,
    aragamiAdds,
    metadata,
    managed: new Set(metadata.keys()),
    report: {
      scope: scope.ranks,
      complete_native_catalogue: true,
      native_rows: decoded.mission_en.length,
      native_groups: selected.length,
      distinct_missions: expectedRootCount,
      stage_records: selected.length - expectedRootCount,
      coverage,
      added: additions.map((m) => ({ id: m.id, name_en: m.name_en, rank: m.rank, type: m.type })),
      classification_updates: updates,
    },
  };
}

export function validateFullCatalogueMission(mission, facts, index, mappings, scope) {
  try {
    const meta = facts.catalogue,
      b = Buffer.from(facts.raw_hex, 'hex');
    if (
      meta.version !== FULL_MISSION_CATALOGUE_VERSION ||
      b[4] !== meta.native_type_code ||
      mission.rank !== b[6] ||
      mission.type !== meta.mission_type ||
      mission.time_limit_seconds !== b.readUInt16LE(2) ||
      meta.time_limit_seconds !== b.readUInt16LE(2) ||
      mission.objectives_en !== meta.description_en
    )
      throw Error('native full catalogue metadata mismatch');
    const type = nativeMissionType(
      { id: mission.game_origin.row_id, rank: b[6], raw_hex: facts.raw_hex },
      scope,
    );
    if (type !== mission.type) throw Error('native mission type differs');
    const phase = survivalStage({
      id: mission.game_origin.row_id,
      name: mission.name_en,
      context: facts.context,
    });
    if (phase) {
      if (
        mission.phase_index !== phase.index ||
        mission.phase_count !== phase.count ||
        meta.phase_index !== phase.index ||
        meta.phase_count !== phase.count
      )
        throw Error('survival phase differs');
      if (phase.index > 1) {
        const parent = index.missions.get(mission.parent_mission_id);
        if (
          parent?.game_origin?.row_id !== meta.parent_native_id ||
          parent.phase_index !== 1 ||
          parent.phase_count !== phase.count ||
          parent.type !== mission.type ||
          parent.rank !== mission.rank
        )
          throw Error('survival parent differs');
      }
    } else if (mission.parent_mission_id || mission.phase_index || mission.phase_count)
      throw Error('unexpected survival fields');
    const prefix = missionPrefix(mission.game_origin.row_id) + '_',
      rows = mission.references
        .map((ref) => index.evidence.get(ref))
        .filter((e) => e?.game_origin?.resource.startsWith(prefix))
        .map((e) => ({
          key: e.game_origin.resource.slice(prefix.length),
          facts: JSON.parse(e.excerpt),
        }))
        .filter((e) => e.facts.decoder === FIELD_ACQUISITION_DECODER);
    const active = activeEnemyClasses(
        rows.filter((r) => r.key === 'quest').map((r) => r.facts.row),
        rows.filter((r) => r.key === 'entries').map((r) => r.facts.row),
      ),
      expected = [],
      nonAragami = [];
    if (
      !active.size &&
      (!meta.description_en.includes('Mission will complete automatically.') ||
        !rows.some((r) => r.key === 'quest' && r.facts.row.quest_flow_is_mission_goal === 1))
    )
      throw new Error('unproven non-combat objective');
    for (const id of active) {
      const b = rows.find((r) => r.key === 'base_en' && r.facts.row.id === id)?.facts.row;
      if (!b) throw Error('enemy proof missing');
      if (
        mission.type === 'tutorial' &&
        scope.non_aragami_targets.some(
          (m) =>
            m.family_id === b.en_base_family_id &&
            m.native_name === b.en_base_display_name &&
            m.res_name === b.en_base_res_name,
        )
      ) {
        nonAragami.push(id);
        continue;
      }
      const m = mappings.find(
        (m) =>
          m.family_id === b.en_base_family_id &&
          m.native_name === b.en_base_display_name &&
          m.res_name === b.en_base_res_name,
      );
      if (!m) throw Error('unproved enemy');
      expected.push(m.site_id);
    }
    if (
      (!active.size && !scope.non_combat_native_ids?.includes(mission.game_origin.row_id)) ||
      JSON.stringify(unique(expected).sort()) !== JSON.stringify([...mission.aragami_ids].sort()) ||
      JSON.stringify(nonAragami.sort((a, b) => a - b)) !==
        JSON.stringify([...meta.non_aragami_classes].sort((a, b) => a - b))
    )
      throw Error('enemy/target list differs');
    return [];
  } catch (error) {
    return [`invalid full catalogue mission: ${error.message}`];
  }
}
