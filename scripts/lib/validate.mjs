import Ajv from 'ajv';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { dataDir, hash } from './files.mjs';
import { equipmentCategory } from './game-import.mjs';
import { decodeRussianArticleName, RUSSIAN_ARTICLE_NAME_CODEC } from './game-text.mjs';
import { decodeArticleElements, ARTICLE_ELEMENTS_DECODER } from './game-elements.mjs';
import { missionRewardFields, MISSION_REWARDS_DECODER } from './mission-rewards.mjs';
import {
  MISSION_CONDITIONS,
  CONDITIONAL_REWARDS_DECODER,
  RUSSIAN_MISSION_NAME_CODEC,
  decodeRussianMissionName,
} from './mission-conditions.mjs';
import { FIELD_ACQUISITION_DECODER, validateFieldAcquisition } from './field-acquisition.mjs';
import { validateCatalogueMission } from './mission-catalogue.mjs';

const schema = JSON.parse(
  await readFile(new URL('../../data/schema.json', import.meta.url), 'utf8'),
);
const aragamiMappings = JSON.parse(
  await readFile(new URL('../../data/import-mappings/game-aragami.json', import.meta.url), 'utf8'),
);
const validateSchema = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true }).compile(
  schema,
);
export const collections = [
  'materials',
  'items',
  'recipes',
  'missions',
  'aragami',
  'locations',
  'drops',
];

