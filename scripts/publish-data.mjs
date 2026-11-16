import { cp, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { dataDir, root, readDataset, readJson, writeJson, hash } from './lib/files.mjs';

const data = await readDataset();
const output = path.join(root, 'public/data');
await mkdir(output, { recursive: true });
const translations = new Map(data.translations.map((t) => [t.id, t]));
const kinds = { materials: 'material', items: 'item', missions: 'mission', aragami: 'aragami' };
const search = Object.entries(kinds).flatMap(([collection, kind]) =>
  data[collection].map((r) => ({
    id: r.id,
    kind,
    name_en: r.name_en,
    name_ru: translations.get(r.id)?.name_ru ?? null,
    aliases: translations.get(r.id)?.aliases || [],
    category: r.category || r.type || '',
    rank: r.rank ?? null,
    verification_status: r.verification_status,
  })),
);
const images = await readJson(path.join(dataDir, 'game-images.json'));
const payloads = {
  ...data,
  report: await readJson(path.join(dataDir, 'quality-report.json')),
  search,
  images: {
    build_id: images.build_id,
    assets: Object.fromEntries(
      Object.entries(images.assets).map(([id, a]) => [
        id,
        {
          id,
          file: a.file,
          sha256: a.sha256,
          width: a.width,
          height: a.height,
          resource: a.resource,
          ...(a.kind ? { kind: a.kind } : { texture_index: a.texture_index }),
        },
      ]),
    ),
    entities: Object.fromEntries(
      Object.entries(images.entities).map(([id, e]) => [
        id,
        {
          asset_id: e.asset_id,
          kind: e.kind,
          ...(e.native_id !== undefined ? { native_id: e.native_id } : { family_id: e.family_id }),
        },
      ]),
    ),
    portraits: images.portraits,
    resources: {},
    missing: images.missing,
    coverage: images.coverage,
  },
  'image-provenance': images,
};
const manifest = { version: '0.1.0', checked_at: payloads.report.checked_at, files: {} };
for (const [key, value] of Object.entries(payloads)) {
  await writeJson(path.join(output, `${key}.json`), value);
  manifest.files[key] = hash(await readFile(path.join(output, `${key}.json`), 'utf8')).slice(0, 16);
}
await writeJson(path.join(output, 'manifest.json'), manifest);
await cp(path.join(root, 'LICENSE-DATA.md'), path.join(output, 'LICENSE-DATA.md'));
const imageOutput = path.join(root, 'public/images/ger');
await mkdir(imageOutput, { recursive: true });
for (const asset of Object.values(payloads.images.assets))
  await cp(
    path.join(dataDir, 'image-assets', path.basename(asset.file)),
    path.join(imageOutput, path.basename(asset.file)),
  );
console.log(`Prepared ${search.length} searchable records and versioned local data.`);
