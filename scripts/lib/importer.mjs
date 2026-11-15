import { idFor } from './files.mjs';

/** Reject an unscoped or incomplete excerpt instead of guessing a game/column. */
export function scopedSection(text, start, end) {
  if (!start.includes('God Eater Resurrection'))
    throw new Error('Import needs an explicit Resurrection section.');
  const from = text.indexOf(start);
  if (from === -1) throw new Error(`Missing section: ${start}`);
  const to = end ? text.indexOf(end, from + start.length) : text.length;
  if (to === -1) throw new Error(`Missing section boundary: ${end}`);
  const selected = text.slice(from + start.length, to);
  if (/^#{1,3} God Eater (?:Burst|2|3)(?:\s|$)/m.test(selected))
    throw new Error('Mixed game section rejected.');
  return selected;
}

export function parseEquipment(text, { category, family, expectedCount }) {
  // Use the row's next item/header as a boundary; a trailing $ must mean EOF.
  const starts = [...text.matchAll(/^ \| ([^\n|]+)\nRank (\d+)\s+\|\s+(\d+) Fc\n/gm)];
  const items = starts.map((m, i) => {
    const next = starts[i + 1]?.index ?? text.length;
    const row = text
      .slice(m.index, next)
      .split(/\n(?:Design  \||### )/)[0]
      .trim();
    if (/MatPlaceholder|\[PH\]|\[File Placeholder\]/i.test(row))
      throw new Error(`Ambiguous placeholder in ${m[1]}`);
    const afterHeader = row.slice(row.indexOf('\n', row.indexOf('\n') + 1) + 1);
    const cells = afterHeader.split(/\s+\|\s+/);
    if (cells.length !== 3) throw new Error(`Malformed equipment row: ${m[1]}`);
    const lines = cells[0]
      .trim()
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const previous = /^\d+x /.test(lines[0]) ? null : lines.shift();
    const materials = lines.map((line) => {
      const ingredient = line.match(/^(\d+)x (.+)$/);
      if (!ingredient) throw new Error(`Ambiguous ingredient: ${line}`);
      return { name_en: ingredient[2].trim(), quantity: Number(ingredient[1]) };
    });
    if (!materials.length) throw new Error(`Ambiguous empty ingredient list in ${m[1]}`);
    const stats = {};
    const elements = [];
    for (const line of cells[2].trim().split('\n')) {
      const stat = line.match(/^(Slash|Pierce|Crush|DEF) (\d+)$/);
      const element = line.match(/^(Blaze|Freeze|Spark|Divine) O+$/);
      if (stat) stats[stat[1].toLowerCase()] = Number(stat[2]);
      else if (element) elements.push(element[1].toLowerCase());
      else if (line.trim()) throw new Error(`Unknown stat: ${line}`);
    }
    return {
      name_en: m[1].trim(),
      rank: Number(m[2]),
      cost_fc: Number(m[3]),
      previous,
      materials,
      category,
      family,
      stats,
      elements,
      skills_en: cells[1].trim().split('\n'),
      excerpt: row,
    };
  });
  if (items.length !== expectedCount)
    throw new Error(
      `Expected ${expectedCount} complete rows in ${family}, got ${items.length}. Review the snapshot.`,
    );
  return items;
}

/** Normalized manual imports can add new records; existing facts require explicit review. */
export function mergeDataset(current, incoming) {
  const result = structuredClone(current);
  const conflicts = [];
  for (const [collection, records] of Object.entries(incoming)) {
    if (!Array.isArray(records) || !Array.isArray(result[collection]))
      throw new Error(`Unknown collection ${collection}`);
    for (const record of records) {
      const prior = result[collection].find((r) => r.id === record.id);
      if (!prior) result[collection].push(record);
      else if (JSON.stringify(prior) !== JSON.stringify(record))
        conflicts.push({ collection, id: record.id, current: prior, incoming: record });
    }
  }
  return { dataset: result, conflicts };
}

export const equipmentKey = (item) => idFor('i', `${item.category}|${item.name_en}`);
