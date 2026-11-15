import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const dataDir = path.join(root, 'data');
export const hash = (text) => createHash('sha256').update(text).digest('hex');
export const idFor = (kind, key) => `ger-${kind}-${hash(`ger|${kind}|${key}`).slice(0, 12)}`;
export const readJson = async (file) =>
  JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
export async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, file);
}
export const fileNames = {
  materials: 'materials.json',
  items: 'items.json',
  recipes: 'recipes.json',
  missions: 'missions.json',
  aragami: 'aragami.json',
  locations: 'locations.json',
  drops: 'drop-sources.json',
  sources: 'sources.json',
  evidence: 'evidence/claims.json',
  translations: 'translations/ru.json',
};
export async function readDataset() {
  const entries = await Promise.all(
    Object.entries(fileNames).map(async ([key, file]) => [
      key,
      await readJson(path.join(dataDir, file)),
    ]),
  );
  return Object.fromEntries(entries);
}
