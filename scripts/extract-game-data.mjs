import path from 'node:path';
import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { root, writeJson } from './lib/files.mjs';
import { decodeMissionResource } from './lib/mission-rewards.mjs';
import {
  openQpck,
  gamePathHash,
  parsePres,
  decompressBlz4,
  parseKst,
  kstString,
  parseTr2,
  sha256,
} from './lib/game-formats.mjs';

export const resourcePaths = {
  article_en: 'bin/resconv_pc/data/Locale/exported/en/article.kst',
  article_ru: 'bin/resconv_pc/data/Locale/exported/ru/article.kst',
  article_ex_en: 'bin/resconv_pc/data/Locale/exported/en/article_ex.kst',
  article_ex_ru: 'bin/resconv_pc/data/Locale/exported/ru/article_ex.kst',
  forge: 'data/GameData/g999_Base/db/article/Tr2/equipment_composition.tr2',
  synthesis: 'data/GameData/g999_Base/db/article/Tr2/article_composition.tr2',
  upgrades: 'bin/resconv_pc/data/GameData/g999_Base/db/article/Tr2/equipment_enhancement.kst',
  mission_en: 'bin/resconv_pc/data/Locale/exported/en/mission.kst',
};
const containers = [
  'bin/resconv_pc/data/GameData/g999_Base/db/default_db.res',
  'bin/resconv_pc/src/god_user_sod/god_user_sod.res',
];
const canonical = (value) => value.replaceAll('\\', '/').replace(/^\/+/, '').toLowerCase();

export function decodeGameResource(key, bytes) {
  if (key === 'mission_en') return decodeMissionResource(bytes);
  if (key.startsWith('article')) {
    const table = parseKst(bytes),
      descriptions = key.startsWith('article_ex');
    if (table.stride !== (descriptions ? 4 : 76))
      throw new Error(`Unsupported ${key} layout: ${table.stride}`);
    return table.rows.map((row) => {
      const text = kstString(
        bytes,
        row.bytes.readUInt32LE(descriptions ? 0 : 28),
        table.record_end,
      );
      if (descriptions) return { id: row.key, text };
      if (row.bytes.readUInt16LE(0) !== row.key)
        throw new Error(`Article key mismatch: ${row.key}`);
      return {
        id: row.key,
        name: text,
        category_code: row.bytes.readUInt16LE(2),
        rank: row.bytes.readUInt8(25),
        record_offset: row.offset,
        raw_hex: row.bytes.toString('hex'),
      };
    });
  }
  if (key === 'upgrades') {
    const table = parseKst(bytes);
    if (table.stride !== 40) throw new Error('Unsupported upgrade record layout');
    return table.rows.map((row) => {
      const b = row.bytes;
      if (b.readUInt16LE(0) !== row.key) throw new Error(`Upgrade key mismatch: ${row.key}`);
      const ingredients = Array.from({ length: 5 }, (_, i) => ({
        id: b.readUInt16LE(16 + i * 2),
        quantity: b.readUInt16LE(26 + i * 2),
      }));
      if (ingredients.some((i) => (i.id === 0) !== (i.quantity === 0)))
        throw new Error(`Invalid upgrade ingredient pair: ${row.key}`);
      return {
        id: row.key,
        result_id: b.readUInt16LE(2),
        base_id: b.readUInt16LE(4),
        price: b.readUInt32LE(12),
        ingredients: ingredients.filter((i) => i.id),
        unlock_raw: {
          article_flag: b.readUInt16LE(6),
          progress_and: b.readUInt16LE(8),
          progress_or: b.readUInt16LE(10),
          new_flag: b.readUInt32LE(36),
        },
        record_offset: row.offset,
        raw_hex: b.toString('hex'),
        layout_status: 'inferred_checked_structure',
      };
    });
  }
  const table = parseTr2(bytes),
    prefix = key === 'forge' ? 'equipment_composition' : 'article_composition';
  if (table.name !== prefix) throw new Error(`Unexpected TR2 name: ${table.name}`);
  return table.rows.map((row) => {
    const ids = row[`${prefix}_input_article_id`],
      quantities = row[`${prefix}_input_article_num`];
    if (!Array.isArray(ids) || !Array.isArray(quantities) || ids.length !== quantities.length)
      throw new Error(`Invalid ingredient arrays: ${prefix}/${row.id}`);
    return {
      id: row.id,
      result_id: row[`${prefix}_prize_id`],
      base_id: null,
      price: row[`${prefix}_price`],
      ingredients: ids.map((id, i) => ({ id, quantity: quantities[i] })),
      unlock_raw: Object.fromEntries(
        Object.entries(row).filter(([field]) => /flag|progress|strict_rules/.test(field)),
      ),
      layout_status: 'named_tr2_fields',
    };
  });
}

