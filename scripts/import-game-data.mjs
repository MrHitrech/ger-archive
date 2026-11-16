import path from 'node:path';
import { readFile, writeFile, rename, mkdir, mkdtemp, cp } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { root, dataDir, readDataset, readJson, writeJson, fileNames, hash } from './lib/files.mjs';
import { sha256 } from './lib/game-formats.mjs';
import { resourcePaths, decodeGameResource } from './extract-game-data.mjs';
import { createGameImport } from './lib/game-import.mjs';
import { createMissionRewardImport } from './lib/mission-rewards.mjs';
import { missionBundlePaths } from './lib/mission-resources.mjs';
import { createFieldAcquisitionImport } from './lib/field-acquisition.mjs';
import { linkCatalogueEnemyEvidence } from './lib/mission-catalogue.mjs';
import { prepareTranslations } from './prepare-translations.mjs';
import { validateDataset, validateSnapshots, qualityReport } from './lib/validate.mjs';

export async function readGameExport(directory) {
  const input = path.resolve(directory),
    manifest = await readJson(path.join(input, 'manifest.json')),
    decoded = {};
  if (manifest.app_id !== '460870' || manifest.format_version !== 1)
    throw new Error('Only GER exports are accepted');
  const allowedPaths = { ...resourcePaths };
  const catalogue = await readJson(
    path.join(dataDir, 'import-mappings/game-mission-resources.json'),
  );
  const usedFolders = new Set();
  for (const bundle of manifest.mission_bundles ?? []) {
    if (
      !catalogue.some((c) => JSON.stringify(c) === JSON.stringify(bundle)) ||
      usedFolders.has(bundle.folder)
    )
      throw new Error('Unrecognized or duplicate mission bundle');
    usedFolders.add(bundle.folder);
    Object.assign(allowedPaths, missionBundlePaths(bundle));
  }
  if (Object.keys(manifest.resources).length !== Object.keys(allowedPaths).length)
    throw new Error('Missing or extra exported resources');
  for (const key of Object.keys(allowedPaths)) {
    const resource = manifest.resources?.[key];
    if (
      !resource ||
      resource.resource_path !== allowedPaths[key] ||
      !/^resources\/[a-z0-9_]+\.(tr2|kst)$/.test(resource.local_file)
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
  if (!sample) {
    const missionMappings = await readJson(
      path.join(dataDir, 'import-mappings/game-missions.json'),
    );
    const catalogueScope = await readJson(
      path.join(dataDir, 'import-mappings/game-mission-catalogue.json'),
    );
    const aragamiMappings = await readJson(path.join(dataDir, 'import-mappings/game-aragami.json'));
    const rewards = createMissionRewardImport(staged.dataset, exported, {
      checkedAt,
      missionMappings,
      catalogueScope,
      aragamiMappings,
    });
    staged.dataset = rewards.dataset;
    for (const [file, content] of rewards.snapshots) staged.snapshots.set(file, content);
    staged.issues.push(...rewards.issues);
    staged.idMap.push(...rewards.idMap);
    staged.report.mission_rewards = rewards.report;
    if (exported.manifest.mission_bundles?.length) {
      const fields = createFieldAcquisitionImport(staged.dataset, exported, {
        checkedAt,
        aragamiMappings,
        nonAragamiTargets: catalogueScope.non_aragami_targets ?? [],
      });
      staged.dataset = fields.dataset;
      linkCatalogueEnemyEvidence(staged.dataset);
      for (const [file, content] of fields.snapshots) staged.snapshots.set(file, content);
      staged.issues.push(...fields.issues);
      staged.report.field_acquisition = fields.report;
    }
    staged.report.scope =
      'Materials, equipment, elements, craft and upgrade recipes; mission names by native RU IDs; automatic and supported conditional mission rewards; per-part bond breaks, devour and gathering with raw weights kept separate from confirmed percentages. Unknown conditions and synthesis are not imported.';
    for (const key of ['missions', 'drops'])
      staged.report.counts[key] = {
        before: original[key].length,
        after: staged.dataset[key].length,
        added: staged.dataset[key].filter((r) => !original[key].some((o) => o.id === r.id)).length,
        updated: staged.dataset[key].filter((r) => {
          const old = original[key].find((o) => o.id === r.id);
          return old && JSON.stringify(old) !== JSON.stringify(r);
        }).length,
      };
  }
  staged.dataset.translations = await prepareTranslations(staged.dataset);
  const oldIssues = await readJson(path.join(dataDir, 'quarantine.json'));
  const sourceId = `game-steam-460870-${exported.manifest.build_id}`;
  const importedSources = new Set([sourceId, ...staged.issues.map((r) => r.source_id)]);
  const issues = [...oldIssues.filter((r) => !importedSources.has(r.source_id)), ...staged.issues];
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
          mission_rewards: result.mission_rewards,
          field_acquisition: result.field_acquisition,
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
