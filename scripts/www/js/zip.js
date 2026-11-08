// 纯本地免依赖 ZIP 打包引擎 (STORE 模式)
const ZipEngine = (() => {
  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[i] = c >>> 0;
  }

  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
      crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 0xFF];
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  async function createZipBlob(items) {
    const parts = [];
    const centralDir = [];
    let offset = 0;
    const encoder = new TextEncoder();

    for (const item of items) {
      const nameBytes = encoder.encode(item.name);
      const buffer = await item.file.arrayBuffer();
      const dataBytes = new Uint8Array(buffer);
      const crc = crc32(dataBytes);
      const size = dataBytes.length;

      const localHeader = new ArrayBuffer(30);
      const lv = new DataView(localHeader);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, 0, true);
      lv.setUint16(10, 0, true);
      lv.setUint16(12, 0, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, size, true);
      lv.setUint32(22, size, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);

      parts.push(new Uint8Array(localHeader), nameBytes, item.file);

      const cdHeader = new ArrayBuffer(46);
      const cv = new DataView(cdHeader);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, size, true);
      cv.setUint32(24, size, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);

      centralDir.push(new Uint8Array(cdHeader), nameBytes);
      offset += 30 + nameBytes.length + size;
    }

    const cdStart = offset;
    let cdSize = 0;
    for (const part of centralDir) {
      parts.push(part);
      cdSize += part.byteLength;
    }

    const eocd = new ArrayBuffer(22);
    const ev = new DataView(eocd);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, items.length, true);
    ev.setUint16(10, items.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, cdStart, true);
    ev.setUint16(20, 0, true);

    parts.push(new Uint8Array(eocd));
    return new Blob(parts, { type: 'application/zip' });
  }

  return { createZipBlob };
})();