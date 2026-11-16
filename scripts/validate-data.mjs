import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { dataDir, root, readDataset, readJson, writeJson } from './lib/files.mjs';
import { validateDataset, validateSnapshots, qualityReport } from './lib/validate.mjs';
import { validateImageManifest, validateImageFiles } from './lib/game-image-validation.mjs';

try {
  const data = await readDataset();
  const { errors, warnings } = validateDataset(data);
  if (!errors.length) errors.push(...(await validateSnapshots(data)));
  if (!errors.length) {
    const images = await readJson(path.join(dataDir, 'game-images.json'));
    const mappings = await readJson(path.join(dataDir, 'import-mappings/game-aragami.json'));
    errors.push(...validateImageManifest(data, images, mappings));
    if (!errors.length) errors.push(...(await validateImageFiles(images)));
  }
  if (errors.length) throw new Error(errors.join('\n'));
  const issues = await readJson(path.join(dataDir, 'quarantine.json'));
  const report = qualityReport(data, issues);
  if (process.argv.includes('--write'))
    await writeJson(path.join(dataDir, 'quality-report.json'), report);
  else {
    const previous = await readFile(path.join(dataDir, 'quality-report.json'), 'utf8');
    if (previous !== `${JSON.stringify(report, null, 2)}\n`)
      throw new Error('Quality report is stale. Run npm run data:report.');
  }
  const en = await readJson(path.join(dataDir, 'translations/en.json'));
  const originals = [
    ...data.materials,
    ...data.items,
    ...data.missions,
    ...data.aragami,
    ...data.locations,
  ];
  if (
    en.length !== originals.length ||
    originals.some((r) => !en.some((t) => t.id === r.id && t.name_en === r.name_en))
  )
    throw new Error('English dictionary is stale. Run npm run translations:prepare.');
  console.log(
    `Data valid. ${data.materials.length} materials, ${data.items.length} items, ${data.recipes.length} recipes, ${data.missions.length} missions, ${data.drops.length} acquisition records.`,
  );
  console.log(warnings.join('\n'));
  console.log(
    `Coverage remains partial. ${report.translations.missing} untranslated, ${report.issues.length} import issues. Workspace: ${root}`,
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
