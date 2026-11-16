export const ARTICLE_STATS_DECODER = 'ger-article-stats-v1';

/** GER article.kst stores physical base values at 32/34/36; guns use hundredths. */
export function decodeArticleStats(row) {
  if (!row.raw_hex) return null;
  if (!/^[a-f0-9]{152}$/.test(row.raw_hex)) throw new Error('Invalid 76-byte article stat record');
  const bytes = Buffer.from(row.raw_hex, 'hex');
  if (bytes.readUInt16LE(0) !== row.id || bytes.readUInt16LE(2) !== row.category_code)
    throw new Error('Article stat identity mismatch');
  const kind = row.category_code & 255,
    subtype = row.category_code >>> 8;
  const meaning =
    kind === 14 && subtype <= 5
      ? 'melee_attack'
      : kind === 15 && subtype <= 3
        ? 'gun_multiplier'
        : kind === 16 && subtype <= 2
          ? 'shield_defence'
          : ((kind === 12 || kind === 13) && subtype <= 2) || row.category_code === 17
            ? 'not_applicable'
            : null;
  if (!meaning) return null;
  const values = Object.fromEntries(
    ['slash', 'crush', 'pierce'].map((key, i) => [key, bytes.readInt16LE(32 + i * 2)]),
  );
  if (Object.values(values).some((value) => value < 0))
    throw new Error('Negative article base stat');
  if (meaning === 'gun_multiplier' && values.slash !== 0)
    throw new Error('Unsupported gun slash field');
  if (
    meaning === 'shield_defence' &&
    (values.slash !== values.crush || values.slash !== values.pierce)
  )
    throw new Error('Unsupported unequal shield defence fields');
  if (meaning === 'not_applicable' && Object.values(values).some((value) => value !== 0))
    throw new Error('Unexpected combat stats on clothing or upgrade module');
  const scale = meaning === 'gun_multiplier' ? 100 : 1;
  const stats =
    meaning === 'not_applicable'
      ? {}
      : meaning === 'shield_defence'
        ? { def: values.slash }
        : meaning === 'gun_multiplier'
          ? { crush: values.crush / scale, pierce: values.pierce / scale }
          : values;
  return {
    decoder: ARTICLE_STATS_DECODER,
    raw_hex: row.raw_hex,
    category_code: row.category_code,
    offsets: [32, 34, 36],
    values,
    meaning,
    scale,
    stats,
  };
}
