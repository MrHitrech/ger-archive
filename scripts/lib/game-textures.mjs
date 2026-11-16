/** PC GER keeps its GNF names, but stores length-prefixed DDS textures inside. */
export function ddsInfo(bytes, { headerOnly = false } = {}) {
  if (
    bytes.length < 128 ||
    bytes.toString('ascii', 0, 4) !== 'DDS ' ||
    bytes.readUInt32LE(4) !== 124 ||
    bytes.readUInt32LE(76) !== 32
  )
    throw new Error('Invalid DDS header');
  const height = bytes.readUInt32LE(12),
    width = bytes.readUInt32LE(16),
    mip_count = bytes.readUInt32LE(28) || 1,
    fourcc = bytes.toString('ascii', 84, 88);
  if (
    !width ||
    !height ||
    width > 16384 ||
    height > 16384 ||
    mip_count > Math.floor(Math.log2(Math.max(width, height))) + 1 ||
    !['DXT1', 'DXT3', 'DXT5'].includes(fourcc)
  )
    throw new Error('Unsupported DDS layout');
  let size = 128;
  for (let i = 0; i < mip_count; i++)
    size +=
      Math.ceil(Math.max(1, width >> i) / 4) *
      Math.ceil(Math.max(1, height >> i) / 4) *
      (fourcc === 'DXT1' ? 8 : 16);
  if (!headerOnly && bytes.length !== size)
    throw new Error('DDS payload length differs from mip layout');
  return {
    width,
    height,
    mip_count,
    fourcc,
    size,
    header_hex: bytes.subarray(0, 128).toString('hex'),
  };
}

export function parseTextureSet(bytes) {
  if (bytes.length < 8) throw new Error('Truncated texture set');
  const count = bytes.readUInt32LE(0);
  if (!count || count > 256 || 4 + count * 4 > bytes.length)
    throw new Error('Invalid texture count');
  const textures = [];
  let offset = 4 + count * 4;
  for (let index = 0; index < count; index++) {
    const size = bytes.readUInt32LE(4 + index * 4);
    if (size < 128 || offset + size > bytes.length)
      throw new Error('Texture set range outside container');
    const texture = bytes.subarray(offset, offset + size);
    textures.push({ index, offset, ...ddsInfo(texture), bytes: texture });
    offset += size;
  }
  if (offset !== bytes.length) throw new Error('Unexpected bytes after texture set');
  return textures;
}

export function webpDimensions(bytes) {
  if (
    bytes.length < 20 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WEBP' ||
    bytes.readUInt32LE(4) + 8 !== bytes.length
  )
    throw new Error('Invalid WebP container');
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const type = bytes.toString('ascii', offset, offset + 4),
      size = bytes.readUInt32LE(offset + 4),
      start = offset + 8;
    if (start + size > bytes.length) throw new Error('Truncated WebP chunk');
    if (type === 'VP8X' && size >= 10)
      return {
        width: 1 + bytes.readUIntLE(start + 4, 3),
        height: 1 + bytes.readUIntLE(start + 7, 3),
      };
    if (type === 'VP8L' && size >= 5 && bytes[start] === 0x2f) {
      const value = bytes.readUInt32LE(start + 1);
      return { width: 1 + (value & 0x3fff), height: 1 + ((value >>> 14) & 0x3fff) };
    }
    if (
      type === 'VP8 ' &&
      size >= 10 &&
      bytes.subarray(start + 3, start + 6).equals(Buffer.from([0x9d, 1, 0x2a]))
    )
      return {
        width: bytes.readUInt16LE(start + 6) & 0x3fff,
        height: bytes.readUInt16LE(start + 8) & 0x3fff,
      };
    offset = start + size + (size & 1);
  }
  throw new Error('WebP dimensions not found');
}
