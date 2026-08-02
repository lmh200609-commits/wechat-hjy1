const TYPES = Object.freeze({
  JPEG: { mimeType: "image/jpeg", extension: "jpg" },
  PNG: { mimeType: "image/png", extension: "png" },
  WEBP: { mimeType: "image/webp", extension: "webp" },
});

function png(buffer) {
  if (buffer.length < 24 || buffer.toString("hex", 0, 8) !== "89504e470d0a1a0a") return null;
  return { ...TYPES.PNG, width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function jpeg(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + length + 2 > buffer.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { ...TYPES.JPEG, height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += length + 2;
  }
  return null;
}

function webp(buffer) {
  if (buffer.length < 30 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") return null;
  const format = buffer.toString("ascii", 12, 16);
  if (format === "VP8X") {
    return {
      ...TYPES.WEBP,
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }
  if (format === "VP8L" && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21);
    return { ...TYPES.WEBP, width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (format === "VP8 " && buffer.length >= 30 && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
    return { ...TYPES.WEBP, width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

function inspectImage(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  return png(buffer) || jpeg(buffer) || webp(buffer);
}

module.exports = { inspectImage };
