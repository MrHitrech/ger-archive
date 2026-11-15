import { idFor, hash } from './files.mjs';

export const equipmentCategories = {
  14: 'short_blade',
  270: 'long_blade',
  526: 'buster_blade',
  782: 'boost_hammer',
  1038: 'charge_spear',
  1294: 'variant_scythe',
  15: 'sniper',
  271: 'assault',
  527: 'blast',
  783: 'shotgun',
  16: 'buckler',
  272: 'shield',
  528: 'tower_shield',
  17: 'upgrade',
};
export function equipmentCategory(code) {
  if ((code & 255) === 12 && code >>> 8 <= 2) return 'clothing_top';
  if ((code & 255) === 13 && code >>> 8 <= 2) return 'clothing_bottom';
  return equipmentCategories[code] ?? null;
}
export const usableGameName = (name) =>
  typeof name === 'string' &&
  !!name.trim() &&
  !/[\x00-\x1f\x7f\u3040-\u9fff]|MatPlaceholder|\[PH\]|\b(?:dummy|test|placeholder|deleted)\b/i.test(
    name,
  );
export const usableRussianName = (name) =>
  typeof name === 'string' && !!name.trim() && !/[\x00-\x1f\x7f\ufffd]/.test(name);
const unique = (values) => [...new Set(values)];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const normalizedIngredients = (ingredients) => {
  const counts = new Map();
  for (const { id, quantity } of ingredients) counts.set(id, (counts.get(id) ?? 0) + quantity);
  return [...counts].map(([id, quantity]) => ({ id, quantity })).sort((a, b) => a.id - b.id);
};

