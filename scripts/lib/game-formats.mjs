import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';

const utf8 = new TextDecoder('utf-8', { fatal: true });
const digest = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');
export const sha256 = (bytes) => digest('sha256', bytes);

function bounds(bytes, offset, length, label) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > bytes.length
  )
    throw new Error(`${label}: out-of-bounds range ${offset}+${length}/${bytes.length}`);
}

function cstring(bytes, offset, maximum = bytes.length - offset) {
  bounds(bytes, offset, maximum, 'string');
  const end = bytes.indexOf(0, offset);
  if (end < offset || end >= offset + maximum) throw new Error('Unterminated string');
  return utf8.decode(bytes.subarray(offset, end));
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = BigInt(value);
  for (let bit = 0; bit < 8; bit++) crc = (crc >> 1n) ^ (crc & 1n ? 0x95ac9329ac4bc9b5n : 0n);
  return crc;
});

export function gamePathHash(resourcePath) {
  const normalized = resourcePath.replaceAll('\\', '/').replace(/^\/+/, '').toUpperCase();
  if (/[^\x20-\x7e]/.test(normalized)) throw new Error('Resource path must be ASCII');
  let crc = 0xffffffffffffffffn;
  for (const byte of Buffer.from(normalized, 'ascii'))
    crc = (crc >> 8n) ^ crcTable[Number((crc ^ BigInt(byte)) & 255n)];
  return crc.toString(16).padStart(16, '0');
}

export async function openQpck(file) {
  const handle = await open(file, 'r');
  try {
    const stat = await handle.stat();
    async function read(offset, size) {
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        size < 0 ||
        offset + size > stat.size ||
        size > 256 * 1024 * 1024
      )
        throw new Error(`${file}: invalid read range`);
      const bytes = Buffer.alloc(size);
      let done = 0;
      while (done < size) {
        const { bytesRead } = await handle.read(bytes, done, size - done, offset + done);
        if (!bytesRead) throw new Error(`${file}: short read`);
        done += bytesRead;
      }
      return bytes;
    }
    const header = await read(0, 8);
    if (header.readUInt32LE(0) !== 0x37402858) throw new Error(`${file}: not a QPCK archive`);
    const count = header.readUInt32LE(4);
    if (count > 2_000_000 || 8 + count * 20 > stat.size)
      throw new Error(`${file}: invalid directory size`);
    const index = await read(8, count * 20);
    const entries = new Map();
    for (let i = 0; i < count; i++) {
      const at = i * 20;
      const offset = Number(index.readBigUInt64LE(at));
      const hash = index
        .readBigUInt64LE(at + 8)
        .toString(16)
        .padStart(16, '0');
      const size = index.readUInt32LE(at + 16);
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset + size > stat.size ||
        (size && offset < 8 + index.length)
      )
        throw new Error(`${file}: invalid entry ${i}`);
      if (entries.has(hash)) throw new Error(`${file}: duplicate resource hash ${hash}`);
      entries.set(hash, { hash, offset, size });
    }
    return {
      entries,
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      index_sha256: sha256(index),
      read,
      close: () => handle.close(),
    };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export function decompressBlz4(bytes) {
  bounds(bytes, 0, 32, 'BLZ4 header');
  if (bytes.subarray(0, 4).toString() !== 'blz4') throw new Error('Not a BLZ4 resource');
  const expectedSize = bytes.readUInt32LE(4);
  if (expectedSize > 128 * 1024 * 1024) throw new Error('BLZ4 output exceeds table size limit');
  const expectedMd5 = bytes.subarray(16, 32).toString('hex');
  const parts = [];
  let outputSize = 0;
  for (let offset = 32; offset < bytes.length;) {
    bounds(bytes, offset, 2, 'BLZ4 chunk header');
    const size = bytes.readUInt16LE(offset);
    offset += 2;
    if (!size && bytes.subarray(offset).every((b) => b === 0)) break;
    if (!size) throw new Error('Empty BLZ4 chunk');
    bounds(bytes, offset, size, 'BLZ4 chunk');
    const part = inflateSync(bytes.subarray(offset, offset + size), {
      maxOutputLength: Math.max(1, expectedSize - outputSize),
    });
    outputSize += part.length;
    if (outputSize > expectedSize) throw new Error('BLZ4 output size mismatch');
    parts.push(part);
    offset += size;
  }
  if (!parts.length || outputSize !== expectedSize) throw new Error('BLZ4 output size mismatch');
  for (const [order, chunks] of [
    ['rotate_first_to_end', [...parts.slice(1), parts[0]]],
    ['physical', parts],
  ]) {
    const result = Buffer.concat(chunks);
    if (digest('md5', result) === expectedMd5)
      return { bytes: result, md5: expectedMd5, chunk_order: order, chunks: parts.length };
  }
  throw new Error('BLZ4 MD5 mismatch; unsupported chunk order or corrupt input');
}

