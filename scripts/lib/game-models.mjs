/** PC IXO object graphs, vertex declarations and indexed triangle lists. */
export const MODEL_DECODER = 'ger-ixo-mesh-v1';

function range(bytes, offset, size, label) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(size) ||
    offset < 0 ||
    size < 0 ||
    offset + size > bytes.length
  )
    throw new Error(`IXO ${label}: out of bounds`);
}
function str(bytes, at, end = bytes.length) {
  const zero = bytes.indexOf(0, at);
  if (zero < at || zero >= end) throw new Error('IXO unterminated string');
  return { value: bytes.toString('utf8', at, zero), end: zero + 1 };
}
export function parseIxoGraph(bytes) {
  range(bytes, 0, 28, 'header');
  if (bytes.readUInt32LE(0) !== 0x00037869 || bytes.readUInt32LE(12) !== 3)
    throw new Error('Unsupported IXO object container');
  const chunks = [16, 20, 24].map((at) => bytes.readUInt32LE(at));
  function directory(index) {
    const start = chunks[index],
      end = chunks[index + 1] ?? bytes.length;
    range(bytes, start, 16, 'chunk');
    if (bytes.readUInt32LE(start) !== ((index << 16) | 0x7869) || end < start)
      throw new Error('Invalid IXO chunk');
    const count = bytes.readUInt32LE(start + 12);
    range(bytes, start + 16, count * 4, 'directory');
    const offsets = Array.from(
      { length: count },
      (_, i) => start + bytes.readUInt32LE(start + 16 + i * 4),
    );
    for (let i = 0; i < offsets.length; i++)
      if (
        offsets[i] < start + 16 + count * 4 ||
        offsets[i] >= end ||
        (i && offsets[i] < offsets[i - 1])
      )
        throw new Error('Invalid IXO object offset');
    return { start, end, count, offsets };
  }
  const objectsDirectory = directory(0);
  let at = objectsDirectory.start + 16 + objectsDirectory.count * 4;
  range(bytes, at, 4, 'types');
  const typeCount = bytes.readUInt32LE(at),
    types = [];
  if (typeCount > 256) throw new Error('IXO type count exceeds limit');
  at += 4;
  for (let i = 0; i < typeCount; i++) {
    const s = str(bytes, at, objectsDirectory.offsets[0]);
    types.push(s.value);
    at = objectsDirectory.start + ((s.end - objectsDirectory.start + 3) & ~3);
  }
  const objects = objectsDirectory.offsets.map((start, id) => {
    const end = objectsDirectory.offsets[id + 1] ?? objectsDirectory.end;
    range(bytes, start, 6, 'object header');
    const name = str(bytes, start + 6, end),
      type = types[bytes.readUInt32LE(start) & 0xffff];
    if (!type) throw new Error('IXO unknown object type');
    return {
      id,
      type,
      name: name.value,
      attributes: bytes.readUInt16LE(start + 4),
      start,
      end,
      data: start + ((name.end - start + 3) & ~3),
    };
  });
  const references = new Map(),
    refDirectory = directory(2);
  for (let i = 0; i < refDirectory.count; i++) {
    const start = refDirectory.offsets[i],
      end = refDirectory.offsets[i + 1] ?? refDirectory.end;
    range(bytes, start, 2, 'reference');
    const id = bytes.readUInt16LE(start);
    if (!objects[id] || references.has(id))
      throw new Error('IXO duplicate or invalid reference owner');
    references.set(id, bytes.subarray(start, end));
  }
  const bindings = new Map(),
    bindingDirectory = directory(1);
  for (let i = 0; i < bindingDirectory.count; i++) {
    const start = bindingDirectory.offsets[i],
      end = bindingDirectory.offsets[i + 1] ?? bindingDirectory.end;
    const id = bytes.readUInt32LE(start);
    bindings.set(id, { start, end, bytes: bytes.subarray(start, end) });
  }
  return { objects, references, bindings, chunks, types };
}

