import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { dataDir, hash } from './files.mjs';
import { gamePathHash } from './game-formats.mjs';
import { ddsInfo, webpDimensions } from './game-textures.mjs';
import {
  IMAGE_DECODER,
  inventoryIcon,
  iconPath,
  nornPaths,
  equipmentReferencePath,
  shieldPosePath,
  equipmentPosePath,
} from './game-image-layouts.mjs';
import { MODEL_DECODER, equipmentModelReference } from './game-models.mjs';

export function validateImageManifest(data, manifest, aragamiMappings) {
  const errors = [];
  try {
    if (
      manifest.format_version !== 2 ||
      manifest.game !== 'ger' ||
      manifest.app_id !== '460870' ||
      manifest.decoder !== IMAGE_DECODER
    )
      throw new Error('Unsupported game image manifest');
    const source = data.sources.find((s) => s.equipment_stats_decoder && s.resources?.article_en);
    if (
      manifest.build_id !== source?.build_id ||
      manifest.article_sha256 !== source.resources.article_en.sha256 ||
      manifest.archives.length !== source.archives.length ||
      manifest.archives.some(
        (a) =>
          !source.archives.some(
            (s) => s.name === a.name && s.index_sha256 === a.index_sha256 && s.size === a.size,
          ),
      )
    )
      throw new Error('Images do not match the imported game build');
    const resources = manifest.resources,
      assets = manifest.assets,
      evidence = new Map(data.evidence.map((e) => [e.id, e])),
      records = new Map([...data.materials, ...data.items, ...data.aragami].map((r) => [r.id, r]));
    if (!/^[a-f0-9]{64}$/.test(manifest.model_renderer?.renderer_sha256 ?? ''))
      throw new Error('Native model renderer fingerprint missing');
    for (const [key, resource] of Object.entries(resources)) {
      const archive = manifest.archives.find((a) => a.name === resource.archive);
      if (
        !archive ||
        gamePathHash(resource.stored_path) !== resource.entry_hash ||
        !['texture_set', 'ixo', 'ixo_pose', 'equipment_references', 'pres', 'tr2'].includes(
          resource.format,
        ) ||
        !/^([a-f0-9]{64})$/.test(resource.sha256) ||
        !/^([a-f0-9]{64})$/.test(resource.stored_sha256) ||
        !resource.integrity ||
        (resource.format === 'texture_set' && !(resource.texture_count >= 1)) ||
        resource.archive_offset < 0 ||
        resource.archive_offset + resource.stored_size > archive.size
      )
        throw new Error(`Invalid image resource: ${key}`);
    }
    if (
      manifest.terminology?.spark?.en?.text !== 'Spark' ||
      manifest.terminology?.spark?.ru?.text !== 'Искры' ||
      ['en', 'ru'].some(
        (locale) =>
          manifest.terminology.spark[locale].row_id !== 154 ||
          resources[manifest.terminology.spark[locale].resource]?.format !== 'tr2',
      )
    )
      throw new Error('Native Spark element translation is missing');
    for (const [id, asset] of Object.entries(assets)) {
      const resource = resources[asset.resource];
      if (
        !resource ||
        !/^images\/ger\/[a-f0-9]{16}\.webp$/.test(asset.file) ||
        asset.file !== `images/ger/${asset.sha256.slice(0, 16)}.webp` ||
        asset.id !== id
      )
        throw new Error(`Invalid image asset: ${id}`);
      if (asset.kind === 'model_render') {
        const render = asset.render;
        if (
          resource.format !== 'ixo' ||
          asset.width !== 768 ||
          asset.height !== 512 ||
          render?.decoder !== MODEL_DECODER ||
          !(render.triangles > 0) ||
          !render.geometry?.length ||
          render.geometry.some((k) => resources[k]?.format !== 'ixo') ||
          !render.textures?.length ||
          render.textures.some((k) => resources[k]?.format !== 'texture_set') ||
          !render.containers?.length ||
          render.containers.some((k) => resources[k]?.format !== 'pres') ||
          (render.pose_resource &&
            ![
              shieldPosePath,
              ...['Short', 'Long', 'Buster', 'Hammer', 'Spear', 'Scythe'].map(equipmentPosePath),
            ].includes(resources[render.pose_resource]?.resource_path))
        )
          throw new Error(`Invalid native model render: ${id}`);
      } else {
        if (
          resource.format !== 'texture_set' ||
          asset.texture_index < 0 ||
          asset.texture_index >= resource.texture_count ||
          asset.dds_offset < 4 + resource.texture_count * 4 ||
          asset.dds_offset + asset.dds_size > resource.size
        )
          throw new Error(`Invalid DDS image range: ${id}`);
        const dimensions = ddsInfo(Buffer.from(asset.dds_header_hex, 'hex'), { headerOnly: true });
        if (
          dimensions.width !== asset.width ||
          dimensions.height !== asset.height ||
          dimensions.size !== asset.dds_size ||
          !/^([a-f0-9]{64})$/.test(asset.dds_sha256)
        )
          throw new Error(`Image dimensions differ from DDS: ${id}`);
      }
    }
    for (const [key, ref] of Object.entries(manifest.equipment_references ?? {})) {
      const part = key.split('_')[0],
        table = resources[ref.table],
        bytes = Buffer.from(ref.record_hex, 'hex');
      if (
        !['Blade', 'Nozzle', 'Shield'].includes(part) ||
        table?.resource_path !== equipmentReferencePath(part) ||
        !Number.isInteger(ref.index) ||
        ref.index < 0 ||
        key !== `${part}_${ref.index}` ||
        ref.offset !== ref.index * 512 ||
        ref.offset + 512 > table.size ||
        bytes.length !== 512 ||
        equipmentModelReference(bytes, 0, part) !== ref.container_path
      )
        throw new Error(`Invalid equipment model reference: ${key}`);
    }
    for (const [id, image] of Object.entries(manifest.entities)) {
      const record = records.get(id),
        asset = assets[image.asset_id],
        resource = resources[asset?.resource];
      if (!record || !asset) throw new Error(`Unlinked game image: ${id}`);
      if (image.kind === 'inventory_icon') {
        const origin = record.game_origin;
        const facts = record.references
          .map((ref) => evidence.get(ref))
          .filter(
            (e) =>
              e?.game_origin?.resource === 'article_en' && e.game_origin.row_id === origin?.row_id,
          )
          .map((e) => JSON.parse(e.excerpt))
          .find((f) => f.category_code !== undefined);
        const header = Buffer.from(image.article_header_hex ?? '', 'hex'),
          expected = inventoryIcon(image.packed_icon);
        if (
          !origin ||
          image.native_id !== origin.row_id ||
          image.category_code !== facts?.category_code ||
          header.length !== 10 ||
          header.readUInt16LE(0) !== origin.row_id ||
          header.readUInt16LE(2) !== facts.category_code ||
          header.readUInt16LE(4) !== image.packed_icon ||
          !expected ||
          resource.resource_path !== iconPath(expected.sheet) ||
          asset.texture_index !== expected.index
        )
          throw new Error(`Inventory image differs from native article: ${id}`);
      } else if (image.kind === 'norn_illustration') {
        const mapping = aragamiMappings.find((m) => m.site_id === id);
        if (
          !mapping ||
          image.family_id !== mapping.family_id ||
          !nornPaths(mapping.family_id).includes(resource.resource_path) ||
          asset.texture_index !== 0 ||
          resource.texture_count !== 1
        )
          throw new Error(`Aragami image differs from native family: ${id}`);
      } else if (image.kind === 'model_render') {
        const mapping = aragamiMappings.find((m) => m.site_id === id),
          render = asset.render,
          container = resources[render?.containers?.[0]];
        if (
          !mapping ||
          image.family_id !== mapping.family_id ||
          image.res_name !== mapping.res_name ||
          asset.kind !== 'model_render' ||
          !container?.resource_path.endsWith(`/model/enemy/${mapping.res_name}.res`) ||
          !resource.resource_path.includes(`/enemy/Boss/${mapping.res_name}/`)
        )
          throw new Error(`Aragami model differs from native family: ${id}`);
      } else throw new Error('Unknown game image kind');
    }
    for (const record of data.items) {
      const combat = [
          'short_blade',
          'long_blade',
          'buster_blade',
          'boost_hammer',
          'charge_spear',
          'variant_scythe',
          'sniper',
          'assault',
          'blast',
          'shotgun',
          'buckler',
          'shield',
          'tower_shield',
        ].includes(record.category),
        image = manifest.portraits?.[record.id];
      if (!combat) {
        if (image) throw new Error('Unexpected non-combat model image');
        continue;
      }
      const asset = assets[image?.asset_id],
        icon = manifest.entities[record.id],
        header = Buffer.from(icon?.article_header_hex ?? '', 'hex'),
        ref = manifest.equipment_references?.[image?.reference_id],
        render = asset?.render,
        container = resources[render?.containers?.[0]];
      const shield = ['buckler', 'shield', 'tower_shield'].includes(record.category);
      const genre = ref?.container_path.match(/\/Blade\/([^/]+)\//)?.[1];
      if (
        image?.kind !== 'model_render' ||
        image.native_id !== record.game_origin?.row_id ||
        header.length !== 10 ||
        header.readUInt16LE(8) !== image.model_index ||
        !ref ||
        ref.index !== image.model_index ||
        container?.resource_path !== ref.container_path ||
        asset?.kind !== 'model_render' ||
        (shield && resources[render.pose_resource]?.resource_path !== shieldPosePath) ||
        (genre &&
          (resources[render.pose_resource]?.resource_path !== equipmentPosePath(genre) ||
            render.pose_clip_index !== 1))
      )
        throw new Error(`Equipment image differs from native model ID: ${record.id}`);
    }
    const missing = new Map(manifest.missing.map((m) => [m.id, m]));
    if (missing.size !== manifest.missing.length) throw new Error('Duplicated missing image');
    for (const record of records.values())
      if (!manifest.entities[record.id] && !missing.has(record.id))
        throw new Error(`Image coverage entry missing: ${record.id}`);
    for (const [id, entry] of missing) {
      if (
        !records.has(id) ||
        manifest.entities[id] ||
        !['native_identity_unknown', 'no_norn_illustration'].includes(entry.reason)
      )
        throw new Error(`Invalid missing image: ${id}`);
      if (entry.reason === 'native_identity_unknown' && records.get(id).game_origin)
        throw new Error('Native image identity should be known');
      if (
        entry.reason === 'no_norn_illustration' &&
        aragamiMappings.find((m) => m.site_id === id)?.family_id !== entry.family_id
      )
        throw new Error('Unknown missing Aragami image family');
    }
    const used = new Set(
      [...Object.values(manifest.entities), ...Object.values(manifest.portraits ?? {})].map(
        (e) => e.asset_id,
      ),
    );
    if (Object.keys(assets).some((id) => !used.has(id))) throw new Error('Unlinked image asset');
    const coverage = {
      materials: data.materials.filter((r) => manifest.entities[r.id]).length,
      items: data.items.filter((r) => manifest.entities[r.id]).length,
      aragami: data.aragami.filter((r) => manifest.entities[r.id]).length,
      equipment_portraits: Object.keys(manifest.portraits ?? {}).length,
      assets: Object.keys(assets).length,
      missing: missing.size,
      bytes: Object.values(assets).reduce((sum, a) => sum + a.size, 0),
    };
    if (JSON.stringify(manifest.coverage) !== JSON.stringify(coverage))
      throw new Error('Game image coverage differs from records');
  } catch (error) {
    errors.push(error.message);
  }
  return errors;
}

export async function validateImageFiles(manifest, directory = path.join(dataDir, 'image-assets')) {
  const errors = [];
  for (const asset of Object.values(manifest.assets)) {
    try {
      const bytes = await readFile(path.join(directory, path.basename(asset.file))),
        dimensions = webpDimensions(bytes);
      if (
        hash(bytes) !== asset.sha256 ||
        bytes.length !== asset.size ||
        dimensions.width !== asset.width ||
        dimensions.height !== asset.height
      )
        throw new Error('Image checksum or dimensions differ');
    } catch (error) {
      errors.push(`${asset.file}: ${error.message}`);
    }
  }
  return errors;
}
