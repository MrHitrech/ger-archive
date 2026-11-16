import path from 'node:path';
import { readFile, writeFile, mkdir, cp, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { root, dataDir, readDataset, readJson, writeJson, hash } from './lib/files.mjs';
import {
  openQpck,
  gamePathHash,
  parsePres,
  decompressBlz4,
  parseTr2,
  sha256,
} from './lib/game-formats.mjs';
import { decodeRussianArticleName } from './lib/game-text.mjs';
import { decodeGameResource, resourcePaths } from './extract-game-data.mjs';
import { parseTextureSet } from './lib/game-textures.mjs';
import { IMAGE_DECODER, inventoryIcon, iconPath, nornPaths } from './lib/game-image-layouts.mjs';
import { validateImageManifest, validateImageFiles } from './lib/game-image-validation.mjs';
import { extractModelImages } from './lib/extract-model-images.mjs';

const execute = promisify(execFile),
  canonical = (p) => p.replaceAll('\\', '/').toLowerCase();
export async function extractGameImages(
  gameDirectory,
  outputDirectory,
  {
    ffmpeg = 'ffmpeg',
    chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    apply = false,
    progress = () => {},
  } = {},
) {
  const gameDir = path.resolve(gameDirectory),
    output = path.resolve(outputDirectory),
    data = await readDataset();
  if (
    canonical(output) === canonical(gameDir) ||
    canonical(output).startsWith(canonical(gameDir) + '/')
  )
    throw new Error('Image export must be outside the game installation');
  await access(path.join(gameDir, 'GER.exe'));
  const steam = await readFile(path.resolve(gameDir, '../../appmanifest_460870.acf'), 'utf8'),
    appId = steam.match(/"appid"\s+"(\d+)"/)?.[1],
    build = steam.match(/"buildid"\s+"(\d+)"/)?.[1];
  const source = data.sources.find(
    (s) => s.acquisition === 'game_files' && s.resources?.article_en && s.equipment_stats_decoder,
  );
  if (appId !== '460870' || !build || source?.build_id !== build)
    throw new Error('Image source build must match the imported GER database');
  const mappings = await readJson(path.join(dataDir, 'import-mappings/game-aragami.json'));
  const ffmpegVersion = (await execute(ffmpeg, ['-version'], { windowsHide: true })).stdout.split(
    /\r?\n/,
  )[0];
  const archives = [],
    containers = [];
  try {
    for (const name of ['data.qpck', 'bin.qpck', 'bin_patch.qpck']) {
      const reader = await openQpck(path.join(gameDir, name));
      archives.push({ name, reader });
      if (
        !source.archives.some(
          (a) =>
            a.name === name && a.index_sha256 === reader.index_sha256 && a.size === reader.size,
        )
      )
        throw new Error(`Game archive changed: ${name}`);
    }
    const find = (p) => {
      const key = gamePathHash(p);
      for (const archive of [...archives].reverse()) {
        const entry = archive.reader.entries.get(key);
        if (entry?.size) return { archive, entry, path: p };
      }
      return null;
    };
    async function load(found) {
      return {
        bytes: await found.archive.reader.read(found.entry.offset, found.entry.size),
        origin: {
          archive: found.archive.name,
          entry_hash: found.entry.hash,
          archive_offset: found.entry.offset,
          stored_size: found.entry.size,
          stored_path: found.path,
        },
      };
    }
    for (const p of [
      'bin/resconv_pc/src/god_user_sod/god_user_sod.res',
      'bin/resconv_pc/data/GameData/g999_Base/db/default_db.res',
    ]) {
      const found = find(p);
      if (!found) throw new Error('Missing global asset container');
      const loaded = await load(found);
      containers.push({ ...loaded, path: p, entries: parsePres(loaded.bytes) });
    }
    async function resolve(p, { optional = false } = {}) {
      const candidates = [];
      for (const filename of [p, p + '.blz']) {
        const found = find(filename);
        if (found) candidates.push(await load(found));
      }
      for (const c of containers)
        for (const e of c.entries.filter((e) => e.path && canonical(e.path) === canonical(p))) {
          if (e.type === 11) {
            const found = find(e.ref);
            if (!found) throw new Error('Broken image reference');
            const loaded = await load(found);
            candidates.push({
              ...loaded,
              origin: {
                ...loaded.origin,
                container_path: c.path,
                container_archive: c.origin.archive,
              },
            });
          } else if (e.type === 15 && e.size) {
            if (e.address + e.size > c.bytes.length)
              throw new Error('Embedded image outside container');
            candidates.push({
              bytes: c.bytes.subarray(e.address, e.address + e.size),
              origin: {
                ...c.origin,
                container_path: c.path,
                archive_offset: c.origin.archive_offset + e.address,
                stored_size: e.size,
              },
            });
          }
        }
      if (!candidates.length) {
        if (optional) return null;
        throw new Error(`Missing image resource: ${p}`);
      }
      const priority = (c) =>
          c.origin.archive === 'bin_patch.qpck' || c.origin.container_archive === 'bin_patch.qpck'
            ? 1
            : 0,
        highest = Math.max(...candidates.map(priority));
      const active = candidates
        .filter((c) => priority(c) === highest)
        .map((c) => ({
          ...c,
          unpacked:
            c.bytes.toString('ascii', 0, 4) === 'blz4'
              ? decompressBlz4(c.bytes)
              : { bytes: c.bytes },
        }));
      if (new Set(active.map((c) => sha256(c.unpacked.bytes))).size !== 1)
        throw new Error(`Conflicting active image copies: ${p}`);
      return active[0];
    }
    const article = await resolve(resourcePaths.article_en);
    if (sha256(article.unpacked.bytes) !== source.resources.article_en.sha256)
      throw new Error('Image categories do not match the imported article resource');
    const articles = new Map(
      decodeGameResource('article_en', article.unpacked.bytes).map((r) => [r.id, r]),
    );
    const manifest = {
      format_version: 2,
      game: 'ger',
      app_id: appId,
      build_id: build,
      checked_at: new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' }),
      decoder: IMAGE_DECODER,
      encoder: ffmpegVersion,
      article_sha256: source.resources.article_en.sha256,
      archives: archives.map((a) => ({
        name: a.name,
        size: a.reader.size,
        index_sha256: a.reader.index_sha256,
      })),
      resources: {},
      assets: {},
      entities: {},
      missing: [],
    };
    const termResources = {};
    for (const locale of ['en', 'ru']) {
      const logical = `data/Locale/exported/${locale}/data-GameData-g999_Base-db-article-Tr2-eq_label_main_str.tr2`,
        loaded = await resolve(logical),
        key = `element_labels_${locale}`,
        row = parseTr2(loaded.unpacked.bytes, {
          selectedFields: ['eq_label_main_str_str'],
        }).rows.find((r) => r.id === 154);
      if (!row) throw new Error('Spark element label missing in native text table');
      termResources[locale] = {
        resource: key,
        row_id: 154,
        text:
          locale === 'ru'
            ? decodeRussianArticleName(row.eq_label_main_str_str)
            : row.eq_label_main_str_str,
      };
      manifest.resources[key] = {
        ...loaded.origin,
        resource_path: logical,
        format: 'tr2',
        stored_sha256: sha256(loaded.bytes),
        sha256: sha256(loaded.unpacked.bytes),
        size: loaded.unpacked.bytes.length,
        integrity: loaded.unpacked.md5 ? 'blz4_md5' : 'bounds_and_sha256',
        md5: loaded.unpacked.md5 ?? null,
      };
    }
    manifest.terminology = { spark: termResources };
    const textures = new Map(),
      requests = new Map(),
      links = [];
    async function resource(key, p, optional = false) {
      const loaded = await resolve(p, { optional });
      if (!loaded) return null;
      const decoded = parseTextureSet(loaded.unpacked.bytes);
      manifest.resources[key] = {
        ...loaded.origin,
        resource_path: p,
        stored_sha256: sha256(loaded.bytes),
        sha256: sha256(loaded.unpacked.bytes),
        size: loaded.unpacked.bytes.length,
        md5: loaded.unpacked.md5 ?? null,
        integrity: loaded.unpacked.md5 ? 'blz4_md5' : 'bounds_and_sha256',
        format: 'texture_set',
        texture_count: decoded.length,
      };
      textures.set(key, decoded);
      return key;
    }
    for (const sheet of [11, 12, 13, 14]) {
      await resource(`icons_${sheet}`, iconPath(sheet));
      if (textures.get(`icons_${sheet}`).length !== (sheet === 13 ? 8 : 48))
        throw new Error('Icon layout changed');
    }
    function request(resource, index) {
      const key = `${resource}:${index}`;
      requests.set(key, { resource, index });
      return key;
    }
    for (const record of [...data.materials, ...data.items].sort((a, b) =>
      a.id.localeCompare(b.id),
    )) {
      if (!record.game_origin) {
        manifest.missing.push({ id: record.id, reason: 'native_identity_unknown' });
        continue;
      }
      const row = articles.get(record.game_origin.row_id),
        header = row ? Buffer.from(row.raw_hex, 'hex').subarray(0, 10) : null,
        packed = header?.readUInt16LE(4),
        icon = inventoryIcon(packed);
      if (!row || !icon) throw new Error(`Unsupported inventory image category: ${record.name_en}`);
      links.push({
        id: record.id,
        key: request(`icons_${icon.sheet}`, icon.index),
        image: {
          kind: 'inventory_icon',
          native_id: row.id,
          category_code: row.category_code,
          packed_icon: packed,
          article_header_hex: header.toString('hex'),
        },
      });
    }
    for (const record of data.aragami) {
      const mapping = mappings.find((m) => m.site_id === record.id);
      if (!mapping) throw new Error(`Aragami image mapping missing: ${record.name_en}`);
      const key = `norn_${String(mapping.family_id).padStart(3, '0')}`;
      let found = null;
      for (const p of nornPaths(mapping.family_id)) {
        found = await resource(key, p, true);
        if (found) break;
      }
      if (!found) {
        manifest.missing.push({
          id: record.id,
          reason: 'no_norn_illustration',
          family_id: mapping.family_id,
        });
        continue;
      }
      if (textures.get(key).length !== 1)
        throw new Error('Unexpected NORN illustration texture count');
      links.push({
        id: record.id,
        key: request(key, 0),
        image: { kind: 'norn_illustration', family_id: mapping.family_id },
      });
    }
    const assetDir = path.join(output, 'assets'),
      ddsDir = path.join(output, 'dds');
    await mkdir(assetDir, { recursive: true });
    await mkdir(ddsDir, { recursive: true });
    const assetIds = new Map();
    const jobs = [...requests].map(([key, request]) => async () => {
      const texture = textures.get(request.resource)[request.index];
      if (!texture) throw new Error('Missing texture index');
      const ddsFile = path.join(ddsDir, `${request.resource}-${request.index}.dds`),
        temp = path.join(assetDir, `${request.resource}-${request.index}.webp`);
      await writeFile(ddsFile, texture.bytes);
      await execute(
        ffmpeg,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-i',
          ddsFile,
          '-frames:v',
          '1',
          '-map_metadata',
          '-1',
          '-c:v',
          'libwebp',
          '-quality',
          '86',
          '-compression_level',
          '6',
          '-lossless',
          request.resource.startsWith('icons_') ? '1' : '0',
          temp,
        ],
        { windowsHide: true },
      );
      const bytes = await readFile(temp),
        checksum = hash(bytes),
        filename = checksum.slice(0, 16) + '.webp',
        id =
          'ger-img-' +
          hash(`${manifest.resources[request.resource].sha256}|${request.index}|${checksum}`).slice(
            0,
            16,
          );
      await writeFile(path.join(assetDir, filename), bytes);
      manifest.assets[id] = {
        id,
        file: `images/ger/${filename}`,
        sha256: checksum,
        size: bytes.length,
        width: texture.width,
        height: texture.height,
        resource: request.resource,
        texture_index: request.index,
        dds_offset: texture.offset,
        dds_size: texture.size,
        dds_header_hex: texture.header_hex,
        dds_sha256: hash(texture.bytes),
      };
      assetIds.set(key, id);
      progress(`${request.resource}/${request.index}: ${bytes.length} bytes`);
    });
    for (let i = 0; i < jobs.length; i += 4)
      await Promise.all(jobs.slice(i, i + 4).map((job) => job()));
    manifest.assets = Object.fromEntries(
      Object.entries(manifest.assets).sort(([a], [b]) => a.localeCompare(b)),
    );
    manifest.entities = Object.fromEntries(
      links
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((link) => [link.id, { asset_id: assetIds.get(link.key), ...link.image }]),
    );
    await extractModelImages({
      data,
      manifest,
      articles,
      mappings,
      resolve,
      assetDir,
      output,
      execute,
      ffmpeg,
      chrome,
      progress,
    });
    manifest.assets = Object.fromEntries(
      Object.entries(manifest.assets).sort(([a], [b]) => a.localeCompare(b)),
    );
    manifest.entities = Object.fromEntries(
      Object.entries(manifest.entities).sort(([a], [b]) => a.localeCompare(b)),
    );
    manifest.missing.sort((a, b) => a.id.localeCompare(b.id));
    manifest.coverage = {
      materials: data.materials.filter((r) => manifest.entities[r.id]).length,
      items: data.items.filter((r) => manifest.entities[r.id]).length,
      aragami: data.aragami.filter((r) => manifest.entities[r.id]).length,
      equipment_portraits: Object.keys(manifest.portraits).length,
      assets: Object.keys(manifest.assets).length,
      missing: manifest.missing.length,
      bytes: Object.values(manifest.assets).reduce((sum, a) => sum + a.size, 0),
    };
    await writeJson(path.join(output, 'manifest.pending.json'), manifest);
    const errors = [
      ...validateImageManifest(data, manifest, mappings),
      ...(await validateImageFiles(manifest, assetDir)),
    ];
    if (errors.length) throw new Error(errors.join('\n'));
    await writeJson(path.join(output, 'manifest.json'), manifest);
    if (apply) {
      const destination = path.join(dataDir, 'image-assets');
      await mkdir(destination, { recursive: true });
      for (const asset of Object.values(manifest.assets))
        await cp(
          path.join(assetDir, path.basename(asset.file)),
          path.join(destination, path.basename(asset.file)),
        );
      await writeJson(path.join(dataDir, 'game-images.json'), manifest);
    }
    return { applied: apply, coverage: manifest.coverage, missing: manifest.missing, output };
  } finally {
    for (const archive of archives) await archive.reader.close();
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2),
    value = (name, fallback) => {
      const i = args.indexOf(name);
      if (i >= 0 && (!args[i + 1] || args[i + 1].startsWith('--')))
        throw new Error(`Missing ${name}`);
      return i < 0 ? fallback : args[i + 1];
    };
  try {
    const game = value('--game-dir');
    if (!game) throw new Error('Provide --game-dir for the installed GER');
    console.log(
      JSON.stringify(
        await extractGameImages(game, value('--output', path.join(root, 'artifacts/game-images')), {
          ffmpeg: value('--ffmpeg', 'ffmpeg'),
          chrome: value('--chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe'),
          apply: args.includes('--apply'),
          progress: (message) => console.log(message),
        }),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}
