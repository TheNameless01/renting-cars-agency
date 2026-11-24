import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makePngChunk(type, data) {
  const len = Buffer.allocUnsafe(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function renderIconRgba(size) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.44;
  const corner = size * 0.18;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = Math.abs(x + 0.5 - cx);
      const dy = Math.abs(y + 0.5 - cy);
      const innerX = Math.max(0, dx - (radius - corner));
      const innerY = Math.max(0, dy - (radius - corner));
      const dist = Math.hypot(innerX, innerY);

      if (dist > corner) {
        buf[idx] = 0;
        buf[idx + 1] = 0;
        buf[idx + 2] = 0;
        buf[idx + 3] = 0;
        continue;
      }

      // Deep navy gradient (#0F274A -> #1E3A8A)
      const t = (x + y) / (2 * size);
      let r = Math.round(15 + t * 18);
      let g = Math.round(39 + t * 32);
      let b = Math.round(74 + t * 68);

      // Clean inner border accent
      if (dist > corner - Math.max(1.2, size * 0.025)) {
        r = 56;
        g = 189;
        b = 248;
      }

      // Crisp centered geometric car silhouette + key arch in white/amber
      const nx = (x + 0.5 - cx) / size;
      const ny = (y + 0.5 - cy) / size;

      // Stylized car body & roof
      const inCabin = ny >= -0.18 && ny <= -0.02 && Math.abs(nx) <= 0.18 - (ny + 0.18) * -0.45;
      const inHull = ny > -0.02 && ny <= 0.13 && Math.abs(nx) <= 0.28;
      const leftWheel = Math.hypot(nx + 0.16, ny - 0.14) <= 0.065;
      const rightWheel = Math.hypot(nx - 0.16, ny - 0.14) <= 0.065;

      if (leftWheel || rightWheel) {
        r = 250;
        g = 204;
        b = 21;
      } else if (inCabin || inHull) {
        r = 248;
        g = 250;
        b = 252;
      }

      buf[idx] = r;
      buf[idx + 1] = g;
      buf[idx + 2] = b;
      buf[idx + 3] = 255;
    }
  }
  return buf;
}

function encodePng(size) {
  const rgba = renderIconRgba(size);
  const rawRows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    rawRows[rowStart] = 0; // filter None
    rgba.copy(rawRows, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', zlib.deflateSync(rawRows)),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function encodeIco(pngImages) {
  // ICONDIR (6 bytes) + N * ICONDIRENTRY (16 bytes)
  const header = Buffer.alloc(6 + pngImages.length * 16);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = 1 (ICO)
  header.writeUInt16LE(pngImages.length, 4);

  let offset = header.length;
  for (let i = 0; i < pngImages.length; i++) {
    const { size, buf } = pngImages[i];
    const entryOffset = 6 + i * 16;
    header[entryOffset] = size === 256 ? 0 : size;
    header[entryOffset + 1] = size === 256 ? 0 : size;
    header[entryOffset + 2] = 0;
    header[entryOffset + 3] = 0;
    header.writeUInt16LE(1, entryOffset + 4);
    header.writeUInt16LE(32, entryOffset + 6);
    header.writeUInt32LE(buf.length, entryOffset + 8);
    header.writeUInt32LE(offset, entryOffset + 12);
    offset += buf.length;
  }

  return Buffer.concat([header, ...pngImages.map((img) => img.buf)]);
}

const buildDir = path.resolve('build');
fs.mkdirSync(buildDir, { recursive: true });

const sizes = [16, 32, 48, 256];
const pngImages = sizes.map((size) => ({ size, buf: encodePng(size) }));
const icoBuf = encodeIco(pngImages);

fs.writeFileSync(path.join(buildDir, 'icon.png'), pngImages[pngImages.length - 1].buf);
fs.writeFileSync(path.join(buildDir, 'icon.ico'), icoBuf);

console.log('[generate-icons] Generated build/icon.png (256x256) and build/icon.ico (16,32,48,256)');
