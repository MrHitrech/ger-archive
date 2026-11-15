import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  gamePathHash,
  decompressBlz4,
  parseKst,
  kstString,
  parseTr2,
  openQpck,
  sha256,
} from '../scripts/lib/game-formats.mjs';
import { createGameImport, usableRussianName } from '../scripts/lib/game-import.mjs';
import { validateDataset, validateSnapshots } from '../scripts/lib/validate.mjs';
import { readGameExport } from '../scripts/import-game-data.mjs';
import { resourcePaths } from '../scripts/extract-game-data.mjs';

const date = '2026-11-15';
const empty = () =>
  Object.fromEntries(
    [
      'materials',
      'items',
      'recipes',
      'missions',
      'aragami',
      'locations',
      'drops',
      'sources',
      'evidence',
      'translations',
    ].map((key) => [key, []]),
  );
// Deliberately synthetic, in-memory metadata; these fixtures are never written to production data.
function fixture() {
  const resources = Object.fromEntries(
    Object.entries(resourcePaths).map(([key, resource_path]) => [
      key,
      {
        resource_path,
        sha256: 'a'.repeat(64),
        archive: 'bin.qpck',
        entry_hash: 'b'.repeat(16),
      },
    ]),
  );
  return {
    manifest: { format_version: 1, app_id: '460870', build_id: '1', resources, archives: [] },
    decoded: {
      article_en: [
        { id: 10164, name: 'Fixture Thorn', category_code: 522, rank: 1 },
        { id: 13508, name: 'Fixture Metal', category_code: 10, rank: 1 },
        { id: 10719, name: 'Fixture Sword P', category_code: 14, rank: 1 },
        { id: 10720, name: 'Fixture Sword', category_code: 14, rank: 2 },
      ],
      article_ru: [
        { id: 10164, name: 'Шип' },
        { id: 13508, name: 'М\u0014талл' },
        { id: 10719, name: 'Меч P' },
        { id: 10720, name: 'Меч' },
      ],
      forge: [
        {
          id: 1,
          result_id: 10719,
          base_id: null,
          price: 350,
          ingredients: [
            { id: 10164, quantity: 1 },
            { id: 13508, quantity: 1 },
          ],
          unlock_raw: { progress_and: 1 },
        },
      ],
      upgrades: [
        {
          id: 1,
          result_id: 10720,
          base_id: 10719,
          price: 280,
          ingredients: [
            { id: 10164, quantity: 2 },
            { id: 13508, quantity: 1 },
          ],
          unlock_raw: { progress_and: 4 },
        },
      ],
    },
  };
}
async function temporary(t) {
  const prefix = path.join(tmpdir(), 'ger-import-test-'),
    directory = await mkdtemp(prefix);
  t.after(async () => {
    assert.ok(path.resolve(directory).startsWith(path.resolve(prefix)));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}
function blzFixture() {
  const chunks = [
    Buffer.from('kst1 fixture first block'),
    Buffer.from(' second block'),
    Buffer.from(' last block'),
  ];
  const plain = Buffer.concat(chunks),
    header = Buffer.alloc(32);
  header.write('blz4');
  header.writeUInt32LE(plain.length, 4);
  createHash('md5').update(plain).digest().copy(header, 16);
  const packed = [chunks.at(-1), ...chunks.slice(0, -1)].flatMap((chunk) => {
    const z = deflateSync(chunk),
      len = Buffer.alloc(2);
    len.writeUInt16LE(z.length);
    return [len, z];
  });
  return { plain, packed: Buffer.concat([header, ...packed]) };
}

test('CRC64 matches two independently recovered paths and preserves suffixes', () => {
  assert.equal(gamePathHash(resourcePaths.article_en + '.blz'), 'fa357cdf8ccfa10c');
  assert.equal(gamePathHash(resourcePaths.forge), 'bee8b198e99a18eb');
  assert.equal(
    gamePathHash('/' + resourcePaths.forge.toUpperCase().replaceAll('/', '\\')),
    gamePathHash(resourcePaths.forge),
  );
  assert.notEqual(gamePathHash('Armor+.tr2'), gamePathHash('Armor.tr2'));
});
test('BLZ4 reconstruction validates chunk order, complete size and stored MD5', () => {
  const { packed, plain } = blzFixture();
  assert.deepEqual(decompressBlz4(packed).bytes, plain);
  const corrupt = Buffer.from(packed);
  corrupt[16] ^= 1;
  assert.throws(() => decompressBlz4(corrupt), /MD5/);
  assert.throws(() => decompressBlz4(packed.subarray(0, packed.length - 1)), /bounds/);
});
test('KST uses sparse MSB-first keys rather than row ordinals', () => {
  const bytes = Buffer.alloc(74);
  bytes.write('kst1');
  bytes.writeUInt32LE(4, 8);
  bytes.writeUInt32LE(2, 12);
  bytes.writeUInt32LE(24, 16);
  bytes.writeUInt32LE(68, 20);
  // Grow for two records and a length-prefixed string.
  const full = Buffer.concat([bytes, Buffer.alloc(16)]);
  full.writeUInt32LE(1, 24);
  full.writeUInt32LE(9, 28);
  full.writeUInt32LE(0x40400000, 36);
  full.writeUInt32LE(78, 68);
  full.writeUInt32LE(78, 72);
  full.writeUInt16LE(4, 78);
  full.write('abc\0', 80);
  const parsed = parseKst(full);
  assert.deepEqual(
    parsed.rows.map((r) => r.key),
    [1, 9],
  );
  assert.equal(kstString(full, 78, parsed.record_end), 'abc');
  const corrupt = Buffer.from(full);
  corrupt.writeUInt32LE(3, 12);
  assert.throws(() => parseKst(corrupt), /record count/);
  assert.throws(() => kstString(full, 68, parsed.record_end), /points into/);
});
function tr2Fixture() {
  const b = Buffer.alloc(256);
  b.write('.tr2');
  b.write('fixture');
  b.write('.tr2', 0);
  b.write('fixture', 8);
  b.writeUInt32LE(64, 56);
  b.writeUInt32LE(1, 60);
  b.writeUInt32LE(96, 68);
  b.writeUInt32LE(2, 84);
  b.writeUInt32LE(7, 88);
  b.writeUInt32LE(42, 92);
  b.write('ingredients', 96);
  b.write('UINT16', 160);
  b.writeUInt16LE(3, 214);
  b.writeUInt32LE(2, 220);
  b.writeUInt32LE(140, 224);
  b.writeUInt32LE(144, 228);
  b.writeUInt32LE(146, 232);
  b.writeUInt16LE(10, 236);
  b.writeUInt16LE(20, 238);
  b.writeUInt16LE(30, 240);
  return b;
}
test('TR2 decodes variable ingredient arrays within each cell, not the maximum width', () => {
  const bytes = tr2Fixture(),
    table = parseTr2(bytes);
  assert.deepEqual(table.rows, [
    { id: 7, ingredients: [10, 20] },
    { id: 42, ingredients: [30] },
  ]);
  const bad = Buffer.from(bytes);
  bad.writeUInt32LE(1, 220);
  assert.throws(() => parseTr2(bad), /sparse/);
  assert.throws(() => parseTr2(bytes.subarray(0, 240)), /bounds/);
});
test('QPCK reader rejects entries outside the archive before exposing resources', async (t) => {
  const dir = await temporary(t),
    file = path.join(dir, 'invalid.qpck'),
    b = Buffer.alloc(28);
  b.writeUInt32LE(0x37402858, 0);
  b.writeUInt32LE(1, 4);
  b.writeBigUInt64LE(999n, 8);
  b.writeUInt32LE(1, 24);
  await writeFile(file, b);
  await assert.rejects(openQpck(file), /invalid entry/);
});
test('native recipes and materials build a valid linked dataset with auditable JSON snapshots', async () => {
  const result = createGameImport(empty(), fixture(), { checkedAt: date });
  assert.deepEqual(result.report.blocking, []);
  assert.deepEqual(validateDataset(result.dataset).errors, []);
  assert.deepEqual(await validateSnapshots(result.dataset, { snapshots: result.snapshots }), []);
  assert.equal(result.dataset.recipes.length, 2);
  assert.equal(result.dataset.recipes[1].verification_status, 'partial');
  assert.ok(result.dataset.recipes.every((r) => r.missing_fields.includes('unlock_conditions')));
  assert.ok(
    result.dataset.recipes.some(
      (r) => r.required_rank === 2 && r.unlock_conditions_raw.progress_and === 4,
    ),
  );
});
test('repeat import reuses every native identity without duplicating records or evidence', () => {
  const first = createGameImport(empty(), fixture(), { checkedAt: date });
  const second = createGameImport(first.dataset, fixture(), { checkedAt: date });
  assert.deepEqual(second.dataset, first.dataset);
  assert.deepEqual(second.report.factual_changes, []);
  for (const c of Object.values(second.report.counts)) {
    assert.equal(c.added, 0);
    assert.equal(c.updated, 0);
  }
});
test('legacy site IDs, Russian editorial names and inventories can retain their identities', () => {
  const first = createGameImport(empty(), fixture(), { checkedAt: date }).dataset;
  const item = first.items.find((r) => r.name_en === 'Fixture Sword P'),
    id = item.id;
  delete item.game_origin;
  first.translations.find((t) => t.id === id).name_ru = 'Редакторское название';
  const result = createGameImport(first, fixture(), { checkedAt: date });
  assert.equal(result.dataset.items.find((r) => r.name_en === 'Fixture Sword P').id, id);
  assert.equal(
    result.dataset.translations.find((t) => t.id === id).name_ru,
    'Редакторское название',
  );
});
test('explicit spelling mappings preserve IDs and keep the old English name searchable', () => {
  const first = createGameImport(empty(), fixture(), { checkedAt: date }).dataset;
  const material = first.materials.find((r) => r.name_en === 'Fixture Thorn');
  delete material.game_origin;
  material.name_en = 'Old Thorn';
  const translation = first.translations.find((t) => t.id === material.id);
  translation.name_en = 'Old Thorn';
  const mappings = [
    {
      native_id: 10164,
      collection: 'materials',
      existing_id: material.id,
      previous_name: 'Old Thorn',
      canonical_name: 'Fixture Thorn',
    },
  ];
  const result = createGameImport(first, fixture(), { checkedAt: date, articleMappings: mappings });
  assert.equal(result.dataset.materials.find((r) => r.name_en === 'Fixture Thorn').id, material.id);
  assert.ok(
    result.dataset.translations.find((r) => r.id === material.id).aliases.includes('Old Thorn'),
  );
  mappings[0].canonical_name = 'Wrong';
  assert.ok(
    createGameImport(first, fixture(), { checkedAt: date, articleMappings: mappings }).report
      .blocking.length,
  );
});
test('missing upgrade predecessors and test content go to quarantine, never into recipes', () => {
  const input = fixture();
  input.decoded.upgrades[0].base_id = 9999;
  let result = createGameImport(empty(), input, { checkedAt: date });
  assert.equal(result.dataset.recipes.length, 1);
  assert.equal(result.report.quarantined_rows, 1);
  input.decoded.forge[0].result_id = 10720;
  input.decoded.article_en.find((r) => r.id === 10720).name = '[PH] Test';
  result = createGameImport(empty(), input, { checkedAt: date });
  assert.equal(result.dataset.recipes.length, 0);
});
test('cycles block the candidate import before it reaches the planner', () => {
  const input = fixture();
  input.decoded.upgrades.push({
    ...input.decoded.upgrades[0],
    id: 2,
    result_id: 10719,
    base_id: 10720,
  });
  assert.ok(
    createGameImport(empty(), input, { checkedAt: date }).report.blocking.some(
      (r) => r.code === 'UPGRADE_CYCLE',
    ),
  );
});
test('special text bytes are retained for research and rejected as Russian translations', () => {
  assert.equal(usableRussianName('М\u0014талл'), false);
  assert.equal(usableRussianName('Металл'), true);
  const result = createGameImport(empty(), fixture(), { checkedAt: date });
  const metal = result.dataset.materials.find((r) => r.name_en === 'Fixture Metal');
  assert.ok(!result.dataset.translations.some((r) => r.id === metal.id));
});
test('a wrong native resource hash or recipe ingredient is rejected by validation', () => {
  const result = createGameImport(empty(), fixture(), { checkedAt: date });
  const changed = structuredClone(result.dataset);
  changed.recipes[0].cost_fc++;
  assert.ok(
    validateDataset(changed).errors.some((e) => e.includes('differs from native evidence')),
  );
  const changedHash = structuredClone(result.dataset);
  changedHash.items[0].game_origin.resource_sha256 = 'f'.repeat(64);
  assert.ok(validateDataset(changedHash).errors.some((e) => e.includes('checksum mismatch')));
  const changedRank = structuredClone(result.dataset);
  changedRank.items[0].rank = 14;
  assert.ok(
    validateDataset(changedRank).errors.some((e) => e.includes('article rank/category differs')),
  );
});
test('altered decoded exports are rejected even when the extracted binary is unchanged', async (t) => {
  const dir = await temporary(t);
  await mkdir(path.join(dir, 'resources'));
  const input = fixture();
  input.manifest.decoded_files = {};
  for (const [key, r] of Object.entries(input.manifest.resources)) {
    r.local_file = `resources/${key}.${key === 'forge' || key === 'synthesis' ? 'tr2' : 'kst'}`;
    const raw = Buffer.from('synthetic fixture');
    r.sha256 = sha256(raw);
    await writeFile(path.join(dir, r.local_file), raw);
    const json = Buffer.from(JSON.stringify(input.decoded[key] ?? []));
    input.manifest.decoded_files[key] = sha256(json);
    await writeFile(path.join(dir, `${key}.json`), json);
  }
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(input.manifest));
  await writeFile(path.join(dir, 'article_en.json'), '[]');
  await assert.rejects(readGameExport(dir), /Decoded table checksum mismatch/);
});