export function parsePres(bytes) {
  bounds(bytes, 0, 32, 'PRES header');
  if (bytes.subarray(0, 4).toString() !== 'Pres') throw new Error('Not a PRES resource');
  const sets = bytes.readUInt32LE(28);
  if (sets > 32) throw new Error('Unsupported PRES set count');
  const result = [];
  for (let set = 0; set < Math.max(1, sets); set++) {
    const directory =
      sets <= 1
        ? 32
        : (bounds(bytes, 32 + set * 8, 8, 'PRES set'), bytes.readUInt32LE(32 + set * 8));
    bounds(bytes, directory, 64, 'PRES directory');
    for (let pair = 0; pair < 8; pair++) {
      const start = bytes.readUInt32LE(directory + pair * 8),
        count = bytes.readUInt32LE(directory + pair * 8 + 4);
      bounds(bytes, start, count * 32, 'PRES entries');
      for (let i = 0; i < count; i++) {
        const at = start + i * 32,
          packed = bytes.readUInt32LE(at),
          type = packed >>> 28,
          address = packed & 0x0fffffff;
        const pointer = bytes.readUInt32LE(at + 8),
          nameCount = bytes.readUInt32LE(at + 12);
        if (nameCount > 64) throw new Error('Unsupported PRES name count');
        bounds(bytes, pointer, nameCount * 4, 'PRES names');
        const names = Array.from({ length: nameCount }, (_, n) =>
          cstring(bytes, bytes.readUInt32LE(pointer + n * 4)),
        );
        const rawSize = bytes.readUInt32LE(at + 4);
        result.push({
          set,
          pair,
          type,
          address,
          size: rawSize * (pair === 5 ? 4 : 1),
          names,
          path: names[3] ?? null,
          ref: type === 11 ? cstring(bytes, address) : null,
        });
      }
    }
  }
  return result;
}

export function parseKst(bytes) {
  bounds(bytes, 0, 24, 'KST header');
  if (bytes.subarray(0, 4).toString() !== 'kst1') throw new Error('Not a KST table');
  const stride = bytes.readUInt32LE(8),
    count = bytes.readUInt32LE(12),
    index = bytes.readUInt32LE(16),
    records = bytes.readUInt32LE(20);
  if (!stride || stride > 4096) throw new Error('Invalid KST stride');
  bounds(bytes, records, count * stride, 'KST records');
  bounds(bytes, index, 8, 'KST index header');
  const blocks = bytes.readUInt32LE(index),
    maxKey = bytes.readUInt32LE(index + 4);
  bounds(bytes, index + 8, blocks * 36, 'KST index');
  const rows = [];
  for (let block = 0; block < blocks; block++) {
    const at = index + 8 + block * 36,
      base = bytes.readUInt32LE(at);
    let ordinal = base;
    for (let bit = 0; bit < 256; bit++) {
      if (!(bytes.readUInt32LE(at + 4 + Math.floor(bit / 32) * 4) & (0x80000000 >>> (bit % 32))))
        continue;
      const key = block * 256 + bit;
      if (ordinal !== rows.length || ordinal >= count || key > maxKey)
        throw new Error('KST bitmap/key mismatch');
      const offset = records + ordinal * stride;
      rows.push({ key, index: ordinal, offset, bytes: bytes.subarray(offset, offset + stride) });
      ordinal++;
    }
  }
  if (rows.length !== count) throw new Error('KST record count mismatch');
  return { stride, count, maxKey, rows, record_end: records + count * stride };
}