export function validateDataset(data) {
  const errors = [];
  const warnings = [];
  if (!validateSchema(data))
    return {
      errors: validateSchema.errors.map(
        (e) => `${e.instancePath || '/'} ${e.message} ${JSON.stringify(e.params)}`,
      ),
      warnings,
    };
  const index = Object.fromEntries(
    Object.entries(data).map(([k, records]) => [k, new Map(records.map((r) => [r.id, r]))]),
  );
  const all = new Map();
  const nativeIdentities = new Set();
  function fail(message) {
    errors.push(message);
  }
  function link(collection, id, owner) {
    if (!index[collection].has(id)) fail(`${owner}: unknown ${collection} ID ${id}`);
  }
  for (const [collection, records] of Object.entries(data)) {
    const seen = new Set();
    for (const record of records) {
      if (seen.has(record.id)) fail(`Duplicate ID in ${collection}: ${record.id}`);
      seen.add(record.id);
    }
  }
  for (const collection of collections) {
    const names = new Set();
    for (const row of data[collection]) {
      if (all.has(row.id)) fail(`ID shared across collections: ${row.id}`);
      all.set(row.id, row);
      const identity = row.game_origin
        ? `${row.game_origin.source_id}|${row.game_origin.resource}|${row.game_origin.row_id}|${row.game_origin.slot ?? ''}`
        : collection === 'missions'
          ? `${row.type}|${row.rank}|${row.variant}|${row.location_id}|${row.name_en}`
          : collection === 'items'
            ? `${row.category}|${row.rank}|${row.name_en}`
            : ['recipes', 'drops'].includes(collection)
              ? row.id
              : row.name_en;
      if (names.has(identity)) fail(`Duplicate identity in ${collection}: ${identity}`);
      names.add(identity);
      if (
        !Number.isFinite(Date.parse(row.checked_at)) ||
        new Date(row.checked_at).toISOString().slice(0, 10) !== row.checked_at
      )
        fail(`${row.id}: invalid check date`);
      for (const ref of row.references) link('evidence', ref, row.id);
      if (row.game_origin) {
        checkOrigin(row.game_origin, row.id);
        const native = `${index.sources.get(row.game_origin.source_id)?.app_id}|${row.game_origin.resource}|${row.game_origin.row_id}|${row.game_origin.slot ?? ''}`;
        if (nativeIdentities.has(native)) fail(`${row.id}: duplicate native identity ${native}`);
        nativeIdentities.add(native);
        if (
          !row.references.some(
            (ref) =>
              JSON.stringify(index.evidence.get(ref)?.game_origin) ===
              JSON.stringify(row.game_origin),
          )
        )
          fail(`${row.id}: game origin lacks matching evidence`);
        if (row.game_origin.resource === 'article_en') {
          const nativeEvidence = row.references
            .map((ref) => index.evidence.get(ref))
            .find(
              (ev) =>
                ev?.game_origin?.source_id === row.game_origin.source_id &&
                ev.game_origin.resource === 'article_en' &&
                ev.game_origin.row_id === row.game_origin.row_id,
            );
          try {
            const facts = JSON.parse(nativeEvidence?.excerpt ?? '{}');
            if (facts.name_en !== row.name_en)
              fail(`${row.id}: article name differs from native evidence`);
            if (collection === 'items') {
              const nativeRank = facts.rank >= 1 && facts.rank <= 14 ? facts.rank : null;
              if (
                row.rank !== nativeRank ||
                row.category !== equipmentCategory(facts.category_code)
              )
                fail(`${row.id}: article rank/category differs from native evidence`);
              const elementEvidence = row.references
                .map((ref) => index.evidence.get(ref))
                .filter(
                  (ev) =>
                    ev?.game_origin?.resource === 'article_en' &&
                    ev.game_origin.row_id === row.game_origin.row_id,
                )
                .map((ev) => JSON.parse(ev.excerpt))
                .find((f) => f.decoder === ARTICLE_ELEMENTS_DECODER);
              if (elementEvidence) {
                const decoded = decodeArticleElements({
                  id: row.game_origin.row_id,
                  category_code: facts.category_code,
                  raw_hex: elementEvidence.raw_hex,
                });
                if (
                  !decoded ||
                  Object.keys(decoded).some(
                    (key) => JSON.stringify(decoded[key]) !== JSON.stringify(elementEvidence[key]),
                  ) ||
                  JSON.stringify(row.elements) !== JSON.stringify(decoded.elements) ||
                  row.missing_fields.includes('elements')
                )
                  fail(`${row.id}: elements differ from native evidence`);
              }
            }
          } catch {
            fail(`${row.id}: unreadable native article evidence`);
          }
        }
      }
      if (collection === 'items' && row.rank === null && !row.missing_fields.includes('rank'))
        fail(`${row.id}: unknown rank must be marked missing`);
      if (row.verification_status === 'verified') {
        if (!row.reviewed_by || !row.reviewed_at || row.missing_fields.length)
          fail(`${row.id}: verified requires a reviewer, review date and no missing fields`);
        const referencedSources = row.references.map((ref) =>
          index.sources.get(index.evidence.get(ref)?.source_id),
        );
        if (!referencedSources.some((source) => source && source.acquisition !== 'search_index'))
          fail(`${row.id}: search-index-only facts cannot be marked verified`);
      }
    }
  }
  function checkOrigin(origin, owner) {
    const source = index.sources.get(origin.source_id);
    const resource = source?.resources?.[origin.resource];
    if (
      source?.acquisition !== 'game_files' ||
      source.app_id !== '460870' ||
      !resource ||
      resource.sha256 !== origin.resource_sha256
    )
      fail(`${owner}: game origin resource/checksum mismatch`);
  }
  for (const ev of data.evidence) {
    link('sources', ev.source_id, ev.id);
    const source = index.sources.get(ev.source_id);
    if (source?.game_scope === 'mixed' && !ev.section.includes('God Eater Resurrection'))
      fail(`${ev.id}: mixed source lacks explicit Resurrection section`);
    if (/God Eater (Burst|2|3)\b/.test(ev.section)) fail(`${ev.id}: other game section rejected`);
    if (source?.acquisition === 'game_files') {
      if (!ev.game_origin) fail(`${ev.id}: game-file evidence needs a native origin`);
      else {
        checkOrigin(ev.game_origin, ev.id);
        if (ev.game_origin.source_id !== ev.source_id)
          fail(`${ev.id}: native source differs from evidence source`);
        try {
          const facts = JSON.parse(ev.excerpt);
          if (facts.row_id !== ev.game_origin.row_id || facts.resource !== ev.game_origin.resource)
            fail(`${ev.id}: native row differs from evidence`);
          if (facts.slot !== ev.game_origin.slot)
            fail(`${ev.id}: native slot differs from evidence`);
        } catch {
          fail(`${ev.id}: game-file evidence must contain JSON facts`);
        }
      }
    }
  }
  const recipeIdentities = new Set();
  const edges = new Map();
  for (const recipe of data.recipes) {
    link('items', recipe.item_id, recipe.id);
    if ((recipe.operation === 'upgrade') !== (recipe.from_item_id !== null))
      fail(`${recipe.id}: operation/predecessor mismatch`);
    if (recipe.from_item_id) {
      link('items', recipe.from_item_id, recipe.id);
      if (
        index.items.get(recipe.item_id)?.category !== index.items.get(recipe.from_item_id)?.category
      )
        fail(`${recipe.id}: upgrade changes equipment category`);
      if (
        recipe.required_rank !== null &&
        (index.items.get(recipe.from_item_id)?.rank ?? 0) > recipe.required_rank
      )
        fail(`${recipe.id}: upgrade rank decreases`);
      edges.set(recipe.item_id, [...(edges.get(recipe.item_id) || []), recipe.from_item_id]);
    }
    const materials = new Set();
    for (const ingredient of recipe.materials) {
      link('materials', ingredient.material_id, recipe.id);
      if (materials.has(ingredient.material_id))
        fail(`${recipe.id}: duplicate ingredient ${ingredient.material_id}`);
      materials.add(ingredient.material_id);
    }
    if (index.items.get(recipe.item_id)?.rank !== recipe.required_rank)
      fail(`${recipe.id}: recipe/item rank mismatch`);
    const identity = JSON.stringify([
      recipe.item_id,
      recipe.operation,
      recipe.from_item_id,
      [...recipe.materials].sort((a, b) => a.material_id.localeCompare(b.material_id)),
      recipe.cost_fc,
      recipe.unlock_conditions_raw ?? null,
    ]);
    if (recipeIdentities.has(identity)) fail(`${recipe.id}: duplicate recipe`);
    recipeIdentities.add(identity);
    if (recipe.game_origin) {
      const ev = recipe.references
        .map((ref) => index.evidence.get(ref))
        .find(
          (ref) =>
            ref?.game_origin?.source_id === recipe.game_origin.source_id &&
            ref.game_origin.resource === recipe.game_origin.resource &&
            ref.game_origin.row_id === recipe.game_origin.row_id,
        );
      try {
        const facts = JSON.parse(ev?.excerpt ?? '{}');
        const target = index.items.get(recipe.item_id)?.game_origin?.row_id;
        const base = recipe.from_item_id
          ? index.items.get(recipe.from_item_id)?.game_origin?.row_id
          : null;
        const actual = recipe.materials
          .map((m) => ({
            id: index.materials.get(m.material_id)?.game_origin?.row_id,
            quantity: m.quantity,
          }))
          .sort((a, b) => a.id - b.id);
        if (
          facts.result_id !== target ||
          facts.base_id !== base ||
          facts.price !== recipe.cost_fc ||
          JSON.stringify(facts.ingredients) !== JSON.stringify(actual) ||
          JSON.stringify(facts.unlock_raw) !== JSON.stringify(recipe.unlock_conditions_raw)
        )
          fail(`${recipe.id}: recipe differs from native evidence`);
      } catch {
        fail(`${recipe.id}: unreadable native recipe evidence`);
      }
    }
  }
  const visiting = new Set();
  const done = new Set();
  function visit(id) {
    if (visiting.has(id)) {
      fail(`Upgrade cycle at ${id}`);
      return;
    }
    if (done.has(id)) return;
    visiting.add(id);
    for (const parent of edges.get(id) || []) visit(parent);
    visiting.delete(id);
    done.add(id);
  }
  for (const id of edges.keys()) visit(id);
  for (const mission of data.missions) {
    link('locations', mission.location_id, mission.id);
    for (const id of mission.aragami_ids) link('aragami', id, mission.id);
    if (mission.reward_table_status === 'complete' && mission.missing_fields.includes('rewards'))
      fail(`${mission.id}: complete reward table still marked missing`);
    if (mission.game_origin?.resource === 'mission_en') {
      try {
        const ev = mission.references
          .map((ref) => index.evidence.get(ref))
          .find((e) => JSON.stringify(e?.game_origin) === JSON.stringify(mission.game_origin));
        const facts = JSON.parse(ev?.excerpt ?? '{}');
        const raw = missionRewardFields(facts.raw_hex, mission.game_origin.row_id);
        for (const error of validateCatalogueMission(mission, facts, index, aragamiMappings))
          fail(`${mission.id}: ${error}`);
        if (
          facts.decoder !== MISSION_REWARDS_DECODER ||
          facts.name_en !== mission.name_en ||
          facts.rank !== raw.rank ||
          (mission.rank !== 'challenge' && mission.rank !== raw.rank) ||
          !facts.context.includes(index.locations.get(mission.location_id)?.name_en) ||
          JSON.stringify(facts.rewards) !== JSON.stringify(raw.rewards) ||
          mission.reward_table_status !== 'partial'
        )
          fail(`${mission.id}: mission differs from native evidence`);
      } catch {
        fail(`${mission.id}: unreadable native mission evidence`);
      }
    }
  }
  const dropIdentities = new Set();
  for (const drop of data.drops) {
    link('materials', drop.material_id, drop.id);
    if (drop.mission_id) link('missions', drop.mission_id, drop.id);
    if (drop.aragami_id) link('aragami', drop.aragami_id, drop.id);
    if (drop.location_id) link('locations', drop.location_id, drop.id);
    if (['mission_reward', 'bonus_reward'].includes(drop.method) && !drop.mission_id)
      fail(`${drop.id}: mission reward needs a mission`);
    if (['devour', 'break'].includes(drop.method) && !drop.aragami_id)
      fail(`${drop.id}: aragami drop needs an aragami`);
    if (drop.method === 'break' && !drop.condition_en.trim())
      fail(`${drop.id}: broken part condition missing`);
    if (!drop.mission_id && !drop.aragami_id && !drop.location_id)
      fail(`${drop.id}: acquisition context missing`);
    const matchingSources = drop.references.map((ref) =>
      index.sources.get(index.evidence.get(ref)?.source_id),
    );
    if (!matchingSources.some((s) => s?.url === drop.source_url))
      fail(`${drop.id}: source_url differs from evidence`);
    if (drop.source_url === null && !drop.game_origin)
      fail(`${drop.id}: null source URL requires game-file evidence`);
    if (drop.game_origin && drop.game_origin.resource !== 'mission_en') {
      for (const error of validateFieldAcquisition(drop, index, aragamiMappings))
        fail(`${drop.id}: ${error}`);
    } else if (drop.game_origin) {
      try {
        const ev = drop.references
          .map((ref) => index.evidence.get(ref))
          .find((e) => JSON.stringify(e?.game_origin) === JSON.stringify(drop.game_origin));
        const facts = JSON.parse(ev?.excerpt ?? '{}');
        const raw = missionRewardFields(facts.raw_hex, drop.game_origin.row_id);
        const reward = raw.rewards[drop.game_origin.slot];
        const mission = index.missions.get(drop.mission_id);
        const condition = MISSION_CONDITIONS[reward?.condition_code];
        if (
          drop.game_origin.resource !== 'mission_en' ||
          ![MISSION_REWARDS_DECODER, CONDITIONAL_REWARDS_DECODER].includes(facts.decoder) ||
          !reward ||
          reward.article_id !== index.materials.get(drop.material_id)?.game_origin?.row_id ||
          reward.rate_percent !== drop.drop_rate ||
          !condition ||
          ['slot', 'article_id', 'rate_percent', 'condition_code'].some(
            (key) => facts[key] !== reward[key],
          ) ||
          facts.condition_en !== condition.en ||
          drop.condition_en !== condition.en ||
          drop.condition_ru !== condition.ru ||
          drop.method !== condition.method ||
          drop.slot !== `mission_reward_${reward.slot}` ||
          drop.quantity !== null ||
          drop.aragami_id !== null ||
          mission?.game_origin?.row_id !== drop.game_origin.row_id ||
          facts.mission_name_en !== mission?.name_en ||
          facts.material_name_en !== index.materials.get(drop.material_id)?.name_en ||
          drop.source_url !== null
        )
          fail(`${drop.id}: reward differs from native evidence`);
      } catch {
        fail(`${drop.id}: unreadable native reward evidence`);
      }
    }
    if (
      drop.drop_rate !== null &&
      !drop.game_origin &&
      !drop.references.some((ref) =>
        index.evidence.get(ref)?.excerpt.includes(`${drop.drop_rate}%`),
      )
    )
      fail(`${drop.id}: probability absent from evidence`);
    if (drop.mission_id && drop.location_id !== index.missions.get(drop.mission_id)?.location_id)
      fail(`${drop.id}: mission/location mismatch`);
    const identity = JSON.stringify([
      drop.material_id,
      drop.mission_id,
      drop.aragami_id,
      drop.location_id,
      drop.method,
      drop.condition_en,
      drop.slot,
    ]);
    if (dropIdentities.has(identity)) fail(`${drop.id}: duplicated acquisition context`);
    dropIdentities.add(identity);
  }
  for (const t of data.translations) {
    if (!all.has(t.id)) fail(`Translation references unknown entity ${t.id}`);
    if (all.get(t.id)?.name_en !== t.name_en) fail(`${t.id}: translation English name mismatch`);
    if (t.status !== 'unverified' && (!t.name_ru || !t.reviewed_by || !t.references?.length))
      fail(`${t.id}: confirmed translation requires name, reviewer and references`);
    for (const ref of t.references || []) link('evidence', ref, t.id);
    if (t.name_ru && /[\x00-\x1f\x7f\ufffd]/.test(t.name_ru))
      fail(`${t.id}: translation contains undecoded control characters`);
    const source = index.sources.get(t.source);
    if (source?.acquisition === 'game_files') {
      const nativeId = all.get(t.id)?.game_origin?.row_id;
      const resource =
        all.get(t.id)?.game_origin?.resource === 'mission_en' ? 'mission_ru' : 'article_ru';
      const nativeEvidence = (t.references ?? [])
        .map((ref) => index.evidence.get(ref))
        .find(
          (ev) =>
            ev?.source_id === t.source &&
            ev.game_origin?.resource === resource &&
            ev.game_origin.row_id === nativeId,
        );
      if (!nativeEvidence)
        fail(`${t.id}: game translation lacks matching Russian native ID evidence`);
      else {
        try {
          const facts = JSON.parse(nativeEvidence.excerpt);
          const expectedCodec =
            resource === 'mission_ru' ? RUSSIAN_MISSION_NAME_CODEC : RUSSIAN_ARTICLE_NAME_CODEC;
          const decode =
            resource === 'mission_ru' ? decodeRussianMissionName : decodeRussianArticleName;
          if (
            facts.decoder !== expectedCodec ||
            facts.name_ru !== t.name_ru ||
            decode(facts.raw_name_ru) !== t.name_ru
          )
            fail(`${t.id}: translation differs from decoded native evidence`);
        } catch {
          fail(`${t.id}: unreadable Russian native evidence`);
        }
      }
    }
  }
  for (const key of collections) {
    const pending = data[key].filter((r) => r.verification_status !== 'verified').length;
    if (pending) warnings.push(`${key}: ${pending} records require source review`);
  }
  return { errors, warnings };
}

