import test from 'node:test';
import assert from 'node:assert/strict';
import { readDataset, readJson, dataDir } from '../scripts/lib/files.mjs';
import { ddsInfo, parseTextureSet, webpDimensions } from '../scripts/lib/game-textures.mjs';
import { inventoryIcon } from '../scripts/lib/game-image-layouts.mjs';
import { elements } from '../src/lib/game-elements.ts';
import {
  validateImageManifest,
  validateImageFiles,
} from '../scripts/lib/game-image-validation.mjs';

function dds(width = 4, height = 4, fourcc = 'DXT5') {
  const bytes = Buffer.alloc(
    128 + Math.ceil(width / 4) * Math.ceil(height / 4) * (fourcc === 'DXT1' ? 8 : 16),
  );
  bytes.write('DDS ');
  bytes.writeUInt32LE(124, 4);
  bytes.writeUInt32LE(height, 12);
  bytes.writeUInt32LE(width, 16);
  bytes.writeUInt32LE(1, 28);
  bytes.writeUInt32LE(32, 76);
  bytes.write(fourcc, 84);
  return bytes;
}
function textureSet(textures) {
  const header = Buffer.alloc(4 + textures.length * 4);
  header.writeUInt32LE(textures.length);
  textures.forEach((texture, i) => header.writeUInt32LE(texture.length, 4 + i * 4));
  return Buffer.concat([header, ...textures]);
}
test('PC texture sets expose bounded DDS images instead of assuming a native GNF texture layout', () => {
  const first = dds(),
    second = dds(8, 8, 'DXT1'),
    bytes = textureSet([first, second]),
    decoded = parseTextureSet(bytes);
  assert.equal(decoded.length, 2);
  assert.equal(decoded[0].offset, 12);
  assert.deepEqual(decoded[0].bytes, first);
  assert.equal(decoded[1].width, 8);
  assert.equal(decoded[1].fourcc, 'DXT1');
  for (const corrupt of [
    Buffer.alloc(0),
    Buffer.alloc(8),
    bytes.subarray(0, -1),
    Buffer.concat([bytes, Buffer.alloc(1)]),
  ])
    assert.throws(() => parseTextureSet(corrupt));
  const huge = Buffer.from(bytes);
  huge.writeUInt32LE(999999, 4);
  assert.throws(() => parseTextureSet(huge));
  const unsupported = dds();
  unsupported.write('DX10', 84);
  assert.throws(() => ddsInfo(unsupported));
  const mip = dds();
  mip.writeUInt32LE(9, 28);
  assert.throws(() => ddsInfo(mip));
});
test('WebP dimensions are checked from the published bytes', () => {
  const bytes = Buffer.alloc(26);
  bytes.write('RIFF');
  bytes.writeUInt32LE(18, 4);
  bytes.write('WEBP', 8);
  bytes.write('VP8L', 12);
  bytes.writeUInt32LE(5, 16);
  bytes[20] = 0x2f;
  bytes.writeUInt32LE((63 << 14) | 127, 21);
  assert.deepEqual(webpDimensions(bytes), { width: 128, height: 64 });
  assert.throws(() => webpDimensions(bytes.subarray(0, -1)));
});
test('native article icon bits preserve the actual shape and palette, independent of category or rank', () => {
  assert.deepEqual(inventoryIcon(0), { sheet: 11, index: 0 });
  assert.deepEqual(inventoryIcon(64), { sheet: 11, index: 1 });
  assert.deepEqual(inventoryIcon(4096 + 256), { sheet: 11, index: 4 });
  assert.deepEqual(inventoryIcon(12 + 5 * 64), { sheet: 12, index: 29 });
  assert.deepEqual(inventoryIcon(19 + 5 * 64), { sheet: 13, index: 3 });
  // Pixie Thorn is a gray rock; Wyrm Armor a blue rock, Hanuman Mask a blue organic material.
  assert.deepEqual(inventoryIcon(344), { sheet: 14, index: 5 });
  assert.deepEqual(inventoryIcon(152), { sheet: 14, index: 2 });
  assert.deepEqual(inventoryIcon(154), { sheet: 14, index: 14 });
  assert.deepEqual(inventoryIcon(89), { sheet: 14, index: 7 });
  assert.deepEqual(inventoryIcon(347), { sheet: 14, index: 23 });
  for (const bad of [-1, undefined, 65536, 63, 14, 24 + 6 * 64])
    assert.equal(inventoryIcon(bad), null);
});

