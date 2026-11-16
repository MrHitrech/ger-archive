export const ARTICLE_ELEMENTS_DECODER = 'ger-article-elements-v1';
const keys = ['blaze', 'freeze', 'spark', 'divine'];

/** GER article.kst: melee attributes, gun affinities, and shield resistances use different baselines. */
export function decodeArticleElements(row) {
  if (!row.raw_hex) return null;
  if (!/^[a-f0-9]{152}$/.test(row.raw_hex)) throw new Error('Invalid 76-byte article record');
  const bytes = Buffer.from(row.raw_hex, 'hex');
  if (bytes.readUInt16LE(0) !== row.id || bytes.readUInt16LE(2) !== row.category_code)
    throw new Error('Article element identity mismatch');
  const kind = row.category_code & 255;
  const raw = keys.map((_, i) => bytes.readInt16LE(38 + i * 2));
  const layout = {
    14: { baseline: 0, min: 0, max: 2, meaning: 'melee_attribute' },
    15: { baseline: 3, min: 2, max: 5, meaning: 'gun_affinity' },
    16: { baseline: 2, min: 2, max: 4, meaning: 'shield_resistance' },
    12: { baseline: 0, min: 0, max: 0, meaning: 'not_applicable' },
    13: { baseline: 0, min: 0, max: 0, meaning: 'not_applicable' },
    17: { baseline: 0, min: 0, max: 0, meaning: 'not_applicable' },
  }[kind];
  if (!layout || raw.some((v) => v < layout.min || v > layout.max))
    throw new Error(`Unsupported article affinity values: ${row.id}/${kind}/${raw}`);
  return {
    decoder: ARTICLE_ELEMENTS_DECODER,
    raw_hex: row.raw_hex,
    category_code: row.category_code,
    values: Object.fromEntries(keys.map((k, i) => [k, raw[i]])),
    baseline: layout.baseline,
    meaning: layout.meaning,
    elements: keys.filter((_, i) => raw[i] > layout.baseline),
  };
}
