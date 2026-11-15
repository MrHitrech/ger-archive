import path from 'node:path';
import { existsSync } from 'node:fs';
import { dataDir, fileNames, readDataset, readJson, writeJson } from './lib/files.mjs';
import { createSeed } from './import-seed.mjs';
import { mergeDataset } from './lib/importer.mjs';
import { validateDataset, validateSnapshots, qualityReport } from './lib/validate.mjs';
import { prepareTranslations } from './prepare-translations.mjs';

try {
  const args = process.argv.slice(2);
  const inputIndex = args.indexOf('--input');
  const { dataset: seed, issues } = await createSeed();
  let dataset = existsSync(path.join(dataDir, 'materials.json')) ? await readDataset() : seed;
  if (args.includes('--rebuild-seed')) dataset = { ...seed, translations: dataset.translations };
  const incoming = inputIndex >= 0 ? await readJson(path.resolve(args[inputIndex + 1])) : seed;
  const { dataset: merged, conflicts } = mergeDataset(dataset, incoming);
  if (conflicts.length) {
    await writeJson(path.join(dataDir, 'reports/import-conflicts.json'), conflicts);
    throw new Error(
      `${conflicts.length} conflicting facts. Existing data unchanged. Review data/reports/import-conflicts.json; approved edits must be made explicitly.`,
    );
  }
  dataset = merged;
  dataset.translations = await prepareTranslations(dataset, { write: false });
  const { errors } = validateDataset(dataset);
  if (!errors.length) errors.push(...(await validateSnapshots(dataset)));
  if (errors.length) throw new Error(errors.join('\n'));
  if (args.includes('--dry-run')) {
    console.log('Import preview valid; no data changed.');
    process.exit(0);
  }
  // Validate the whole staged dataset before replacing any tracked JSON.
  for (const [key, file] of Object.entries(fileNames))
    await writeJson(path.join(dataDir, file), dataset[key]);
  const oldIssues =
    !args.includes('--rebuild-seed') && existsSync(path.join(dataDir, 'quarantine.json'))
      ? await readJson(path.join(dataDir, 'quarantine.json'))
      : [];
  const combined = [...oldIssues];
  for (const issue of issues)
    if (!combined.some((r) => JSON.stringify(r) === JSON.stringify(issue))) combined.push(issue);
  await writeJson(path.join(dataDir, 'quarantine.json'), combined);
  await prepareTranslations(dataset, { write: true });
  await writeJson(path.join(dataDir, 'quality-report.json'), qualityReport(dataset, combined));
  console.log(
    `Imported ${dataset.items.length} equipment records, ${dataset.missions.length} missions. All initial game facts remain partial.`,
  );
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
