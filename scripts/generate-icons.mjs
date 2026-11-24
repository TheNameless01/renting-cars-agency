import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';

function renderSvgToPng(svgText, size) {
  const resvg = new Resvg(svgText, {
    fitTo: {
      mode: 'width',
      value: size,
    },
    background: 'rgba(0, 0, 0, 0)',
  });
  const rendered = resvg.render();
  return Buffer.from(rendered.asPng());
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
    header[entryOffset] = size >= 256 ? 0 : size;
    header[entryOffset + 1] = size >= 256 ? 0 : size;
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
const svgPath = path.join(buildDir, 'icon.svg');

if (!fs.existsSync(svgPath)) {
  throw new Error(`Missing source icon SVG at ${svgPath}`);
}

const svgText = fs.readFileSync(svgPath, 'utf8');
fs.mkdirSync(buildDir, { recursive: true });

const icoSizes = [16, 32, 48, 64, 128, 256];
const icoImages = icoSizes.map((size) => ({ size, buf: renderSvgToPng(svgText, size) }));
const icoBuf = encodeIco(icoImages);
const png512 = renderSvgToPng(svgText, 512);

fs.writeFileSync(path.join(buildDir, 'icon.png'), png512);
fs.writeFileSync(path.join(buildDir, 'icon.ico'), icoBuf);

const publicDir = path.resolve('public');
if (fs.existsSync(publicDir)) {
  fs.copyFileSync(svgPath, path.join(publicDir, 'icon.svg'));
}

console.log(
  '[generate-icons] Rasterized build/icon.svg -> build/icon.png (512x512) & build/icon.ico (16,32,48,64,128,256)'
);