export async function extractGameData(
  gameDirectory,
  outputDirectory,
  { progress = () => {} } = {},
) {
  const gameDir = path.resolve(gameDirectory),
    output = path.resolve(outputDirectory);
  const comparable = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
  if (
    comparable(output) === comparable(gameDir) ||
    comparable(output).startsWith(`${comparable(gameDir)}${path.sep}`)
  )
    throw new Error('Extraction output must be outside the game installation');
  await access(path.join(gameDir, 'GER.exe'));
  const steam = await readFile(path.resolve(gameDir, '../../appmanifest_460870.acf'), 'utf8');
  const appId = steam.match(/"appid"\s+"(\d+)"/)?.[1],
    buildId = steam.match(/"buildid"\s+"(\d+)"/)?.[1];
  if (appId !== '460870' || !buildId)
    throw new Error('Expected the Steam manifest for God Eater Resurrection (460870)');
  const archives = [];
  try {
    for (const name of ['data.qpck', 'bin.qpck', 'bin_patch.qpck']) {
      archives.push({ name, reader: await openQpck(path.join(gameDir, name)) });
    }
    function find(resourcePath) {
      const hash = gamePathHash(resourcePath);
      for (let i = archives.length - 1; i >= 0; i--) {
        const archive = archives[i],
          entry = archive.reader.entries.get(hash);
        if (entry) return { archive, entry, resourcePath };
      }
      return null;
    }
    async function load(found) {
      return {
        bytes: await found.archive.reader.read(found.entry.offset, found.entry.size),
        provenance: {
          archive: found.archive.name,
          entry_hash: found.entry.hash,
          archive_offset: found.entry.offset,
          stored_size: found.entry.size,
          container_path: null,
          resource_path: found.resourcePath,
        },
      };
    }
    const loadedContainers = [];
    for (const containerPath of containers) {
      const found = find(containerPath);
      if (!found) throw new Error(`Required GER container missing: ${containerPath}`);
      const loaded = await load(found);
      loadedContainers.push({
        ...loaded,
        descriptors: parsePres(loaded.bytes),
        path: containerPath,
      });
    }
    async function resolve(resourcePath) {
      const direct = find(resourcePath) ?? find(`${resourcePath}.blz`);
      // The canonical global containers are checked even when a standalone table exists.
      // An overriding patched container must not be bypassed by an older standalone resource.
      const embedded = [];
      for (const container of loadedContainers) {
        for (const entry of container.descriptors.filter(
          (e) => e.path && canonical(e.path) === canonical(resourcePath),
        )) {
          if (entry.type === 11) {
            const reference = find(entry.ref);
            if (!reference) throw new Error(`Missing referenced resource: ${entry.ref}`);
            const loaded = await load(reference);
            embedded.push({
              ...loaded,
              provenance: {
                ...loaded.provenance,
                container_path: container.path,
                container_archive: container.provenance.archive,
              },
            });
          } else if (entry.type === 15 && entry.size) {
            if (entry.address + entry.size > container.bytes.length)
              throw new Error(`PRES payload outside container: ${resourcePath}`);
            embedded.push({
              bytes: container.bytes.subarray(entry.address, entry.address + entry.size),
              provenance: {
                ...container.provenance,
                container_path: container.path,
                resource_path: resourcePath,
                archive_offset: container.provenance.archive_offset + entry.address,
                stored_size: entry.size,
              },
            });
          }
        }
      }
      const candidates = [...embedded];
      if (direct) candidates.push(await load(direct));
      if (!candidates.length) throw new Error(`Resource not found: ${resourcePath}`);
      const priority = (candidate) =>
        candidate.provenance.container_archive === 'bin_patch.qpck' ||
        candidate.provenance.archive === 'bin_patch.qpck'
          ? 1
          : 0;
      const highest = Math.max(...candidates.map(priority));
      const active = candidates
        .filter((candidate) => priority(candidate) === highest)
        .map((candidate) => ({
          ...candidate,
          unpacked:
            candidate.bytes.subarray(0, 4).toString() === 'blz4'
              ? decompressBlz4(candidate.bytes)
              : { bytes: candidate.bytes },
        }));
      if (new Set(active.map((candidate) => sha256(candidate.unpacked.bytes))).size !== 1)
        throw new Error(
          `Conflicting active copies of ${resourcePath}; resource selection requires review`,
        );
      return active[0];
    }
    await mkdir(path.join(output, 'resources'), { recursive: true });
    const resources = {},
      decoded = {};
    for (const [key, resourcePath] of Object.entries(resourcePaths)) {
      const loaded = await resolve(resourcePath),
        compressed = loaded.bytes.subarray(0, 4).toString() === 'blz4';
      const unpacked = loaded.unpacked;
      resources[key] = {
        ...loaded.provenance,
        resource_path: resourcePath,
        stored_sha256: sha256(loaded.bytes),
        sha256: sha256(unpacked.bytes),
        size: unpacked.bytes.length,
        md5: unpacked.md5 ?? null,
        integrity: compressed ? 'blz4_md5' : 'bounds_and_sha256',
        chunk_order: unpacked.chunk_order ?? null,
        local_file: `resources/${key}.${resourcePath.endsWith('.tr2') ? 'tr2' : 'kst'}`,
      };
      await writeFile(path.join(output, resources[key].local_file), unpacked.bytes);
      decoded[key] = decodeGameResource(key, unpacked.bytes);
      progress(`${key}: ${decoded[key].length} records`);
    }
    const manifest = {
      format_version: 1,
      app_id: appId,
      build_id: buildId,
      resource_precedence: ['data.qpck', 'bin.qpck', 'bin_patch.qpck'],
      archives: archives.map(({ name, reader }) => ({
        name,
        size: reader.size,
        mtime: reader.mtime,
        entry_count: reader.entries.size,
        index_sha256: reader.index_sha256,
      })),
      resources,
    };
    manifest.decoded_files = {};
    for (const [key, rows] of Object.entries(decoded)) {
      await writeJson(path.join(output, `${key}.json`), rows);
      manifest.decoded_files[key] = sha256(await readFile(path.join(output, `${key}.json`)));
    }
    await writeJson(path.join(output, 'manifest.json'), manifest);
    return { manifest, decoded };
  } finally {
    await Promise.allSettled(archives.map(({ reader }) => reader.close()));
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2),
      at = args.indexOf('--game-dir'),
      outAt = args.indexOf('--output');
    if (at < 0 || !args[at + 1])
      throw new Error(
        'Usage: npm run game:extract -- --game-dir "path/to/GOD EATER RESURRECTION" [--output artifacts/game-extract]',
      );
    const output = outAt >= 0 ? args[outAt + 1] : path.join(root, 'artifacts/game-extract');
    const result = await extractGameData(args[at + 1], output, { progress: console.log });
    console.log(`Extracted GER build ${result.manifest.build_id} to ${path.resolve(output)}`);
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}