export async function validateSnapshots(
  data,
  { snapshots = new Map(), directory = path.join(dataDir, 'evidence') } = {},
) {
  const errors = [];
  const loaded = new Map();
  const checksums = new Map();
  const normalized = new Map();
  const nativeRows = new Map();
  for (const ev of data.evidence) {
    try {
      if (!/^[a-z0-9][a-z0-9._-]*\.(txt|md|json|html)$/.test(ev.snapshot)) {
        errors.push(`${ev.id}: invalid snapshot path`);
        continue;
      }
      if (!loaded.has(ev.snapshot))
        loaded.set(
          ev.snapshot,
          snapshots.has(ev.snapshot)
            ? snapshots.get(ev.snapshot)
            : await readFile(path.join(directory, ev.snapshot), 'utf8'),
        );
      const raw = loaded.get(ev.snapshot);
      if (!checksums.has(ev.snapshot)) {
        checksums.set(ev.snapshot, hash(raw));
        normalized.set(ev.snapshot, raw.replace(/\r\n/g, '\n'));
        if (ev.snapshot.endsWith('.json')) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed.rows))
            nativeRows.set(ev.snapshot, new Set(parsed.rows.map((row) => JSON.stringify(row))));
        }
      }
      if (checksums.get(ev.snapshot) !== ev.snapshot_sha256)
        errors.push(`${ev.id}: snapshot checksum mismatch`);
      const present =
        ev.game_origin && nativeRows.has(ev.snapshot)
          ? nativeRows.get(ev.snapshot).has(ev.excerpt)
          : normalized.get(ev.snapshot).includes(ev.excerpt.replace(/\r\n/g, '\n'));
      if (!present) errors.push(`${ev.id}: excerpt not found in snapshot`);
    } catch (error) {
      errors.push(`${ev.id}: ${error.message}`);
    }
  }
  return errors;
}

