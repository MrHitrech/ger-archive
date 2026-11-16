import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseIxo,
  equipmentModelReference,
  nativeSkeletonPose,
  nativeEquipmentPose,
} from '../scripts/lib/game-models.mjs';

const u16 = (...v) => {
  const b = Buffer.alloc(v.length * 2);
  v.forEach((n, i) => b.writeUInt16LE(n, i * 2));
  return b;
};
const u32 = (...v) => {
  const b = Buffer.alloc(v.length * 4);
  v.forEach((n, i) => b.writeUInt32LE(n, i * 4));
  return b;
};
const floats = (...v) => {
  const b = Buffer.alloc(v.length * 4);
  v.forEach((n, i) => b.writeFloatLE(n, i * 4));
  return b;
};
const string = (s) => {
  const b = Buffer.from(s + '\0');
  return Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
};
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function chunk(index, records, extra = Buffer.alloc(0)) {
  let at = 16 + records.length * 4 + extra.length;
  const offsets = records.map((r) => {
    const offset = at;
    at += r.length;
    return offset;
  });
  return Buffer.concat([
    u32((index << 16) | 0x7869, 0x000a0004, 0x00020000, records.length),
    u32(...offsets),
    extra,
    ...records,
  ]);
}
function container(chunks) {
  return Buffer.concat([
    u32(
      0x00037869,
      0x000a0004,
      0x00020000,
      3,
      28,
      28 + chunks[0].length,
      28 + chunks[0].length + chunks[1].length,
    ),
    ...chunks,
  ]);
}
function fixture({ badIndex = false, variants = 2, weight = 1 } = {}) {
  const types = [
    'GameObject',
    'UserMaterial',
    'FileTexture',
    'SkinnedMesh',
    'CgfxSG',
    'Geometry',
    'IndexBuffer',
    'VertexBuffer',
    'MatrixBuffer',
    'Skeleton',
  ];
  const vertex = (count, stride, data) => Buffer.concat([u32(count), u16(stride, 8), data]);
  const geometry = Buffer.concat([u16(3, 0), u32(1)]),
    mesh = Buffer.alloc(50);
  mesh.writeUInt16LE(4, 46);
  mesh.writeUInt16LE(1, 48);
  const skeleton = Buffer.concat([
    Buffer.alloc(6),
    floats(0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 1),
  ]);
  const objects = [
    ['GameObject', 'model', Buffer.alloc(0)],
    ['UserMaterial', 'material', Buffer.alloc(0)],
    ['FileTexture', 'Blade_tga', string('Blade.tga')],
    ['SkinnedMesh', 'mesh_Blade', mesh],
    ['CgfxSG', 'shading_group', Buffer.alloc(32)],
    ['Geometry', 'triangles', geometry],
    ['IndexBuffer', 'indices', Buffer.concat([u32(3), u16(0, 1), u16(0, 1, badIndex ? 9 : 2)])],
    [
      'VertexBuffer',
      'stream0',
      vertex(3, 24, floats(-1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1)),
    ],
    ['VertexBuffer', 'stream1_0', vertex(3, 8, floats(0, 0, 1, 0, 0.5, 1))],
    ['VertexBuffer', 'stream2_0', vertex(3, 4, Buffer.alloc(12, 255))],
    ['VertexBuffer', 'stream2_1', vertex(3, 4, Buffer.alloc(12))],
    [
      'VertexBuffer',
      'stream3',
      vertex(
        3,
        20,
        Buffer.concat(
          Array.from({ length: 3 }, () =>
            Buffer.concat([floats(weight, 0, 0, 0), Buffer.alloc(4)]),
          ),
        ),
      ),
    ],
    ['MatrixBuffer', 'invBind', Buffer.concat([u32(1), floats(...identity)])],
    ['Skeleton', 'joint_Root', skeleton],
  ].map(([type, name, data]) => {
    const nameBytes = Buffer.from(name + '\0'),
      header = Buffer.concat([u32(types.indexOf(type)), u16(0), nameBytes]);
    return Buffer.concat([header, Buffer.alloc((4 - (header.length % 4)) % 4), data]);
  });
  const references = [
    u16(1, 1, 2),
    u16(3, 1, 4, 12),
    u16(4, 1, 5, 1),
    u16(5, 6, 1, 7, 1, 8, variants, ...(variants === 2 ? [9, 10] : [9]), 1, 11),
  ];
  const bindings = [
    Buffer.concat([u32(3, 1), string('jointMember0'), u32(13), string('worldMatrix')]),
  ];
  function chunk(index, records, extra = Buffer.alloc(0)) {
    let at = 16 + records.length * 4 + extra.length;
    const offsets = records.map((r) => {
      const offset = at;
      at += r.length;
      return offset;
    });
    return Buffer.concat([
      u32((index << 16) | 0x7869, 0x000a0004, 0x00020000, records.length),
      u32(...offsets),
      extra,
      ...records,
    ]);
  }
  const chunks = [
    chunk(0, objects, Buffer.concat([u32(types.length), ...types.map(string)])),
    chunk(1, bindings),
    chunk(2, references),
  ];
  return Buffer.concat([
    u32(
      0x00037869,
      0x000a0004,
      0x00020000,
      3,
      28,
      28 + chunks[0].length,
      28 + chunks[0].length + chunks[1].length,
    ),
    ...chunks,
  ]);
}

