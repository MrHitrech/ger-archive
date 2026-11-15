import path from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dataDir, readDataset, readJson, writeJson } from './lib/files.mjs';

/** Prepare candidates without promoting a machine/project suggestion to verified. */
export async function prepareTranslations(data, { write = false } = {}) {
  const originals = ['materials', 'items', 'missions', 'aragami', 'locations'].flatMap(
    (key) => data[key],
  );
  const current = new Map((data.translations || []).map((t) => [t.id, t]));
  const draftFile = path.join(dataDir, 'translations/drafts.json');
  const drafts = existsSync(draftFile) ? await readJson(draftFile) : {};
  const result = originals
    .map((record) => {
      const existing = current.get(record.id);
      if (existing) return existing; // Reviewed names and prior editorial choices are never overwritten.
      let name = drafts[record.name_en] || null;
      if (!name) {
        const suffix = record.name_en.match(/^(.*?) (II|III|IV|V|N|X|S|EX|\+)$/);
        if (suffix && drafts[suffix[1]]) name = `${drafts[suffix[1]]} ${suffix[2]}`;
      }
      return {
        id: record.id,
        name_en: record.name_en,
        name_ru: name,
        aliases: [],
        source: name
          ? 'project-draft: редакционный вариант, требует проверки'
          : 'pending: требуется сопоставление с русской Wiki или локализацией',
        status: 'unverified',
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  if (write) {
    await writeJson(path.join(dataDir, 'translations/ru.json'), result);
    await writeJson(
      path.join(dataDir, 'translations/en.json'),
      originals
        .map((r) => ({ id: r.id, name_en: r.name_en }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    );
    await writeJson(
      path.join(dataDir, 'reports/translation-review.json'),
      result
        .filter((t) => t.status === 'unverified')
        .map((t) => ({
          id: t.id,
          name_en: t.name_en,
          suggested_ru: t.name_ru,
          source: t.source,
          reason: t.name_ru ? 'review_draft' : 'translation_missing',
        })),
    );
  }
  return result;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = await prepareTranslations(await readDataset(), { write: true });
    console.log(`${result.length} names; existing translations preserved; review queue updated.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
