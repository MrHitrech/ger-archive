import { idFor } from './files.mjs';
import { activeEnemyClasses, FIELD_ACQUISITION_DECODER } from './field-acquisition.mjs';

export const MISSION_CATALOGUE_VERSION = 'ger-mission-catalogue-v1';
const baseId = (id) => (id >= 20000 ? id - 20000 : id);
const unique = (values) => [...new Set(values)];

export function catalogueMetadata(row) {
  const b = Buffer.from(row.raw_hex, 'hex');
  if (b.length !== 312 || b.readUInt16LE(0) !== row.id)
    throw new Error('Invalid catalogue mission record');
  if (typeof row.description !== 'string' || !row.description.trim())
    throw new Error('Mission description missing from export; repeat extraction');
  return {
    version: MISSION_CATALOGUE_VERSION,
    native_type_code: b[4],
    time_limit_seconds: b.readUInt16LE(2),
    description_en: row.description,
  };
}

/** Extend only reviewed ordinary difficulty scopes; story/free copies share a native base key. */
export function missionCatalogueDrafts(
  data,
  { manifest, decoded },
  { scope, aragamiMappings = [] },
) {
  if (
    scope.game !== 'ger' ||
    scope.app_id !== '460870' ||
    scope.format_version !== 1 ||
    scope.native_type_code !== 0 ||
    !Array.isArray(scope.ranks)
  )
    throw new Error('Unsupported mission catalogue scope');
  const groups = new Map();
  for (const row of decoded.mission_en) {
    if (
      !scope.ranks.includes(row.rank) ||
      Buffer.from(row.raw_hex, 'hex')[4] !== scope.native_type_code
    )
      continue;
    const key = baseId(row.id);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const managed = new Set(
    data.missions
      .filter((m) =>
        m.references.some((ref) => {
          const e = data.evidence.find((e) => e.id === ref);
          return e?.excerpt.includes(`"version":"${MISSION_CATALOGUE_VERSION}"`);
        }),
      )
      .map((m) => m.id),
  );
  const additions = [],
    coverage = [];
  for (const rank of scope.ranks) {
    const rows = [...groups.values()].filter((g) => g[0].rank === rank);
    if (rows.length !== scope.expected_counts[String(rank)])
      throw new Error(
        `Native mission count changed for rank ${rank}: ${rows.length}; review scope`,
      );
    const nativeBases = new Set(rows.map((g) => baseId(g[0].id)));
    if (
      data.missions.some(
        (m) =>
          m.rank === rank &&
          m.type === 'standard' &&
          !nativeBases.has(baseId(m.game_origin?.row_id)),
      )
    )
      throw new Error(`Unmapped existing mission in rank ${rank}`);
    let added = 0;
    for (const variants of rows) {
      const row = [...variants].sort((a, b) => b.id - a.id)[0];
      if (
        new Set(variants.map((r) => r.name)).size !== 1 ||
        new Set(variants.map((r) => JSON.stringify(r.rewards))).size !== 1
      )
        throw new Error(`Ambiguous native mission variants: ${row.id}`);
      const locations = data.locations.filter((l) => row.context.includes(l.name_en));
      if (locations.length !== 1 || variants.some((r) => !r.context.includes(locations[0].name_en)))
        throw new Error(`Ambiguous catalogue location: ${row.name}`);
      const existing = data.missions.filter(
        (m) =>
          m.game_origin?.resource === 'mission_en' &&
          variants.some((r) => r.id === m.game_origin.row_id),
      );
      if (existing.length > 1) throw new Error(`Duplicate existing catalogue mission: ${row.name}`);
      if (existing.length) {
        if (existing[0].rank !== rank || existing[0].type !== 'standard')
          throw new Error('Catalogue classification conflict');
        continue;
      }
      if (data.missions.some((m) => m.name_en === row.name && m.rank === rank))
        throw new Error(`Unmapped legacy catalogue mission: ${row.name}`);
      const bundle = manifest.mission_bundles?.find((b) => b.native_id === row.id);
      if (!bundle)
        throw new Error(
          `Missing mission bundle ${row.id}; update resource catalogue and repeat extraction`,
        );
      const prefix = `mission_${String(baseId(row.id)).padStart(3, '0')}`;
      const base = decoded[`${prefix}_base_en`],
        quest = decoded[`${prefix}_quest`],
        entries = decoded[`${prefix}_entries`];
      if (!base || !quest || !entries) throw new Error(`Missing mission enemy tables: ${row.id}`);
      const active = activeEnemyClasses(quest, entries),
        enemies = [];
      for (const id of active) {
        const b = base.find((b) => b.id === id);
        const match = aragamiMappings.filter(
          (m) =>
            m.family_id === b?.en_base_family_id &&
            m.native_name === b.en_base_display_name &&
            m.res_name === b.en_base_res_name &&
            data.aragami.some((a) => a.id === m.site_id),
        );
        if (match.length !== 1) throw new Error(`Unmapped active enemy for ${row.name}: ${id}`);
        enemies.push(match[0].site_id);
      }
      if (!enemies.length) throw new Error(`Mission objective context missing: ${row.name}`);
      const metadata = catalogueMetadata(row),
        id = idFor('q', `steam:460870:mission:${row.id}`);
      additions.push({
        id,
        game: 'ger',
        name_en: row.name,
        verification_status: 'partial',
        checked_at: null,
        references: [],
        missing_fields: ['story_availability', 'unlock_conditions', 'manual_mission_review'],
        rank,
        type: 'standard',
        variant: 'standard',
        location_id: locations[0].id,
        aragami_ids: unique(enemies),
        objectives_en: metadata.description_en,
        reward_table_status: 'missing',
        time_limit_seconds: metadata.time_limit_seconds,
      });
      managed.add(id);
      added++;
    }
    coverage.push({
      rank,
      type: 'standard',
      native_type_code: scope.native_type_code,
      native_unique_missions: rows.length,
      added,
      after: data.missions.filter((m) => m.rank === rank && m.type === 'standard').length + added,
      excluded_urgent_rows: decoded.mission_en
        .filter((r) => r.rank === rank && Buffer.from(r.raw_hex, 'hex')[4] === 3)
        .map((r) => r.id),
    });
  }
  return {
    additions,
    managed,
    report: {
      scope: scope.ranks,
      coverage,
      added: additions.map((m) => ({ id: m.id, name_en: m.name_en, rank: m.rank })),
    },
  };
}

export function linkCatalogueEnemyEvidence(data) {
  const ev = new Map(data.evidence.map((e) => [e.id, e]));
  for (const mission of data.missions) {
    if (
      !mission.references.some((ref) =>
        ev.get(ref)?.excerpt.includes(`"version":"${MISSION_CATALOGUE_VERSION}"`),
      )
    )
      continue;
    const prefix = `mission_${String(baseId(mission.game_origin.row_id)).padStart(3, '0')}_`;
    const refs = data.evidence
      .filter(
        (e) =>
          e.game_origin?.resource.startsWith(prefix) &&
          /_(base_en|base_ru|quest|entries)$/.test(e.game_origin.resource),
      )
      .map((e) => e.id);
    if (!refs.length) throw new Error(`Catalogue enemy evidence missing: ${mission.id}`);
    mission.references = unique([...mission.references, ...refs]);
  }
}

export function validateCatalogueMission(mission, facts, index, mappings) {
  if (!facts.catalogue) return [];
  try {
    const meta = facts.catalogue,
      b = Buffer.from(facts.raw_hex, 'hex');
    if (
      meta.version !== MISSION_CATALOGUE_VERSION ||
      meta.native_type_code !== 0 ||
      b[4] !== 0 ||
      mission.type !== 'standard' ||
      meta.time_limit_seconds !== b.readUInt16LE(2) ||
      mission.time_limit_seconds !== meta.time_limit_seconds ||
      mission.objectives_en !== meta.description_en
    )
      throw Error('native catalogue metadata mismatch');
    const prefix = `mission_${String(baseId(mission.game_origin.row_id)).padStart(3, '0')}_`;
    const rows = mission.references
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
    );
    const expected = [];
    for (const id of active) {
      const b = rows.find((r) => r.key === 'base_en' && r.facts.row.id === id)?.facts.row;
      const map = mappings.find(
        (m) =>
          m.family_id === b?.en_base_family_id &&
          m.native_name === b.en_base_display_name &&
          m.res_name === b.en_base_res_name,
      );
      if (!map) throw Error('unproven catalogue Aragami');
      expected.push(map.site_id);
    }
    if (
      !expected.length ||
      JSON.stringify(unique(expected).sort()) !== JSON.stringify([...mission.aragami_ids].sort())
    )
      throw Error('catalogue Aragami differ from spawn tables');
    return [];
  } catch (error) {
    return [`invalid catalogue mission: ${error.message}`];
  }
}