test('IXO follows material references and variable stream lists without confusing color alternatives with skinning', () => {
  for (const variants of [1, 2]) {
    const decoded = parseIxo(fixture({ variants }));
    assert.equal(decoded.meshes.length, 1);
    assert.deepEqual(decoded.meshes[0].indices, [0, 1, 2]);
    assert.deepEqual(decoded.meshes[0].positions, [-1, 0, 0, 1, 0, 0, 0, 1, 0]);
    assert.ok(decoded.meshes[0].colors.every((c) => c === 1));
    assert.deepEqual(decoded.materials[0].textures, ['Blade.tga']);
  }
});
test('native preview poses transform weighted vertices; invalid indices, weights and file boundaries fail closed', () => {
  const bytes = fixture(),
    pose = nativeSkeletonPose(bytes);
  assert.deepEqual(pose.joint_Root, {
    position: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
  });
  pose.joint_Root.position = [2, 3, 4];
  assert.deepEqual(parseIxo(bytes, { pose }).meshes[0].positions, [1, 3, 4, 3, 3, 4, 2, 4, 4]);
  assert.throws(() => parseIxo(fixture({ weight: 0.5 }), { pose }), /weights/);
  assert.throws(() => parseIxo(fixture({ badIndex: true })), /index exceeds/);
  for (const b of [Buffer.alloc(0), bytes.subarray(0, -20)]) assert.throws(() => parseIxo(b));
});
test('equipment reference IDs select exact native resource rows and reject different part types', () => {
  const bytes = Buffer.alloc(1024),
    logical = 'bin/resconv_pc/data/GameData/player/Weapon/Part/Blade/Short/0002/Color1/Blade.res';
  bytes.writeUInt32LE(0xb0000020, 512);
  bytes.writeUInt32LE(4, 524);
  bytes.write(logical + '\0', 544);
  assert.equal(equipmentModelReference(bytes, 1, 'Blade'), logical);
  assert.throws(() => equipmentModelReference(bytes, 2, 'Blade'));
  assert.throws(() => equipmentModelReference(bytes, 0, 'Blade'));
  assert.throws(() => equipmentModelReference(bytes, 1, 'Shield'));
});
test('native equipment clips read unaligned AnimSet names and timestamped constant pose values', () => {
  const types = ['Motion', 'Skeleton', 'AnimSet', 'VectorAnimConstant', 'VectorAnimConstantUT'];
  function object(type, name, data) {
    const header = Buffer.concat([u32(types.indexOf(type)), u16(0), Buffer.from(name + '\0')]);
    return Buffer.concat([header, Buffer.alloc((4 - (header.length % 4)) % 4), data]);
  }
  function track(channel) {
    const head = Buffer.concat([u16(2), Buffer.from('joint_Blade_Base\0'), Buffer.from([channel])]);
    return Buffer.concat([head, Buffer.alloc((4 - (head.length % 4)) % 4)]);
  }
  const records = [
    object('Motion', 'blade_preview', Buffer.alloc(0)),
    object(
      'Skeleton',
      'joint_Blade_Base',
      Buffer.concat([Buffer.alloc(6), floats(0, -50, 60, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 1)]),
    ),
    track(1),
    Buffer.concat([u32(3, 1), floats(-10, 0, 0, 35)]),
    track(3),
    Buffer.concat([u32(4, 1), floats(1, 1, 1)]),
  ];
  const bytes = container([
    chunk(0, records, Buffer.concat([u32(types.length), ...types.map(string)])),
    chunk(1, []),
    chunk(2, [u16(0, 2, 2, 4), u16(2, 1, 3), u16(4, 1, 5)]),
  ]);
  assert.deepEqual(nativeEquipmentPose(bytes, 0).joint_Blade_Base, {
    position: [0, 0, 35],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
  });
  assert.throws(() => nativeEquipmentPose(bytes, 1), /clip missing/);
});
