import path from 'node:path';
import { readFile, writeFile, rename, mkdir, mkdtemp, cp } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { root, dataDir, readDataset, readJson, writeJson, fileNames, hash } from './lib/files.mjs';
import { sha256 } from './lib/game-formats.mjs';
import { resourcePaths, decodeGameResource } from './extract-game-data.mjs';
import { createGameImport } from './lib/game-import.mjs';
import { prepareTranslations } from './prepare-translations.mjs';
import { validateDataset, validateSnapshots, qualityReport } from './lib/validate.mjs';

export async function readGameExport(directory) {
  const input = path.resolve(directory),
    manifest = await readJson(path.join(input, 'manifest.json')),
    decoded = {};
  if (manifest.app_id !== '460870' || manifest.format_version !== 1)
    throw new Error('Only GER exports are accepted');
  for (const key of Object.keys(resourcePaths)) {
    const resource = manifest.resources?.[key];
    if (
      !resource ||
      resource.resource_path !== resourcePaths[key] ||
      !/^resources\/[a-z_]+\.(tr2|kst)$/.test(resource.local_file)
    )
      throw new Error(`Invalid resource metadata: ${key}`);
    const raw = await readFile(path.join(input, resource.local_file));
    if (sha256(raw) !== resource.sha256)
      throw new Error(`Extracted binary checksum mismatch: ${key}`);
    const json = await readFile(path.join(input, `${key}.json`));
    if (sha256(json) !== manifest.decoded_files?.[key])
      throw new Error(`Decoded table checksum mismatch: ${key}; repeat extraction`);
    decoded[key] = JSON.parse(json.toString('utf8'));
    if (JSON.stringify(decoded[key]) !== JSON.stringify(decodeGameResource(key, raw)))
      throw new Error(`Decoded rows differ from binary data: ${key}`);
  }
  return { manifest, decoded };
}

async function writeSnapshot(file, text) {
  const temporary = `${file}.tmp`;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(temporary, text, 'utf8');
  await rename(temporary, file);
}

export async function importGameData({
  input,
  checkedAt,
  sample = false,
  apply = false,
  expectedPlan = null,
}) {
  if (sample && apply)
    throw new Error('Sample mode is preview-only; apply the complete reviewed plan');
  const original = await readDataset(),
    originalHash = hash(JSON.stringify(original));
  const exported = await readGameExport(input);
  const articleMappings = await readJson(path.join(dataDir, 'import-mappings/game-articles.json'));
  const staged = createGameImport(original, exported, { checkedAt, sample, articleMappings });
  staged.dataset.translations = await prepareTranslations(staged.dataset);
  const oldIssues = await readJson(path.join(dataDir, 'quarantine.json'));
  const sourceId = `game-steam-460870-${exported.manifest.build_id}`;
  const issues = [...oldIssues.filter((r) => r.source_id !== sourceId), ...staged.issues];
  const { errors } = validateDataset(staged.dataset);
  if (!errors.length)
    errors.push(...(await validateSnapshots(staged.dataset, { snapshots: staged.snapshots })));
  const planSha = hash(
    JSON.stringify({
      base: originalHash,
      manifest: exported.manifest,
      candidate: staged.dataset,
      issues,
    }),
  );
  const report = {
    ...staged.report,
    plan_sha256: planSha,
    base_sha256: originalHash,
    validation_errors: errors,
    valid: !errors.length && !staged.report.blocking.length,
  };
  const reportDirectory = path.join(root, 'artifacts/game-import', sample ? 'sample' : 'full');
  await writeJson(path.join(reportDirectory, 'plan.json'), report);
  await writeJson(path.join(reportDirectory, 'id-map.json'), staged.idMap);
  for (const [name, content] of staged.snapshots)
    await writeSnapshot(path.join(reportDirectory, 'evidence', name), content);
  if (!report.valid)
    throw new Error(
      `Game import blocked; review ${path.join(reportDirectory, 'plan.json')}\n${errors.slice(0, 8).join('\n')}`,
    );
  if (!apply) return { ...report, applied: false };
  if (expectedPlan !== planSha)
    throw new Error(`Apply requires --expected-plan ${planSha}; review the current preview first`);
  if (hash(JSON.stringify(await readDataset())) !== originalHash)
    throw new Error('Dataset changed during preview; repeat the import preview');
  const backupParent = path.join(root, 'artifacts/game-import/backups');
  await mkdir(backupParent, { recursive: true });
  const backup = await mkdtemp(path.join(backupParent, 'before-'));
  await cp(dataDir, path.join(backup, 'data'), {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  // Each file is replaced atomically. A complete backup is retained for recovery.
  for (const [name, content] of staged.snapshots)
    await writeSnapshot(path.join(dataDir, 'evidence', name), content);
  for (const [collection, file] of Object.entries(fileNames))
    if (JSON.stringify(original[collection]) !== JSON.stringify(staged.dataset[collection]))
      await writeJson(path.join(dataDir, file), staged.dataset[collection]);
  await writeJson(path.join(dataDir, 'quarantine.json'), issues);
  await prepareTranslations(staged.dataset, { write: true });
  await writeJson(path.join(dataDir, 'quality-report.json'), qualityReport(staged.dataset, issues));
  await writeJson(
    path.join(dataDir, 'reports/game-id-map.json'),
    staged.idMap.map(({ preserved_existing_id, ...row }) => row),
  );
  await writeJson(path.join(dataDir, 'reports/game-import.json'), { ...report, applied: true });
  return { ...report, applied: true, backup };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2),
      value = (name, fallback) => {
        const i = args.indexOf(name);
        if (i >= 0 && (!args[i + 1] || args[i + 1].startsWith('--')))
          throw new Error(`Missing value for ${name}`);
        return i < 0 ? fallback : args[i + 1];
      };
    if (args.includes('--apply') && args.includes('--dry-run'))
      throw new Error('Choose --apply or --dry-run');
    const result = await importGameData({
      input: value('--input', path.join(root, 'artifacts/game-extract')),
      checkedAt: value(
        '--checked-at',
        new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' }),
      ),
      sample: args.includes('--sample'),
      apply: args.includes('--apply'),
      expectedPlan: value('--expected-plan', null),
    });
    console.log(
      JSON.stringify(
        {
          applied: result.applied,
          plan_sha256: result.plan_sha256,
          counts: result.counts,
          quarantined: result.quarantined_rows,
          factual_changes: result.factual_changes.length,
          translation_import: result.translation_import,
          preserved_existing_ids: result.preserved_existing_ids,
          backup: result.backup,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}