export function kstString(bytes, pointer, minimum = 0) {
  if (pointer < minimum) throw new Error('KST string points into records');
  bounds(bytes, pointer, 2, 'KST string length');
  const length = bytes.readUInt16LE(pointer);
  bounds(bytes, pointer + 2, length, 'KST string');
  if (!length || bytes[pointer + 2 + length - 1] !== 0)
    throw new Error('Invalid KST string terminator');
  return utf8.decode(bytes.subarray(pointer + 2, pointer + 2 + length - 1));
}

const numericTypes = {
  UINT8: [1, 'readUInt8'],
  INT8: [1, 'readInt8'],
  UINT16: [2, 'readUInt16LE'],
  INT16: [2, 'readInt16LE'],
  UINT32: [4, 'readUInt32LE'],
  INT32: [4, 'readInt32LE'],
  FLOAT32: [4, 'readFloatLE'],
};

export function parseTr2(bytes, { selectedFields = null } = {}) {
  bounds(bytes, 0, 64, 'TR2 header');
  if (bytes.subarray(0, 4).toString() !== '.tr2') throw new Error('Not a TR2 table');
  const name = cstring(bytes, 8, 48),
    start = bytes.readUInt32LE(56),
    columns = bytes.readUInt32LE(60);
  bounds(bytes, start, columns * 20 + 4, 'TR2 field directory');
  const idsAt = start + columns * 20,
    count = bytes.readUInt32LE(idsAt);
  bounds(bytes, idsAt + 4, count * 4, 'TR2 primary keys');
  const rows = Array.from({ length: count }, (_, i) => ({
    id: bytes.readUInt32LE(idsAt + 4 + i * 4),
  }));
  if (new Set(rows.map((r) => r.id)).size !== count) throw new Error('Duplicate TR2 primary key');
  const fields = [];
  for (let c = 0; c < columns; c++) {
    const meta = bytes.readUInt32LE(start + c * 20 + 4);
    bounds(bytes, meta, 128 + (count + 1) * 4, 'TR2 column metadata');
    const field = cstring(bytes, meta, 60),
      type = cstring(bytes, meta + 64, 16),
      max = bytes.readUInt16LE(meta + 118);
    if (bytes.readUInt32LE(meta + 124) !== count)
      throw new Error(`TR2 ${field}: unsupported sparse/default column`);
    if (fields.some((f) => f.name === field)) throw new Error('Duplicate TR2 column name');
    fields.push({ name: field, type, max });
    for (let r = 0; r < count; r++) {
      const lo = meta + bytes.readUInt32LE(meta + 128 + r * 4),
        hi = meta + bytes.readUInt32LE(meta + 132 + r * 4);
      bounds(bytes, lo, hi - lo, `TR2 ${field} cell`);
      if (selectedFields && !selectedFields.includes(field)) continue;
      let value;
      if (numericTypes[type]) {
        const [width, reader] = numericTypes[type];
        if ((hi - lo) % width || (hi - lo) / width > max)
          throw new Error(`TR2 ${field}: invalid cell width`);
        value = Array.from({ length: (hi - lo) / width }, (_, i) => bytes[reader](lo + i * width));
        if (max === 1) value = value[0] ?? null;
      } else if (type === 'UTF-8' || type === 'ASCII')
        value = hi === lo ? '' : cstring(bytes, lo, hi - lo);
      else if (type === 'UTF-16LE')
        value = bytes.subarray(lo, hi).toString('utf16le').replace(/\0.*$/s, '');
      else throw new Error(`Unsupported TR2 type ${type}`);
      rows[r][field] = value;
    }
  }
  if (selectedFields?.some((field) => !fields.some((f) => f.name === field)))
    throw new Error('Selected TR2 field is missing');
  return { name, fields, rows };
}