const data = await readDataset(),
  manifest = await readJson(`${dataDir}/game-images.json`),
  mappings = await readJson(`${dataDir}/import-mappings/game-aragami.json`);
test('all game images have native provenance, linked IDs, valid WebP bytes and accurate coverage', async () => {
  assert.deepEqual(validateImageManifest(data, manifest, mappings), []);
  assert.deepEqual(await validateImageFiles(manifest), []);
  assert.equal(manifest.coverage.items, 2787);
  assert.equal(manifest.coverage.materials, 615);
  assert.equal(manifest.coverage.aragami, 53);
  assert.equal(manifest.coverage.equipment_portraits, 2186);
  assert.equal(manifest.coverage.missing, 1);
  assert.equal(
    Object.values(manifest.entities).filter((e) => e.kind === 'inventory_icon').length,
    3402,
  );
  const vajra = data.aragami.find((a) => a.name_en === 'Vajra'),
    heaven = data.aragami.find((a) => a.name_en === 'Heavenly Father');
  assert.equal(manifest.entities[vajra.id].family_id, 1);
  assert.equal(manifest.entities[heaven.id].family_id, 31);
  assert.notEqual(manifest.entities[vajra.id].asset_id, manifest.entities[heaven.id].asset_id);
  for (const family of [145, 148]) {
    const mapping = mappings.find((m) => m.family_id === family),
      image = manifest.entities[mapping.site_id];
    assert.equal(image.kind, 'model_render');
    assert.equal(image.family_id, family);
  }
  assert.equal(manifest.terminology.spark.en.text, 'Spark');
  assert.equal(manifest.terminology.spark.ru.text, elements.spark);
  assert.equal(elements.spark, 'Искры');
});
test('wrong enemy pictures, wrong category icons, corrupt hashes and uncovered records block the build', async () => {
  for (const mutate of [
    (m) => {
      const vajra = data.aragami.find((a) => a.name_en === 'Vajra'),
        heaven = data.aragami.find((a) => a.name_en === 'Heavenly Father');
      m.entities[vajra.id].asset_id = m.entities[heaven.id].asset_id;
    },
    (m) => {
      const knife = data.items.find((i) => i.name_en === 'Knife P'),
        falcon = data.items.find((i) => i.name_en === 'Falcon P');
      m.entities[knife.id].asset_id = m.entities[falcon.id].asset_id;
    },
    (m) => {
      Object.values(m.assets)[0].width++;
    },
    (m) => {
      Object.values(m.assets).find((a) => a.kind !== 'model_render').dds_offset = 999999999;
    },
    (m) => {
      Object.values(m.assets)[0].sha256 = '0'.repeat(64);
    },
    (m) => {
      delete m.entities[data.items[0].id];
    },
    (m) => {
      const image = Object.values(m.entities).find((e) => e.kind === 'model_render');
      image.family_id = 1;
    },
    (m) => {
      const item = data.items.find((i) => i.name_en === 'Knife P');
      m.portraits[item.id].model_index++;
    },
    (m) => {
      const knife = data.items.find((i) => i.name_en === 'Knife P'),
        falcon = data.items.find((i) => i.name_en === 'Falcon P');
      m.portraits[knife.id].asset_id = m.portraits[falcon.id].asset_id;
    },
    (m) => {
      Object.values(m.assets).find((a) => a.render?.pose_clip_index === 1).render.pose_clip_index =
        0;
    },
    (m) => {
      const item = data.items.find((i) => i.name_en === 'Wyrm Armor'),
        material = data.materials.find((i) => i.name_en === 'Wyrm Armor');
      const image = m.entities[(material ?? item).id];
      image.packed_icon = 344;
    },
    (m) => {
      m.terminology.spark.ru.text = 'Молния';
    },
    (m) => {
      m.article_sha256 = '0'.repeat(64);
    },
  ]) {
    const changed = structuredClone(manifest);
    mutate(changed);
    assert.ok(validateImageManifest(data, changed, mappings).length);
  }
  const asset = Object.values(manifest.assets)[0];
  assert.ok(
    (await validateImageFiles({ assets: { [asset.id]: { ...asset, sha256: '0'.repeat(64) } } }))
      .length,
  );
});