export function qualityReport(data, issues = []) {
  const coverage = {};
  for (const key of collections) {
    const records = data[key];
    coverage[key] = {
      total: records.length,
      verified: records.filter((r) => r.verification_status === 'verified').length,
      partial: records.filter((r) => r.verification_status === 'partial').length,
      unverified: records.filter((r) => r.verification_status === 'unverified').length,
      incomplete: records.filter((r) => r.missing_fields.length > 0).length,
      universe_total: null,
      missing_from_universe: null,
    };
  }
  const named = collections
    .filter((k) => !['recipes', 'drops'].includes(k))
    .flatMap((k) => data[k]);
  const tr = new Map(data.translations.map((t) => [t.id, t]));
  return {
    game: 'ger',
    checked_at: [...data.sources.map((s) => s.checked_at), ...named.map((r) => r.checked_at)]
      .sort()
      .at(-1),
    completeness: 'partial',
    baseline: null,
    notice_ru: data.sources.some((s) => s.acquisition === 'game_files')
      ? data.drops.some((d) => d.game_origin?.resource === 'mission_en')
        ? data.drops.some((d) => d.pool_weight !== undefined)
          ? 'Из файлов GER добавлены русские названия миссий, основные и поддержанные условные награды, раскол защиты по частям, пожирание и сбор. Проценты наград относятся к отдельным позициям. Веса раскола, пожирания и сбора сохранены отдельно и не объявляются подтверждёнными шансами. Неизвестные коды условий и модификаторы требуют проверки. Полнота относительно игры и ручная проверка не завершены.'
          : 'Материалы, снаряжение, элементы, рецепты и основные награды сопоставленных миссий дополнены данными установленной GER. Проценты наград относятся к отдельным позициям. Бонусные условия, пожирание, разрушения и сбор ещё не покрыты полностью. Структура и контрольные суммы проверены автоматически; ручная проверка не завершена. Полнота относительно игры не установлена.'
        : 'Материалы, снаряжение и рецепты дополнены данными установленной GER. Структура и контрольные суммы проверены автоматически; ручная проверка доступности контента и условий открытия не завершена. Миссии и способы получения пока основаны на копиях Wiki. Полнота относительно игры не установлена.'
      : 'Начальный набор по поисковым копиям Wiki. Оригиналы недоступны (HTTP 403), игровые данные не подтверждены вручную. Полнота относительно игры не установлена.',
    coverage,
    translations: {
      total: named.length,
      official: named.filter((r) => tr.get(r.id)?.status === 'official').length,
      verified: named.filter((r) => tr.get(r.id)?.status === 'verified').length,
      drafts: named.filter((r) => tr.get(r.id)?.name_ru && tr.get(r.id)?.status === 'unverified')
        .length,
      missing: named.filter((r) => !tr.get(r.id)?.name_ru).length,
      from_game_files: named.filter(
        (r) =>
          tr.get(r.id)?.name_ru &&
          data.sources.some((s) => s.id === tr.get(r.id)?.source && s.acquisition === 'game_files'),
      ).length,
    },
    missing: collections.flatMap((k) =>
      data[k]
        .filter((r) => r.missing_fields.length)
        .map((r) => ({ collection: k, id: r.id, name_en: r.name_en, fields: r.missing_fields })),
    ),
    issues,
  };
}