/** Builds an entire candidate dataset without writing to the public data directory. */
export function createGameImport(
  current,
  { manifest, decoded },
  { checkedAt, sample = false, articleMappings = [] } = {},
) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(checkedAt ?? '') ||
    new Date(checkedAt).toISOString().slice(0, 10) !== checkedAt
  )
    throw new Error('An explicit valid check date is required');
  if (manifest.app_id !== '460870' || manifest.format_version !== 1)
    throw new Error('Unsupported game export');
  const data = structuredClone(current),
    sourceId = `game-steam-460870-${manifest.build_id}`;
  const articles = new Map(decoded.article_en.map((r) => [r.id, r])),
    russian = new Map(decoded.article_ru.map((r) => [r.id, r.name]));
  if (articles.size !== decoded.article_en.length || russian.size !== decoded.article_ru.length)
    throw new Error('Duplicate native article ID');
  if (articles.size !== russian.size || [...articles.keys()].some((id) => !russian.has(id)))
    throw new Error('EN/RU article ID sets differ');
  const issues = [],
    blocking = [],
    changes = [],
    idMap = [],
    snapshotRows = new Map(),
    evidence = new Map(data.evidence.map((r) => [r.id, r]));
  const priorSources = new Map(data.sources.map((r) => [r.id, r]));
  const source = {
    id: sourceId,
    title: `God Eater Resurrection — Steam, сборка ${manifest.build_id}`,
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
    resources: Object.fromEntries(
      Object.entries(manifest.resources).map(([key, value]) => {
        const { local_file, ...metadata } = value;
        return [key, metadata];
      }),
    ),
    note_ru:
      'Факты извлечены из файлов установленной игры. Проверка структуры и контрольных сумм выполнена автоматически; доступность контента и нерасшифрованные поля требуют проверки в игре.',
  };
  const priorSource = priorSources.get(sourceId);
  if (priorSource) data.sources[data.sources.findIndex((s) => s.id === sourceId)] = source;
  else data.sources.push(source);
  function issue(code, name, detail, extra = {}) {
    issues.push({ code, name, detail, source_id: sourceId, ...extra });
  }
  function origin(resource, row) {
    const metadata = manifest.resources[resource];
    if (!metadata) throw new Error(`Resource metadata missing: ${resource}`);
    return {
      source_id: sourceId,
      resource,
      row_id: row.id,
      resource_sha256: metadata.sha256,
      ...(row.record_offset !== undefined ? { byte_offset: row.record_offset } : {}),
    };
  }
  function proof(resource, row, facts) {
    const excerpt = JSON.stringify({ resource, row_id: row.id, ...facts });
    const id = `ev-${hash(`${sourceId}|${manifest.resources[resource].sha256}|${excerpt}`).slice(0, 16)}`;
    const snapshot = `game-${manifest.build_id}-${resource.replaceAll('_', '-')}-${manifest.resources[resource].sha256.slice(0, 12)}.json`;
    if (!snapshotRows.has(snapshot))
      snapshotRows.set(snapshot, {
        resource,
        rows: new Map(
          data.evidence
            .filter((ev) => ev.snapshot === snapshot)
            .map((ev) => [JSON.parse(ev.excerpt).row_id, ev.excerpt]),
        ),
      });
    snapshotRows.get(snapshot).rows.set(row.id, excerpt);
    evidence.set(id, {
      id,
      source_id: sourceId,
      game: 'ger',
      section: `God Eater Resurrection / ${manifest.resources[resource].resource_path} / row ${row.id}`,
      excerpt,
      snapshot,
      snapshot_sha256: '',
      game_origin: origin(resource, row),
    });
    return id;
  }
  const nativeArticleKey = (r) =>
    r.game_origin?.resource === 'article_en' &&
    (priorSources.get(r.game_origin.source_id)?.app_id === '460870' ||
      r.game_origin.source_id === sourceId)
      ? r.game_origin.row_id
      : null;
  const index = Object.fromEntries(
    ['items', 'materials', 'recipes'].map((key) => [key, new Map(data[key].map((r) => [r.id, r]))]),
  );
  const nativeItems = new Map(),
    nativeMaterials = new Map();
  const oldArticles = new Map();
  for (const key of ['items', 'materials'])
    for (const r of data[key]) {
      const native = nativeArticleKey(r);
      if (native !== null) {
        if (oldArticles.has(native))
          throw new Error(`Native article already mapped twice: ${native}`);
        oldArticles.set(native, { collection: key, record: r });
      }
    }
  const rawRecipes = [
    ...decoded.forge.map((r) => ({ ...r, resource: 'forge', operation: 'craft' })),
    ...decoded.upgrades.map((r) => ({ ...r, resource: 'upgrades', operation: 'upgrade' })),
  ].filter(
    (r) =>
      !sample ||
      (r.resource === 'forge' && r.result_id === 10719) ||
      (r.resource === 'upgrades' && r.result_id === 10720 && r.base_id === 10719),
  );
  const valid = [];
  for (const row of rawRecipes) {
    const target = articles.get(row.result_id),
      base = row.base_id === null ? null : articles.get(row.base_id);
    let reason;
    if (!target || (row.base_id !== null && !base))
      reason = `Не найден предмет: ${!target ? row.result_id : row.base_id}.`;
    else if (!usableGameName(target.name) || (base && !usableGameName(base.name)))
      reason = 'Служебное, тестовое или нерасшифрованное название.';
    else if (
      !equipmentCategory(target.category_code) ||
      (base && equipmentCategory(base.category_code) !== equipmentCategory(target.category_code))
    )
      reason = 'Категория снаряжения не установлена или меняется при улучшении.';
    else if (!Number.isSafeInteger(row.price) || row.price < 0)
      reason = 'Не установлена корректная стоимость.';
    else if (
      !row.ingredients.length ||
      row.ingredients.some(
        (i) =>
          !Number.isSafeInteger(i.quantity) ||
          i.quantity <= 0 ||
          !articles.has(i.id) ||
          (articles.get(i.id).category_code & 255) !== 10 ||
          !usableGameName(articles.get(i.id).name),
      )
    )
      reason = 'Неоднозначный ингредиент или количество.';
    if (reason) {
      issue(
        'GAME_ROW_QUARANTINED',
        `${row.resource}/${row.id}: ${target?.name ?? row.result_id}`,
        reason,
        { native_id: row.id, resource: row.resource },
      );
      continue;
    }
    valid.push({ ...row, ingredients: normalizedIngredients(row.ingredients) });
  }
  // Detect cycles before assigning families or building any planner-visible recipes.
  const parents = new Map();
  for (const r of valid)
    if (r.base_id !== null)
      parents.set(r.result_id, [...(parents.get(r.result_id) ?? []), r.base_id]);
  const visiting = new Set(),
    done = new Set();
  function visit(id) {
    if (visiting.has(id)) {
      blocking.push({ code: 'UPGRADE_CYCLE', id });
      return;
    }
    if (done.has(id)) return;
    visiting.add(id);
    for (const base of parents.get(id) ?? []) visit(base);
    visiting.delete(id);
    done.add(id);
  }
  for (const id of parents.keys()) visit(id);
  const itemIds = new Set(
    valid.flatMap((r) => [r.result_id, ...(r.base_id === null ? [] : [r.base_id])]),
  );
  const materialIds = new Set(valid.flatMap((r) => r.ingredients.map((i) => i.id)));
  if (!sample)
    for (const record of data.materials) {
      const matches = decoded.article_en.filter(
        (r) =>
          (r.category_code & 255) === 10 && r.name === record.name_en && usableGameName(r.name),
      );
      if (matches.length === 1) materialIds.add(matches[0].id);
    }
  function put(collection, record) {
    const prior = index[collection].get(record.id);
    const fields =
      collection === 'recipes'
        ? ['item_id', 'operation', 'from_item_id', 'materials', 'cost_fc', 'required_rank']
        : ['name_en', 'category', 'rank'];
    const equivalent = (field, a, b) =>
      field === 'materials'
        ? same(
            [...a].sort((x, y) => x.material_id.localeCompare(y.material_id)),
            [...b].sort((x, y) => x.material_id.localeCompare(y.material_id)),
          )
        : same(a, b);
    const differences = prior
      ? Object.fromEntries(
          fields
            .filter((f) => !equivalent(f, prior[f], record[f]))
            .map((f) => [f, { before: prior[f], after: record[f] }]),
        )
      : {};
    if (Object.keys(differences).length)
      changes.push({ collection, id: record.id, name_en: record.name_en, fields: differences });
    index[collection].set(record.id, record);
  }
  function article(collection, id) {
    const row = articles.get(id),
      category = collection === 'items' ? equipmentCategory(row.category_code) : 'unknown';
    const mapped = oldArticles.get(id);
    if (mapped && mapped.collection !== collection) {
      blocking.push({ code: 'COLLECTION_CONFLICT', native_id: id });
      return null;
    }
    const names = data[collection].filter(
      (r) =>
        !r.game_origin &&
        r.name_en === row.name &&
        (collection !== 'items' || r.category === category),
    );
    const candidates = decoded.article_en.filter(
      (r) =>
        r.name === row.name &&
        (collection !== 'items' || equipmentCategory(r.category_code) === category) &&
        ((r.category_code & 255) === 10) === (collection === 'materials'),
    );
    if (!mapped && names.length && (names.length !== 1 || candidates.length !== 1)) {
      blocking.push({ code: 'AMBIGUOUS_ID_MATCH', collection, native_id: id, name: row.name });
      return null;
    }
    const explicit = articleMappings.find(
      (mapping) => mapping.native_id === id && mapping.collection === collection,
    );
    const explicitOld = explicit
      ? data[collection].find((record) => record.id === explicit.existing_id)
      : null;
    if (
      explicit &&
      (!explicitOld ||
        explicit.canonical_name !== row.name ||
        ![explicit.previous_name, explicit.canonical_name].includes(explicitOld.name_en) ||
        (mapped && mapped.record.id !== explicit.existing_id))
    ) {
      blocking.push({ code: 'INVALID_EXPLICIT_MAPPING', native_id: id, collection });
      return null;
    }
    const old = mapped?.record ?? explicitOld ?? names[0],
      siteId = old?.id ?? idFor(collection === 'items' ? 'i' : 'm', `steam:460870:article:${id}`);
    const ev = proof('article_en', row, {
      name_en: row.name,
      category_code: row.category_code,
      rank: row.rank,
    });
    const rank = Number.isInteger(row.rank) && row.rank >= 1 && row.rank <= 14 ? row.rank : null;
    const record = {
      ...(old ?? {}),
      id: siteId,
      game: 'ger',
      name_en: row.name,
      verification_status: 'partial',
      checked_at: checkedAt,
      references: unique([...(old?.references ?? []), ev]),
      missing_fields: unique([...(old?.missing_fields ?? []), 'in_game_availability']),
      game_origin: origin('article_en', row),
    };
    if (old?.verification_status === 'verified')
      blocking.push({ code: 'REVIEWED_RECORD_CHANGE', collection, id: old.id });
    if (collection === 'items')
      Object.assign(record, {
        category,
        rank,
        family: old?.family ?? row.name,
        stats: old?.stats ?? {},
        elements: old?.elements ?? [],
        skills_en: old?.skills_en ?? [],
      });
    else
      Object.assign(record, {
        category: old?.category ?? 'unknown',
        ranks: old?.ranks ?? [],
        description_ru: old?.description_ru ?? null,
      });
    if (collection === 'items') {
      if (rank === null) record.missing_fields = unique([...record.missing_fields, 'rank']);
      if (!old)
        record.missing_fields = unique([...record.missing_fields, 'stats', 'elements', 'skills']);
    } else if (!old)
      record.missing_fields = unique([
        ...record.missing_fields,
        'category',
        'acquisition_coverage',
      ]);
    put(collection, record);
    (collection === 'items' ? nativeItems : nativeMaterials).set(id, record);
    idMap.push({ collection, game_id: id, site_id: siteId, preserved_existing_id: !!old });
    if (old && old.name_en !== record.name_en) {
      const translation = data.translations.find((t) => t.id === siteId);
      if (translation) {
        translation.aliases = unique([...translation.aliases, translation.name_en]);
        translation.name_en = record.name_en;
      }
    }
    const text = russian.get(id);
    if (
      !data.translations.some((t) => t.id === siteId) &&
      usableRussianName(text) &&
      text !== row.name
    ) {
      const ruRow = decoded.article_ru.find((r) => r.id === id),
        ref = proof('article_ru', ruRow, { name_ru: text });
      data.translations.push({
        id: siteId,
        name_en: row.name,
        name_ru: text,
        aliases: [],
        source: sourceId,
        status: 'unverified',
        references: [ref],
      });
    }
    return record;
  }
  for (const id of [...materialIds].sort((a, b) => a - b)) article('materials', id);
  for (const id of [...itemIds].sort((a, b) => a - b)) article('items', id);
  const groupKey = (r) => `${r.result_id}|${r.operation}|${r.base_id}`;
  const groups = new Map();
  for (const r of valid) groups.set(groupKey(r), [...(groups.get(groupKey(r)) ?? []), r]);
  const usedRecipes = new Set();
  for (const row of valid) {
    const target = nativeItems.get(row.result_id),
      base = row.base_id === null ? null : nativeItems.get(row.base_id);
    if (
      !target ||
      (row.base_id !== null && !base) ||
      row.ingredients.some((i) => !nativeMaterials.has(i.id))
    )
      continue;
    const materials = row.ingredients.map((i) => ({
      material_id: nativeMaterials.get(i.id).id,
      quantity: i.quantity,
    }));
    const oldNative = data.recipes.filter(
      (r) =>
        r.game_origin?.resource === row.resource &&
        r.game_origin.row_id === row.id &&
        (priorSources.get(r.game_origin.source_id)?.app_id === '460870' ||
          r.game_origin.source_id === sourceId),
    );
    const semantic = data.recipes.filter(
      (r) =>
        !r.game_origin &&
        r.item_id === target.id &&
        r.operation === row.operation &&
        r.from_item_id === (base?.id ?? null),
    );
    let old;
    if (oldNative.length === 1) old = oldNative[0];
    else if (oldNative.length > 1)
      blocking.push({ code: 'AMBIGUOUS_RECIPE_ID', native_id: row.id, resource: row.resource });
    else if (semantic.length === 1 && groups.get(groupKey(row)).length === 1) old = semantic[0];
    else if (semantic.length) {
      const exact = semantic.filter(
        (r) =>
          r.cost_fc === row.price &&
          same(
            [...r.materials].sort((a, b) => a.material_id.localeCompare(b.material_id)),
            [...materials].sort((a, b) => a.material_id.localeCompare(b.material_id)),
          ),
      );
      if (exact.length === 1 && !usedRecipes.has(exact[0].id)) old = exact[0];
      else
        blocking.push({
          code: 'AMBIGUOUS_RECIPE_MATCH',
          native_id: row.id,
          resource: row.resource,
          name: target.name_en,
        });
    }
    if (old?.verification_status === 'verified')
      blocking.push({ code: 'REVIEWED_RECORD_CHANGE', collection: 'recipes', id: old.id });
    const ev = proof(row.resource, row, {
      result_id: row.result_id,
      base_id: row.base_id,
      price: row.price,
      ingredients: row.ingredients,
      unlock_raw: row.unlock_raw,
    });
    const id = old?.id ?? idFor('r', `steam:460870:${row.resource}:${row.id}`);
    if (usedRecipes.has(id)) {
      blocking.push({ code: 'RECIPE_ID_REUSED', id });
      continue;
    }
    usedRecipes.add(id);
    put('recipes', {
      ...(old ?? {}),
      id,
      game: 'ger',
      name_en: `${target.name_en} — ${row.operation}`,
      verification_status: 'partial',
      checked_at: checkedAt,
      references: unique([...(old?.references ?? []), ev]),
      missing_fields: unique([
        ...(old?.missing_fields ?? []),
        'unlock_conditions',
        'in_game_availability',
        ...(row.resource === 'upgrades' ? ['packed_layout_review'] : []),
      ]),
      item_id: target.id,
      operation: row.operation,
      from_item_id: base?.id ?? null,
      materials,
      cost_fc: row.price,
      required_rank: target.rank,
      unlock_conditions_raw: row.unlock_raw,
      game_origin: origin(row.resource, row),
    });
    idMap.push({
      collection: 'recipes',
      table: row.resource,
      game_id: row.id,
      site_id: id,
      preserved_existing_id: !!old,
    });
  }
  // Families come from actual upgrade connectivity, rather than a name/suffix heuristic.
  const union = new Map([...nativeItems.keys()].map((id) => [id, id]));
  const find = (id) => {
    let root = id;
    while (union.get(root) !== root) root = union.get(root);
    while (id !== root) {
      const next = union.get(id);
      union.set(id, root);
      id = next;
    }
    return root;
  };
  for (const r of valid)
    if (r.base_id !== null && union.has(r.result_id) && union.has(r.base_id))
      union.set(find(r.result_id), find(r.base_id));
  const components = new Map();
  for (const [id, record] of nativeItems) {
    const key = find(id);
    components.set(key, [...(components.get(key) ?? []), { id, record }]);
  }
  for (const component of components.values()) {
    const roots = component
      .filter(({ id }) => !parents.has(id))
      .sort((a, b) => (a.record.rank ?? 99) - (b.record.rank ?? 99) || a.id - b.id);
    const family = (roots[0] ?? component[0]).record.name_en;
    for (const { record } of component) record.family = family;
  }
  for (const collection of ['items', 'materials', 'recipes'])
    data[collection] = [...index[collection].values()].sort((a, b) => a.id.localeCompare(b.id));
  if (!sample)
    for (const record of data.materials.filter((r) => !r.game_origin)) {
      record.missing_fields = unique([...record.missing_fields, 'native_identity']);
      issue(
        'GAME_LEGACY_MATERIAL_UNMATCHED',
        record.name_en,
        `Существующая запись ${record.id} сохранена для совместимости, но её соответствие игровому ID не установлено. Она не используется для подстановки ингредиентов в извлечённые рецепты.`,
      );
    }
  const snapshots = new Map();
  for (const [name, entry] of snapshotRows) {
    const lines = [...entry.rows].sort(([a], [b]) => a - b).map(([, line]) => `    ${line}`);
    const content = `{\n  "app_id": "460870",\n  "build_id": "${manifest.build_id}",\n  "resource_path": ${JSON.stringify(manifest.resources[entry.resource].resource_path)},\n  "resource_sha256": "${manifest.resources[entry.resource].sha256}",\n  "rows": [\n${lines.join(',\n')}\n  ]\n}\n`;
    snapshots.set(name, content);
    const checksum = hash(content);
    for (const ev of evidence.values()) if (ev.snapshot === name) ev.snapshot_sha256 = checksum;
  }
  data.evidence = [...evidence.values()].sort((a, b) => a.id.localeCompare(b.id));
  issue(
    'GAME_AVAILABILITY_REVIEW',
    'Доступность извлечённого контента',
    'Импорт ограничен рабочими таблицами рецептов и связанными предметами. Наличие записи в таблице не подтверждает её доступность игроку.',
  );
  issue(
    'GAME_PACKED_LAYOUT_REVIEW',
    'Поля улучшений и условия открытия',
    'Структура KST проверена автоматически; ручная сверка с экраном игры ещё требуется. Сюжетные условия сохранены как исходные числа, а не преобразованы в ранги.',
  );
  const undecodedRussian = [...new Set([...itemIds, ...materialIds])].filter(
    (id) => !usableRussianName(russian.get(id)),
  ).length;
  if (undecodedRussian)
    issue(
      'GAME_TEXT_ENCODING',
      'Русские названия предметов',
      `${undecodedRussian} названий содержат специальные байты. Существующие переводы сохранены; повреждённые строки не используются как перевод.`,
    );
  const counts = Object.fromEntries(
    ['materials', 'items', 'recipes'].map((key) => [
      key,
      {
        before: current[key].length,
        after: data[key].length,
        added: data[key].filter((r) => !current[key].some((old) => old.id === r.id)).length,
        updated: data[key].filter((r) => {
          const old = current[key].find((v) => v.id === r.id);
          return old && !same(old, r);
        }).length,
      },
    ]),
  );
  return {
    dataset: data,
    snapshots,
    issues,
    idMap,
    report: {
      game: 'ger',
      app_id: '460870',
      build_id: manifest.build_id,
      checked_at: checkedAt,
      sample,
      counts,
      selected_rows: rawRecipes.length,
      accepted_rows: valid.length,
      quarantined_rows: rawRecipes.length - valid.length,
      preserved_existing_ids: idMap.filter((r) => r.preserved_existing_id).length,
      factual_changes: changes,
      blocking,
      undecoded_russian_names: undecodedRussian,
      issues,
      scope:
        'Materials used by equipment recipes, equipment including clothing, craft and upgrade recipes. Missions, drops and synthesis are not changed.',
    },
  };
}
