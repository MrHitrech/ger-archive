import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { dataDir, hash, idFor } from './lib/files.mjs';
import { scopedSection, parseEquipment, equipmentKey } from './lib/importer.mjs';

// A reproducible import of explicitly bounded Resurrection sections, not a web crawler.
const DATE = '2026-11-14';
export async function createSeed() {
  const dataset = Object.fromEntries(
    [
      'materials',
      'items',
      'recipes',
      'missions',
      'aragami',
      'locations',
      'drops',
      'sources',
      'evidence',
      'translations',
    ].map((k) => [k, []]),
  );
  const issues = [];
  const snapshots = new Map();
  for (let i = 1; i <= 7; i++) {
    const file = `search-${i}.txt`;
    const raw = await readFile(path.join(dataDir, 'evidence', file), 'utf8');
    snapshots.set(file, { text: raw.replace(/\r\n/g, '\n'), sha: hash(raw) });
  }
  const sources = [
    [
      'wiki-missions',
      'Missions / God Eater Resurrection',
      'Missions/God_Eater_Resurrection',
      'ger',
    ],
    [
      'wiki-story',
      'Resurrection — Story Missions',
      'Missions/God_Eater_Resurrection_-_Story_Missions',
      'ger',
    ],
    ['wiki-short', 'Short Blade — Resurrection', 'Short_Blade', 'mixed'],
    ['wiki-shield', 'Shield — Resurrection', 'Shield', 'mixed'],
    ['wiki-buckler', 'Buckler Shield — Resurrection', 'Buckler_Shield', 'mixed'],
    ['wiki-scythe', 'Variant Scythe — Resurrection', 'Variant_Scythe', 'mixed'],
    ['wiki-upgrades', 'Upgrades — Resurrection', 'Upgrades', 'mixed'],
    [
      'wiki-ru-materials',
      'Материалы God Eater Resurrection',
      'Материалы_God_Eater_Resurrection',
      'ger',
    ],
    [
      'wiki-ogretail-advanced',
      'Ogretail / Advanced Information (смешанные игры)',
      'Ogretail/Advanced_Information',
      'mixed',
    ],
  ];
  dataset.sources = sources.map(([id, title, page, scope]) => {
    const url = `https://godeater.fandom.com/${id === 'wiki-ru-materials' ? 'ru/' : ''}wiki/${page}`;
    return {
      id,
      title,
      url,
      game_scope: scope,
      acquisition: 'search_index',
      checked_at: DATE,
      revision: null,
      license: 'CC-BY-SA-3.0 (text; page-specific notice requires original-page review)',
      authors_url: `${url}?action=history`,
      note_ru:
        'Доступна поисковая копия. Прямой доступ вернул HTTP 403; актуальная ревизия не установлена.',
    };
  });
  function evidence(source, snapshot, section, excerpt) {
    const id = `ev-${hash(`${source}|${snapshot}|${section}|${excerpt}`).slice(0, 16)}`;
    if (!dataset.evidence.some((e) => e.id === id))
      dataset.evidence.push({
        id,
        source_id: source,
        game: 'ger',
        section,
        excerpt,
        snapshot,
        snapshot_sha256: snapshots.get(snapshot).sha,
      });
    return id;
  }
  function base(kind, key, name, ref, missing = []) {
    return {
      id: idFor(kind, key),
      game: 'ger',
      name_en: name,
      verification_status: 'partial',
      checked_at: DATE,
      references: [ref],
      missing_fields: missing,
    };
  }
  function material(name, ref) {
    let record = dataset.materials.find((m) => m.name_en === name);
    if (!record) {
      record = {
        ...base('m', name, name, ref, ['category', 'acquisition_coverage']),
        category: 'unknown',
        ranks: [],
        description_ru: null,
      };
      dataset.materials.push(record);
    } else if (!record.references.includes(ref)) record.references.push(ref);
    return record;
  }
  const equipment = [];
  const short = scopedSection(
    snapshots.get('search-3.txt').text,
    '\n## God Eater Resurrection\n',
    '\n### Cursed Blade\n',
  );
  equipment.push(
    ...parseEquipment(short, { category: 'short_blade', family: 'Knife P', expectedCount: 26 }).map(
      (r) => ({ ...r, source: 'wiki-short', snapshot: 'search-3.txt' }),
    ),
  );
  const shields = scopedSection(
    snapshots.get('search-2.txt').text,
    '\n## God Eater Resurrection\n',
    '\n### Oni Shield\n',
  );
  const saintStart = shields.indexOf('\n### Saint Germain\n');
  const decoyStart = shields.indexOf('\n### Decoy Shield\n');
  const saint = shields.slice(saintStart, shields.indexOf(' | Faust\n', saintStart));
  equipment.push(
    ...parseEquipment(saint, { category: 'shield', family: 'Saint Germain', expectedCount: 4 }).map(
      (r) => ({ ...r, source: 'wiki-shield', snapshot: 'search-2.txt' }),
    ),
  );
  equipment.push(
    ...parseEquipment(shields.slice(decoyStart), {
      category: 'shield',
      family: 'Decoy Shield',
      expectedCount: 8,
    }).map((r) => ({ ...r, source: 'wiki-shield', snapshot: 'search-2.txt' })),
  );
  const bucklerAll = scopedSection(
    snapshots
      .get('search-2.txt')
      .text.slice(snapshots.get('search-2.txt').text.indexOf('Buckler Shield | God Eater Wiki')),
    '\n## God Eater Resurrection\n',
  );
  const buckler = bucklerAll.split(
    '\n--------------------------------------------------------------------------------',
  )[0];
  equipment.push(
    ...parseEquipment(buckler, {
      category: 'buckler',
      family: 'Polished Buckler',
      expectedCount: 5,
    }).map((r) => ({ ...r, source: 'wiki-buckler', snapshot: 'search-2.txt' })),
  );
  const scythe = scopedSection(
    snapshots.get('search-5.txt').text,
    '\n## God Eater Resurrection[]\n',
  ).split('\n--------------------------------------------------------------------------------')[0];
  equipment.push(
    ...parseEquipment(scythe, {
      category: 'variant_scythe',
      family: 'Dama de Ferro',
      expectedCount: 3,
    }).map((r) => ({ ...r, source: 'wiki-scythe', snapshot: 'search-5.txt' })),
  );
  for (const row of equipment) {
    const ref = evidence(
      row.source,
      row.snapshot,
      `God Eater Resurrection / ${row.family} / ${row.name_en}`,
      row.excerpt,
    );
    const item = {
      ...base('i', `${row.category}|${row.name_en}`, row.name_en, ref, ['original_page_review']),
      category: row.category,
      rank: row.rank,
      family: row.family,
      elements: row.elements,
      stats: row.stats,
      skills_en: row.skills_en,
    };
    dataset.items.push(item);
    const previous = row.previous
      ? equipment.find((r) => r.category === row.category && r.name_en === row.previous)
      : null;
    if (row.previous && !previous)
      throw new Error(`Missing predecessor for ${row.name_en}: ${row.previous}`);
    dataset.recipes.push({
      ...base(
        'r',
        `${item.id}|${row.previous || 'craft'}`,
        `${row.name_en} — ${previous ? 'upgrade' : 'craft'}`,
        ref,
        ['original_page_review'],
      ),
      item_id: item.id,
      operation: previous ? 'upgrade' : 'craft',
      from_item_id: previous ? equipmentKey(previous) : null,
      materials: row.materials.map((m) => ({
        material_id: material(m.name_en, ref).id,
        quantity: m.quantity,
      })),
      cost_fc: row.cost_fc,
      required_rank: row.rank,
    });
  }
  // Small, unambiguous module recipes only. DEF and duplicate Item Effect stay in quarantine.
  const upgrades = scopedSection(
    snapshots.get('search-1.txt').text,
    '\n### God Eater Resurrection\n',
  );
  const selectedUpgrades = [
    'Stamina',
    'Health',
    'Enemy HP Vision',
    'Charged Ability Speed',
    'Item Speed',
  ];
  for (const name of selectedUpgrades) {
    const line = upgrades.split('\n').find((l) => l.startsWith(`${name}  |`));
    if (!line) throw new Error(`Module missing: ${name}`);
    const [label, rank, requirements, skills] = line.split(/\s+\|\s+/);
    const cost = requirements.match(/^(\d+) Fc /);
    const parts = [...requirements.matchAll(/(\d+)x (.*?)(?= \d+x |$)/g)];
    if (!cost || !parts.length || !skills) throw new Error(`Bad module: ${line}`);
    const ref = evidence(
      'wiki-upgrades',
      'search-1.txt',
      `God Eater Resurrection / ${label}`,
      line,
    );
    const item = {
      ...base('i', `upgrade|${label}`, label, ref, ['original_page_review']),
      category: 'upgrade',
      rank: Number(rank),
      family: 'Upgrade Parts',
      elements: [],
      stats: {},
      skills_en: [skills],
    };
    dataset.items.push(item);
    dataset.recipes.push({
      ...base('r', `${item.id}|craft`, `${label} — craft`, ref, ['original_page_review']),
      item_id: item.id,
      operation: 'craft',
      from_item_id: null,
      materials: parts.map((p) => ({
        material_id: material(p[2], ref).id,
        quantity: Number(p[1]),
      })),
      cost_fc: Number(cost[1]),
      required_rank: Number(rank),
    });
  }
  const aragamiNames = [
    'Ogretail',
    'Zygote',
    'Cocoon Maiden',
    'Kongou',
    'Gboro-Gboro',
    'Chi-You',
    'Vajra',
    'Fallen Ogretail',
    'Fallen Kongou (Freeze)',
    'Fierce Kongou',
    'Quadriga',
    'Fallen Quadriga (Freeze)',
    'Borg Camlann',
    'Sariel',
    'Fallen Sariel',
    'Hannibal',
    'Corrosive Hannibal',
    'Blitz Hannibal',
    'Caligula',
    'Ravana',
    'Yaksha',
    'Yaksha Raja',
    'Arda Nova',
    'Fallen Arda Nova',
    'Arius Nova',
    'Arius Nova (Larval)',
    'Ouroboros',
    'Fallen Ouroboros',
    'Prithvi Mata',
    'Dyaus Pita',
    'Sekhmet',
    'Aether',
    'Amaterasu',
    "Susano'o",
    'Tsukuyomi',
    'Venus',
    'Tezcatlipoca',
    'Balfa Mata',
    'Golden Gboro-Gboro',
    'Fallen Chi-You (Spark)',
  ];
  for (const name of ['Cocoon Maiden', 'Zygote'])
    for (const element of ['Blaze', 'Freeze', 'Spark'])
      aragamiNames.push(`Fallen ${name} (${element})`);
  for (const element of ['Blaze', 'Freeze']) aragamiNames.push(`Fallen Gboro-Gboro (${element})`);
  for (const element of ['Blaze', 'Spark']) {
    aragamiNames.push(`Fallen Borg Camlann (${element})`);
    aragamiNames.push(`Vajratail (${element})`);
  }
  // Explicit singular forms; no fuzzy matching or cross-variant merging.
  const aliases = {
    Ogretails: 'Ogretail',
    Zygotes: 'Zygote',
    'Cocoon Maidens': 'Cocoon Maiden',
    'Chi-Yous': 'Chi-You',
    Kongous: 'Kongou',
    Gboros: 'Gboro-Gboro',
    Vajras: 'Vajra',
    Yakshas: 'Yaksha',
    'Fallen Orgetail': 'Fallen Ogretail',
  };
  for (const name of aragamiNames) {
    const plural = name
      .replace(/Cocoon Maiden/, 'Cocoon Maidens')
      .replace(/Zygote/, 'Zygotes')
      .replace(/Ogretail/, 'Ogretails')
      .replace(/^Vajratail/, 'Vajratails');
    if (plural !== name) aliases[plural] = name;
  }
  const getAragami = (name, ref) => {
    const canonical = name === 'Dyaus Pita' ? 'Dyaus Pita (God Eater Resurrection)' : name;
    let found = dataset.aragami.find((a) => a.name_en === canonical);
    if (!found) {
      found = {
        ...base('a', canonical, canonical, ref, [
          'breakable_parts',
          'drop_tables',
          'original_page_review',
        ]),
        variant: canonical,
        size: null,
        breakable_parts: null,
      };
      dataset.aragami.push(found);
    }
    return found;
  };
  function addMission({
    name,
    rank,
    type,
    location,
    enemies,
    objectives,
    snapshot,
    excerpt,
    story = false,
    section = `Standard Missions / Rank ${rank}`,
    source = 'wiki-missions',
  }) {
    const ref = evidence(source, snapshot, section, excerpt);
    const normalized = enemies
      .map((raw) => raw.replace(/^\d+ /, '').trim())
      .map((raw) => aliases[raw] || raw);
    const unknown = normalized.filter((n) => !aragamiNames.includes(n));
    if (unknown.length) {
      issues.push({
        code: 'AMBIGUOUS_ENEMY',
        name,
        source_id: source,
        excerpt,
        detail: `Не сопоставлены: ${unknown.join(', ')}`,
      });
      return null;
    }
    location =
      { 'sunken Grid': 'Sunken Grid', 'City Of Mercy': 'City of Mercy' }[location] || location;
    let field = dataset.locations.find((l) => l.name_en === location);
    if (!field) {
      field = base('l', location, location, ref, ['original_page_review']);
      dataset.locations.push(field);
    }
    const key = `${type}|${rank}|${location}|${name}`;
    const existing = dataset.missions.find((m) => m.id === idFor('q', key));
    if (existing) {
      if (!existing.references.includes(ref)) existing.references.push(ref);
      return existing;
    }
    const mission = {
      ...base('q', key, name, ref, ['rewards', 'original_page_review']),
      rank,
      type,
      variant: type === 'extra' ? section : 'standard',
      location_id: field.id,
      aragami_ids: [...new Set(normalized.map((n) => getAragami(n, ref).id))],
      objectives_en: objectives || enemies.join(', '),
      story,
      reward_table_status: 'missing',
      time_limit_seconds: null,
    };
    dataset.missions.push(mission);
    return mission;
  }
  for (const snapshot of ['search-4.txt', 'search-6.txt', 'search-7.txt']) {
    const text = snapshots.get(snapshot).text;
    const headers = [
      ...text.matchAll(
        /(?:^|\n|\. )(Rank (\d+)|Challenge)\n---\nMission  \| Target\/Objective  \| Field  \| Notes\n/g,
      ),
    ];
    for (const [i, header] of headers.entries()) {
      const rank = header[2] ? Number(header[2]) : 'challenge';
      const end = headers[i + 1]?.index ?? text.length;
      const segment = text
        .slice(header.index + header[0].length, end)
        .split(/\n## (?:Urgent|Extra) Missions/)[0];
      for (const line of segment.split('\n')) {
        const match = line.match(/^\d+\. ([^|]+)  \| ([^|]+)  \| ([^|]+)  \|(.*)$/);
        if (!match) continue;
        const [, name, targets, location, notes] = match;
        if (targets.trim() === 'Dummy Target' || targets.trim() === 'No Enemies') continue;
        addMission({
          name: name.trim(),
          rank,
          type: rank === 'challenge' ? 'challenge' : 'standard',
          location: location.trim(),
          enemies: targets.trim().split(/,\s*/),
          objectives: targets.trim(),
          snapshot,
          excerpt: line,
          story: /Story/i.test(notes),
        });
      }
    }
  }
  // Each extra mission is a separate variant. Multi-stage entries are not flattened.
  const extra = [
    ['Bandersnatch', 'Forgotten Carrier', ['Balfa Mata']],
    ['Snowdrop', 'Wailing Plains', ['Vajra', 'Quadriga', 'Borg Camlann', 'Sariel']],
    ['Disjunction', 'Infernal Subway', ['Fierce Kongou', 'Yaksha Raja']],
    ['Spider Lily', 'Forgotten Carrier', ["Susano'o", 'Caligula', 'Blitz Hannibal']],
  ];
  for (const [name, location, enemies] of extra) {
    const line = snapshots
      .get('search-4.txt')
      .text.split('\n')
      .find((l) => /^\d+\./.test(l) && l.includes(`. ${name}  |`));
    if (!line) throw new Error(`Missing extra mission: ${name}`);
    addMission({
      name,
      rank: 14,
      type: 'extra',
      location,
      enemies,
      snapshot: 'search-4.txt',
      excerpt: line,
      section: 'Extra Missions / Predator Pack 2 / Difficulty 14',
    });
  }
  const mayfliesLine = snapshots
    .get('search-4.txt')
    .text.split('\n')
    .find((l) => l.startsWith('1. Mayflies  |'));
  const mayflies = addMission({
    name: 'Mayflies',
    rank: 2,
    type: 'urgent',
    location: 'City of Mercy',
    enemies: ['Cocoon Maiden', 'Zygote', 'Ogretail'],
    snapshot: 'search-4.txt',
    excerpt: mayfliesLine,
    section: 'Urgent Missions / Difficulty 2',
  });
  const devil = dataset.missions.find((m) => m.name_en === "Devil's Tail");
  const missionText = snapshots.get('search-1.txt').text;
  const rewardStart = missionText.search(/^Mission Name:  \| Devil's Tail$/m);
  const rewardText =
    rewardStart >= 0
      ? missionText.slice(rewardStart).split(/^Mission Name:  \| Fallen Angel Egg$/m)[0]
      : null;
  if (!devil || !rewardText) throw new Error("Devil's Tail reward context missing.");
  devil.reward_table_status = 'partial';
  devil.time_limit_seconds = 1800;
  const rewardRows = rewardText.split('Rewards\n---\n')[1];
  let importedRewardRows = 0;
  for (const cell of rewardRows
    .split(/[ \t]+\|[ \t]+|\n/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    const m = cell.match(
      /^(.+) \((Automatic|Clear under 10 min\.|Clear with 30\+ Endurance)\) (\d+)%$/,
    );
    if (!m || / fc$/i.test(m[1])) continue;
    importedRewardRows++;
    const [, name, condition, chance] = m;
    const ref = evidence(
      'wiki-missions',
      'search-1.txt',
      "God Eater Resurrection / Devil's Tail / Rewards",
      cell,
    );
    const mat = material(name, ref);
    if (!mat.ranks.includes(1)) mat.ranks.push(1);
    const conditionRu =
      condition === 'Automatic'
        ? 'Автоматическая награда'
        : condition === 'Clear under 10 min.'
          ? 'Завершить менее чем за 10 минут'
          : 'Завершить с выносливостью 30+ (Endurance)';
    const dropId = idFor('d', `${devil.id}|${mat.id}|${condition}`);
    const prior = dataset.drops.find((d) => d.id === dropId);
    if (prior) {
      prior.drop_rate = null;
      prior.references.push(ref);
      prior.missing_fields.push('drop_rate');
      prior.condition_ru +=
        '. Повторяющиеся строки с разными шансами; модель награды требует проверки.';
      issues.push({
        code: 'AMBIGUOUS_REWARD_SLOTS',
        name: `${name} / Devil\'s Tail`,
        source_id: 'wiki-missions',
        detail:
          'Повторяющиеся автоматические награды с разными шансами. Вероятность оставлена null.',
      });
    } else
      dataset.drops.push({
        ...base(
          'd',
          `${devil.id}|${mat.id}|${condition}`,
          `${name} / Devil's Tail / ${condition}`,
          ref,
          ['quantity', 'reward_slot_model', 'original_page_review'],
        ),
        material_id: mat.id,
        mission_id: devil.id,
        aragami_id: null,
        location_id: devil.location_id,
        method: condition === 'Automatic' ? 'mission_reward' : 'bonus_reward',
        condition_ru: conditionRu,
        condition_en: condition,
        drop_rate: Number(chance),
        quantity: null,
        slot: null,
        source_url: dataset.sources.find((s) => s.id === 'wiki-missions').url,
      });
  }
  if (importedRewardRows !== 24)
    throw new Error(
      `Expected 24 Devil's Tail material reward rows; got ${importedRewardRows}. Review context and snapshot.`,
    );
  // Repeated rows in Mayflies do not establish independence or reward quantity.
  const storyText = snapshots.get('search-5.txt').text;
  const mayfliesExcerpt = storyText.slice(
    storyText.indexOf('\nMayflies\n---'),
    storyText.indexOf('If you check in with Hibari', storyText.indexOf('\nMayflies\n---')),
  );
  const ref = evidence(
    'wiki-story',
    'search-5.txt',
    'God Eater Resurrection / Story 4–5 / Mayflies / Rewards',
    mayfliesExcerpt,
  );
  const pixie = material('Pixie Thorn', ref);
  pixie.ranks = [2];
  mayflies.reward_table_status = 'partial';
  dataset.drops.push({
    ...base('d', `${mayflies.id}|${pixie.id}|ambiguous-automatic`, 'Pixie Thorn / Mayflies', ref, [
      'drop_rate',
      'quantity',
      'reward_slot_model',
      'original_page_review',
    ]),
    material_id: pixie.id,
    mission_id: mayflies.id,
    aragami_id: null,
    location_id: mayflies.location_id,
    method: 'mission_reward',
    condition_ru:
      'Автоматическая награда. В копии таблицы повторяются строки 25%; независимость бросков не установлена.',
    condition_en: 'Automatic; repeated 25% rows; slot independence unconfirmed',
    drop_rate: null,
    quantity: null,
    slot: null,
    source_url: dataset.sources.find((s) => s.id === 'wiki-story').url,
  });
  issues.push(
    {
      code: 'CROSS_GAME_REJECTED',
      name: 'Ogretail devour rates',
      source_id: 'wiki-ogretail-advanced',
      detail:
        'Таблица на Ogretail/Advanced_Information помечена God Eater Burst. Проценты не перенесены в Resurrection.',
    },
    {
      code: 'AMBIGUOUS_INGREDIENT',
      name: 'DEF',
      source_id: 'wiki-upgrades',
      detail:
        'В GER-таблице указан ингредиент 1x Ogretail. Рецепт исключён: это имя противника, корректный материал не установлен.',
    },
    {
      code: 'DUPLICATE_LABEL',
      name: 'Item Effect',
      source_id: 'wiki-upgrades',
      detail:
        'Две строки с одинаковым именем, разными материалами и навыками. Рецепты исключены до проверки.',
    },
    {
      code: 'AMBIGUOUS_REWARD_SLOTS',
      name: 'Mayflies',
      source_id: 'wiki-story',
      detail: 'Повторяющиеся награды 25% не суммируются; вероятность и количество оставлены null.',
    },
    {
      code: 'PLACEHOLDER_REJECTED',
      name: 'Kurogane Scythe',
      source_id: 'wiki-scythe',
      detail: 'MatPlaceholder1 и [PH] не являются подтверждёнными игровыми данными.',
    },
    {
      code: 'SOURCE_ACCESS',
      name: 'Fandom',
      detail:
        'HTTP 403, robots restrictions. Только сохранённые поисковые копии, без обхода ограничений. Ни одна игровая запись не объявлена verified.',
    },
  );
  for (const key of Object.keys(dataset))
    if (key !== 'translations') dataset[key].sort((a, b) => a.id.localeCompare(b.id));
  return { dataset, issues };
}
