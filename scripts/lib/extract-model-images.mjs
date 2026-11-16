import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { readJson, dataDir } from './files.mjs';
import { parsePres, decompressBlz4, sha256 } from './game-formats.mjs';
import { parseTextureSet } from './game-textures.mjs';
import {
  parseIxo,
  nativeSkeletonPose,
  nativeEquipmentPose,
  equipmentModelReference,
  MODEL_DECODER,
} from './game-models.mjs';
import { renderGameModel } from './render-game-model.mjs';
import {
  equipmentReferencePath,
  shieldPosePath,
  equipmentPosePath,
} from './game-image-layouts.mjs';

const stem = (name) => name.replace(/\.(tga|bmp|png)$/i, '').toLowerCase();
export async function extractModelImages({
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
}) {
  const work = path.join(output, 'models');
  await mkdir(work, { recursive: true });
  manifest.portraits = {};
  manifest.equipment_references = {};
  const referenceTables = new Map(),
    containerCache = new Map(),
    textureCache = new Map(),
    baseCache = new Map();
  const previous = await readJson(path.join(dataDir, 'game-images.json')).catch(() => null),
    bladePoses = new Map();
  function register(loaded, logical, format) {
    const checksum = sha256(loaded.unpacked.bytes),
      key = `${format}_${sha256(logical + '|' + checksum).slice(0, 16)}`;
    if (!manifest.resources[key])
      manifest.resources[key] = {
        ...loaded.origin,
        resource_path: logical,
        stored_sha256: sha256(loaded.bytes),
        sha256: checksum,
        size: loaded.unpacked.bytes.length,
        integrity: loaded.unpacked.md5 ? 'blz4_md5' : 'bounds_and_sha256',
        md5: loaded.unpacked.md5 ?? null,
        format,
      };
    return key;
  }
  for (const part of ['Blade', 'Nozzle', 'Shield']) {
    const logical = equipmentReferencePath(part),
      loaded = await resolve(logical);
    referenceTables.set(part, {
      bytes: loaded.unpacked.bytes,
      key: register(loaded, logical, 'equipment_references'),
    });
  }
  const poseLoaded = await resolve(shieldPosePath),
    poseKey = register(poseLoaded, shieldPosePath, 'ixo_pose'),
    shieldPose = Object.fromEntries(
      Object.entries(nativeSkeletonPose(poseLoaded.unpacked.bytes)).filter(([name]) =>
        /^joint_Shield_[LR]$/.test(name),
      ),
    );
  if (Object.keys(shieldPose).length !== 2) throw new Error('Native shield preview pose not found');
  for (const genre of ['Short', 'Long', 'Buster', 'Hammer', 'Spear', 'Scythe']) {
    const logical = equipmentPosePath(genre),
      loaded = await resolve(logical),
      key = register(loaded, logical, 'ixo_pose');
    bladePoses.set(genre, { key, pose: nativeEquipmentPose(loaded.unpacked.bytes, 1) });
  }
  async function container(logical) {
    if (containerCache.has(logical)) return containerCache.get(logical);
    const loaded = await resolve(logical),
      entries = parsePres(loaded.unpacked.bytes),
      key = register(loaded, logical, 'pres');
    const result = { ...loaded, logical, entries, key };
    containerCache.set(logical, result);
    return result;
  }
  async function child(parent, e) {
    let loaded;
    if (e.type === 11) {
      loaded = await resolve(e.ref);
      loaded = {
        ...loaded,
        origin: {
          ...loaded.origin,
          container_path: parent.logical,
          container_sha256: manifest.resources[parent.key].sha256,
        },
      };
    } else if (e.type === 15 && e.size) {
      if (parent.unpacked.md5)
        throw new Error('Compressed PRES requires explicit embedded source offsets');
      if (e.address + e.size > parent.unpacked.bytes.length)
        throw new Error('Model resource outside its container');
      const bytes = parent.unpacked.bytes.subarray(e.address, e.address + e.size);
      loaded = {
        bytes,
        unpacked: bytes.toString('ascii', 0, 4) === 'blz4' ? decompressBlz4(bytes) : { bytes },
        origin: {
          ...parent.origin,
          archive_offset: parent.origin.archive_offset + e.address,
          stored_size: e.size,
          container_path: parent.logical,
          container_sha256: manifest.resources[parent.key].sha256,
          embedded_offset: e.address,
        },
      };
    } else throw new Error('Unsupported native model reference');
    return loaded;
  }
  async function texture(parent, e) {
    const loaded = await child(parent, e),
      key = register(loaded, e.path, 'texture_set');
    if (!textureCache.has(key)) {
      const decoded = parseTextureSet(loaded.unpacked.bytes);
      if (decoded.length !== 1)
        throw new Error('Model diffuse texture must contain exactly one DDS');
      const t = decoded[0],
        dds = path.join(work, key + '.dds'),
        png = path.join(work, key + '.png');
      manifest.resources[key].texture_count = 1;
      manifest.resources[key].dds_sha256 = sha256(t.bytes);
      let cached = false;
      try {
        cached =
          sha256(await readFile(dds)) === sha256(t.bytes) &&
          (await readFile(png)).toString('hex', 0, 8) === '89504e470d0a1a0a';
      } catch {}
      if (!cached) {
        await writeFile(dds, t.bytes);
        await execute(
          ffmpeg,
          ['-hide_banner', '-loglevel', 'error', '-y', '-i', dds, '-frames:v', '1', png],
          { windowsHide: true },
        );
      }
      textureCache.set(key, 'data:image/png;base64,' + (await readFile(png)).toString('base64'));
    }
    return { key, url: textureCache.get(key) };
  }
  async function nativeScene(parent, modelName, pose = null) {
    const e = parent.entries.find((e) => e.names[0] === modelName && e.names[1] === 'ixo');
    if (!e) throw new Error('Missing native mesh ' + parent.logical + '/' + modelName);
    const loaded = await child(parent, e),
      key = register(loaded, e.path, 'ixo');
    let scene;
    try {
      scene = parseIxo(loaded.unpacked.bytes, { pose });
    } catch (error) {
      throw new Error(`${parent.logical}: ${error.message}`);
    }
    const textures = {},
      textureKeys = [];
    for (const material of scene.materials) {
      const diffuse = material.textures[0],
        name = stem(diffuse),
        entry = parent.entries.find(
          (e) => e.names[1] === 'gnf' && e.names[0].toLowerCase() === name,
        );
      if (!entry) throw new Error('Missing diffuse texture ' + diffuse + ' in ' + parent.logical);
      const t = await texture(parent, entry);
      textures[name] = t.url;
      textureKeys.push(t.key);
    }
    return {
      scene,
      textures,
      geometry: [key],
      textureKeys: [...new Set(textureKeys)],
      containers: [parent.key],
    };
  }
  function appendScene(target, extra) {
    const offset = Math.max(...target.scene.materials.map((m) => m.id)) + 1,
      ids = new Map(extra.scene.materials.map((m, i) => [m.id, offset + i]));
    target.scene.meshes.push(
      ...extra.scene.meshes.map((m) => ({ ...m, material: ids.get(m.material) })),
    );
    target.scene.materials.push(...extra.scene.materials.map((m) => ({ ...m, id: ids.get(m.id) })));
    Object.assign(target.textures, extra.textures);
    target.geometry.push(...extra.geometry);
    target.textureKeys.push(...extra.textureKeys);
    target.containers.push(...extra.containers);
  }
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  manifest.model_renderer = {
    decoder: MODEL_DECODER,
    browser: browser.version(),
    renderer: 'webgl-orthographic-v1',
    renderer_sha256: sha256(renderGameModel.toString().replace(/\s+/g, '')),
    size: [768, 512],
    shield_pose_resource: poseKey,
    blade_pose_resources: Object.fromEntries([...bladePoses].map(([genre, p]) => [genre, p.key])),
  };
  const pages = await Promise.all(Array.from({ length: 3 }, () => browser.newPage())),
    renders = new Map();
  for (const page of pages) page.setDefaultTimeout(60000);
  async function render(native, category, referenceId = null, page = pages[0]) {
    const signature = sha256(
        JSON.stringify({
          geometry: native.geometry,
          textures: native.textureKeys,
          category,
          renderer: sha256(renderGameModel.toString()),
          encoder: manifest.encoder,
          browser: browser.version(),
          pose: native.poseResource ?? null,
        }),
      ),
      png = path.join(work, signature + '.png'),
      webp = path.join(work, signature + '.webp'),
      cacheFile = path.join(work, signature + '.asset.json');
    try {
      const cached = JSON.parse(await readFile(cacheFile, 'utf8')),
        bytes = await readFile(path.join(assetDir, path.basename(cached.file)));
      if (sha256(bytes) === cached.sha256 && bytes.length === cached.size) {
        manifest.assets[cached.id] = cached;
        return cached.id;
      }
    } catch {}
    if (
      previous?.build_id === manifest.build_id &&
      previous.encoder === manifest.encoder &&
      previous.model_renderer?.browser === browser.version() &&
      previous.model_renderer?.renderer === manifest.model_renderer.renderer &&
      previous.model_renderer?.renderer_sha256 === manifest.model_renderer.renderer_sha256
    ) {
      const old = Object.values(previous.assets).find(
        (a) =>
          a.kind === 'model_render' &&
          a.render.reference_id === referenceId &&
          a.render.pose_resource === (native.poseResource ?? null) &&
          JSON.stringify(a.render.geometry) === JSON.stringify(native.geometry) &&
          JSON.stringify(a.render.textures) === JSON.stringify([...new Set(native.textureKeys)]),
      );
      if (old) {
        const bytes = await readFile(path.join(dataDir, 'image-assets', path.basename(old.file)));
        if (sha256(bytes) !== old.sha256) throw new Error('Previous native image cache is corrupt');
        await writeFile(path.join(assetDir, path.basename(old.file)), bytes);
        manifest.assets[old.id] = old;
        return old.id;
      }
    }
    const result = await page.evaluate(renderGameModel, {
      scene: native.scene,
      textures: native.textures,
      category,
      view: ['buckler', 'shield', 'tower_shield'].includes(category)
        ? { direction: [0.5, 1, 1], up: [0, 0, 1] }
        : null,
    });
    await writeFile(png, Buffer.from(result.png.split(',')[1], 'base64'));
    await execute(
      ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        png,
        '-frames:v',
        '1',
        '-map_metadata',
        '-1',
        '-c:v',
        'libwebp',
        '-quality',
        '88',
        '-compression_level',
        '6',
        webp,
      ],
      { windowsHide: true },
    );
    const bytes = await readFile(webp),
      checksum = sha256(bytes),
      id = 'ger-img-' + sha256(signature + '|' + checksum).slice(0, 16),
      filename = checksum.slice(0, 16) + '.webp';
    await writeFile(path.join(assetDir, filename), bytes);
    manifest.assets[id] = {
      id,
      kind: 'model_render',
      file: 'images/ger/' + filename,
      sha256: checksum,
      size: bytes.length,
      width: 768,
      height: 512,
      resource: native.geometry[0],
      render: {
        decoder: MODEL_DECODER,
        geometry: native.geometry,
        textures: [...new Set(native.textureKeys)],
        containers: [...new Set(native.containers)],
        reference_id: referenceId,
        pose_resource: native.poseResource ?? null,
        pose_clip_index:
          native.poseResource &&
          category !== 'shield' &&
          category !== 'tower_shield' &&
          category !== 'buckler'
            ? 1
            : null,
        view: result.view,
        triangles: result.triangles,
        meshes: result.meshes,
      },
    };
    await writeFile(cacheFile, JSON.stringify(manifest.assets[id]));
    return id;
  }
  try {
    const queue = new Map(),
      links = [];
    for (const item of [...data.items].sort((a, b) => a.id.localeCompare(b.id))) {
      const row = articles.get(item.game_origin?.row_id),
        part = { 14: 'Blade', 15: 'Nozzle', 16: 'Shield' }[row?.category_code & 255];
      if (!part) continue;
      const bytes = Buffer.from(row.raw_hex, 'hex'),
        index = bytes.readUInt16LE(8),
        table = referenceTables.get(part),
        logical = equipmentModelReference(table.bytes, index, part),
        referenceId = `${part}_${index}`;
      if (!manifest.equipment_references[referenceId])
        manifest.equipment_references[referenceId] = {
          table: table.key,
          index,
          offset: index * 512,
          record_hex: table.bytes.subarray(index * 512, (index + 1) * 512).toString('hex'),
          container_path: logical,
        };
      if (!queue.has(logical)) queue.set(logical, { item, part, index, referenceId, logical });
      links.push({ item, row, index, logical, referenceId });
    }
    // Resolve shared grips and DDS images once before concurrent rendering.
    const jobs = [];
    for (const job of queue.values()) {
      const { item, part, logical } = job;
      const genre = part === 'Blade' ? logical.match(/\/Blade\/([^/]+)\//)?.[1] : null,
        preview = part === 'Blade' ? bladePoses.get(genre) : null;
      const parent = await container(logical),
        native = await nativeScene(
          parent,
          part,
          part === 'Shield' ? shieldPose : (preview?.pose ?? null),
        );
      native.poseResource = part === 'Shield' ? poseKey : (preview?.key ?? null);
      if (part === 'Blade') {
        const basePath = `bin/resconv_pc/data/GameData/player/Weapon/Part/Blade/${genre}/Base/Base.res`;
        if (!baseCache.has(genre))
          baseCache.set(genre, await nativeScene(await container(basePath), 'Base', preview.pose));
        appendScene(native, baseCache.get(genre));
      }
      jobs.push({ ...job, native });
      if (jobs.length % 50 === 0)
        progress(`Native model sources decoded: ${jobs.length}/${queue.size}`);
    }
    let cursor = 0;
    await Promise.all(
      pages.map(async (page) => {
        while (cursor < jobs.length) {
          const { item, logical, referenceId, native } = jobs[cursor++];
          const id = await render(native, item.category, referenceId, page);
          renders.set(logical, id);
          if (renders.size % 25 === 0)
            progress(`Native equipment renders: ${renders.size}/${queue.size}`);
        }
      }),
    );
    for (const { item, row, index, logical, referenceId } of links)
      manifest.portraits[item.id] = {
        kind: 'model_render',
        asset_id: renders.get(logical),
        native_id: row.id,
        model_index: index,
        reference_id: referenceId,
      };
    for (const entry of manifest.missing.filter((m) => m.reason === 'no_norn_illustration')) {
      const mapping = mappings.find((m) => m.site_id === entry.id),
        logical = `bin/resconv_pc/data/GameData/mission/XXX_Ship/model/enemy/${mapping.res_name}.res`,
        parent = await container(logical),
        native = await nativeScene(parent, 'model'),
        id = await render(native, 'aragami');
      manifest.entities[entry.id] = {
        kind: 'model_render',
        asset_id: id,
        family_id: mapping.family_id,
        res_name: mapping.res_name,
      };
      progress(`Native Aragami render: ${mapping.res_name}`);
    }
    manifest.missing = manifest.missing.filter((m) => !manifest.entities[m.id]);
  } finally {
    await browser.close();
  }
}