const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function multiply(a, b) {
  const c = Array(16).fill(0);
  for (let col = 0; col < 4; col++)
    for (let row = 0; row < 4; row++)
      for (let k = 0; k < 4; k++) c[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
  return c;
}
function localMatrix({ position: p, rotation: q, scale: s }) {
  const [x, y, z, w] = q,
    x2 = x + x,
    y2 = y + y,
    z2 = z + z,
    xx = x * x2,
    xy = x * y2,
    xz = x * z2,
    yy = y * y2,
    yz = y * z2,
    zz = z * z2,
    wx = w * x2,
    wy = w * y2,
    wz = w * z2;
  return [
    (1 - yy - zz) * s[0],
    (xy + wz) * s[0],
    (xz - wy) * s[0],
    0,
    (xy - wz) * s[1],
    (1 - xx - zz) * s[1],
    (yz + wx) * s[1],
    0,
    (xz + wy) * s[2],
    (yz - wx) * s[2],
    (1 - xx - yy) * s[2],
    0,
    ...p,
    1,
  ];
}
export function nativeSkeletonPose(bytes) {
  const { objects } = parseIxoGraph(bytes);
  return Object.fromEntries(
    objects
      .filter((o) => ['Skeleton', 'Locator'].includes(o.type) && !o.attributes)
      .map((o) => {
        const at = o.data + 6;
        range(bytes, at, 40, 'skeleton pose');
        const floats = Array.from({ length: 10 }, (_, i) => bytes.readFloatLE(at + i * 4));
        return [
          o.name,
          {
            position: floats.slice(0, 3),
            rotation: floats.slice(3, 7),
            scale: floats.slice(7, 10),
          },
        ];
      }),
  );
}

/** Equipment menu clips: 0 gun mode, 1 blade mode, 2 shield mode. */
export function nativeEquipmentPose(bytes, motionIndex = 1) {
  const { objects, references } = parseIxoGraph(bytes),
    motion = objects.filter((o) => o.type === 'Motion')[motionIndex],
    ref = references.get(motion?.id),
    pose = nativeSkeletonPose(bytes);
  if (!ref) throw new Error('IXO equipment preview clip missing');
  const count = ref.readUInt16LE(2);
  for (let i = 0; i < count; i++) {
    const set = objects[ref.readUInt16LE(4 + i * 2)];
    if (set?.type !== 'AnimSet') throw new Error('IXO preview track is not an AnimSet');
    const target = str(bytes, set.start + 2, set.end),
      channel = bytes[target.end],
      link = references.get(set.id),
      track = objects[link?.readUInt16LE(4)];
    if (!track) throw new Error('IXO missing preview animation');
    if (
      !pose[target.value] ||
      target.value === 'joint_Root' ||
      bytes.readUInt32LE(track.start + 4) !== 1
    )
      continue;
    if (!/^(VectorAnim|QuaternionAnim)(Constant|Linear|Slerp)(UT)?$/.test(track.type))
      throw new Error('IXO unsupported preview track');
    const at = track.start + 8 + (track.type.endsWith('UT') ? 0 : 4),
      value = Array.from({ length: 3 }, (_, c) => bytes.readFloatLE(at + c * 4));
    if (channel === 1) pose[target.value].position = value;
    else if (channel === 3) pose[target.value].scale = value;
    else if (channel === 2) {
      const [x, y, z] = value.map((v) => v / 2),
        c1 = Math.cos(x),
        c2 = Math.cos(y),
        c3 = Math.cos(z),
        s1 = Math.sin(x),
        s2 = Math.sin(y),
        s3 = Math.sin(z);
      pose[target.value].rotation = [
        s1 * c2 * c3 + c1 * s2 * s3,
        c1 * s2 * c3 - s1 * c2 * s3,
        c1 * c2 * s3 + s1 * s2 * c3,
        c1 * c2 * c3 - s1 * s2 * s3,
      ];
    } else throw new Error('IXO unknown preview channel');
  }
  delete pose.joint_Root;
  return pose;
}

export function parseIxo(bytes, { pose = null } = {}) {
  const { objects, references, bindings, types } = parseIxoGraph(bytes);
  const object = (id, type) => {
    const o = objects[id];
    if (!o || o.type !== type) throw new Error(`IXO expected ${type}, got ${o?.type}`);
    return o;
  };
  const buffers = new Map();
  for (const o of objects.filter((o) => o.type === 'VertexBuffer' || o.type === 'IndexBuffer')) {
    if (o.attributes) throw new Error('IXO buffer attributes unsupported');
    range(bytes, o.data, 8, 'buffer');
    const count = bytes.readUInt32LE(o.data),
      stride = o.type === 'VertexBuffer' ? bytes.readUInt16LE(o.data + 4) : 2;
    const dataEnd = o.data + 8 + count * stride;
    if (
      !count ||
      !stride ||
      stride > 256 ||
      dataEnd > o.end ||
      o.end - dataEnd > 3 ||
      !bytes.subarray(dataEnd, o.end).every((v) => v === 0)
    )
      throw new Error(`IXO invalid buffer length: ${o.name}`);
    if (
      o.type === 'IndexBuffer' &&
      (bytes.readUInt16LE(o.data + 4) !== 0 || bytes.readUInt16LE(o.data + 6) !== 1)
    )
      throw new Error('IXO unsupported index format');
    buffers.set(o.id, { count, stride, data: bytes.subarray(o.data + 8, dataEnd) });
  }
  const meshes = [],
    materials = new Map();
  const nativePose = pose ? nativeSkeletonPose(bytes) : null,
    worldCache = new Map();
  function world(id) {
    if (worldCache.has(id)) return worldCache.get(id);
    const o = objects[id],
      base = nativePose?.[o.name];
    if (!base) return identity();
    const binding = bindings.get(id)?.bytes,
      name = Buffer.from('parentMatrix\0');
    const property = binding?.indexOf(name) ?? -1;
    const parent = property < 0 ? 0 : binding.readUInt32LE((property + name.length + 3) & ~3);
    const matrix = multiply(
      parent && parent !== id ? world(parent) : identity(),
      localMatrix(pose[o.name] ?? base),
    );
    worldCache.set(id, matrix);
    return matrix;
  }
  for (const mesh of objects.filter((o) => o.type === 'SkinnedMesh')) {
    const meshRef = references.get(mesh.id);
    if (!meshRef) continue;
    const groups = meshRef.readUInt16LE(2);
    const skinMatrices = [];
    if (pose) {
      const inverseObject = object(meshRef.readUInt16LE(4 + groups * 2), 'MatrixBuffer'),
        count = bytes.readUInt32LE(inverseObject.data);
      const binding = bindings.get(mesh.id)?.bytes;
      if (!binding || binding.readUInt32LE(4) !== count)
        throw new Error('IXO skin joint bindings mismatch');
      let at = 8;
      for (let i = 0; i < count; i++) {
        const slot = str(binding, at);
        at = (slot.end + 3) & ~3;
        if (slot.value !== `jointMember${i}`) throw new Error('IXO unordered skin joints');
        const joint = binding.readUInt32LE(at);
        at += 4;
        const property = str(binding, at);
        at = (property.end + 3) & ~3;
        if (property.value !== 'worldMatrix') throw new Error('IXO joint without world matrix');
        const inverse = Array.from({ length: 16 }, (_, c) =>
          bytes.readFloatLE(inverseObject.data + 4 + i * 64 + c * 4),
        );
        skinMatrices.push(multiply(world(joint), inverse));
      }
    }
    for (let g = 0; g < groups; g++) {
      const group = objects[meshRef.readUInt16LE(4 + g * 2)];
      if (!['CgfxSG', 'CgfxObject'].includes(group?.type))
        throw new Error('IXO unsupported shading group');
      const groupRef = references.get(group.id),
        count = groupRef?.readUInt16LE(2) ?? 0;
      if (!count) continue;
      const materialId = groupRef.readUInt16LE(4 + count * 2),
        material = object(materialId, 'UserMaterial');
      const materialRef = references.get(materialId),
        textureCount = materialRef?.readUInt16LE(2) ?? 0;
      const textures = [];
      for (let t = 0; t < textureCount; t++) {
        const tex = object(materialRef.readUInt16LE(4 + t * 2), 'FileTexture');
        textures.push(str(bytes, tex.data, tex.end).value);
      }
      if (!textures.length) throw new Error('IXO material without native textures');
      materials.set(materialId, { id: materialId, name: material.name, textures });
      for (let p = 0; p < count; p++) {
        const primitive = objects[groupRef.readUInt16LE(4 + p * 2)];
        if (!['Geometry', 'Primitive'].includes(primitive?.type) || primitive.attributes)
          throw new Error('IXO unsupported primitive');
        const topology = bytes.readUInt16LE(primitive.data),
          first = bytes.readUInt16LE(primitive.data + 2),
          triangles = bytes.readUInt32LE(primitive.data + 4);
        if (topology !== 3 || !triangles) throw new Error('IXO expected triangle list');
        const ref = references.get(primitive.id),
          index = buffers.get(ref.readUInt16LE(2)),
          streams = [];
        if (!index || first + triangles * 3 > index.count)
          throw new Error('IXO triangle range exceeds index buffer');
        const streamCount = bytes.readUInt16LE(mesh.end - 4);
        let streamAt = 4;
        for (let s = 0; s < streamCount; s++) {
          const variants = ref.readUInt16LE(streamAt);
          if (!variants || variants > 32 || streamAt + 2 + variants * 2 > ref.length)
            throw new Error('IXO invalid stream variants');
          const buffer = buffers.get(ref.readUInt16LE(streamAt + 2));
          if (!buffer) throw new Error('IXO missing vertex stream');
          streams.push(buffer);
          streamAt += 2 + variants * 2;
        }
        const [position, uv, color, skin] = streams;
        if (
          position?.stride !== 24 ||
          ![8, 32].includes(uv?.stride) ||
          color?.stride !== 4 ||
          position.count !== uv.count ||
          position.count !== color.count
        )
          throw new Error(
            `IXO unsupported vertex declaration (${mesh.name}: ${streams.map((s) => s.count + 'x' + s.stride).join(', ')})`,
          );
        const indices = [],
          positions = [],
          normals = [],
          uvs = [],
          colors = [];
        for (let i = 0; i < position.count; i++) {
          const xyz = Array.from({ length: 3 }, (_, c) =>
              position.data.readFloatLE(i * position.stride + c * 4),
            ),
            n = Array.from({ length: 3 }, (_, c) =>
              position.data.readFloatLE(i * position.stride + 12 + c * 4),
            );
          if (pose) {
            if (skin?.stride !== 20) throw new Error('IXO unsupported skin stream');
            const p = [0, 0, 0],
              normal = [0, 0, 0];
            let total = 0;
            for (let s = 0; s < 4; s++) {
              const weight = skin.data.readFloatLE(i * 20 + s * 4);
              if (!weight) continue;
              const bone = skin.data[i * 20 + 16 + s],
                matrix = skinMatrices[bone];
              if (!matrix) throw new Error('IXO invalid bone index');
              total += weight;
              for (let c = 0; c < 3; c++) {
                p[c] +=
                  weight *
                  (matrix[c] * xyz[0] +
                    matrix[c + 4] * xyz[1] +
                    matrix[c + 8] * xyz[2] +
                    matrix[c + 12]);
                normal[c] +=
                  weight * (matrix[c] * n[0] + matrix[c + 4] * n[1] + matrix[c + 8] * n[2]);
              }
            }
            if (Math.abs(total - 1) > 0.01) throw new Error('IXO skin weights do not sum to one');
            positions.push(...p);
            normals.push(...normal);
          } else {
            positions.push(...xyz);
            normals.push(...n);
          }
          uvs.push(uv.data.readFloatLE(i * uv.stride), uv.data.readFloatLE(i * uv.stride + 4));
          // D3DCOLOR bytes are BGRA.
          colors.push(
            color.data[i * 4 + 2] / 255,
            color.data[i * 4 + 1] / 255,
            color.data[i * 4] / 255,
            color.data[i * 4 + 3] / 255,
          );
        }
        for (let i = first; i < first + triangles * 3; i++) {
          const v = index.data.readUInt16LE(i * 2);
          if (v >= position.count) throw new Error('IXO index exceeds vertex count');
          indices.push(v);
        }
        if (![...positions, ...normals, ...uvs].every(Number.isFinite))
          throw new Error('IXO non-finite vertex');
        meshes.push({
          name: mesh.name,
          group: group.name,
          material: materialId,
          positions,
          normals,
          uvs,
          colors,
          indices,
        });
      }
    }
  }
  if (!meshes.length) throw new Error('IXO has no supported meshes');
  return { meshes, materials: [...materials.values()], objects: objects.length, types };
}

/** Each native resource reference is a self-contained 512-byte record. */
export function equipmentModelReference(bytes, index, part) {
  const at = index * 512;
  range(bytes, at, 512, 'equipment reference');
  if (bytes.readUInt32LE(at) !== 0xb0000020 || bytes.readUInt32LE(at + 12) !== 4)
    throw new Error('Invalid native equipment resource reference');
  const path = str(bytes, at + 32, at + 128).value;
  if (
    !path.startsWith(`bin/resconv_pc/data/GameData/player/Weapon/Part/${part}/`) ||
    !path.endsWith(`/${part}.res`)
  )
    throw new Error('Equipment resource reference has wrong part');
  return path;
}
