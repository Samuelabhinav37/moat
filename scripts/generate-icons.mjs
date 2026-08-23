// Renders the toolbar icon (a slashed circle, like a "no ads" sign) at each
// required size with no external image dependencies -- just a hand-rolled
// PNG encoder over a supersampled raster.
import { deflateSync, crc32 } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "icons");
mkdirSync(outDir, { recursive: true });

const BG = [31, 34, 36, 255]; // matches --bg
const FG = [95, 184, 150, 255]; // matches --accent

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput) >>> 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw);

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function renderIcon(size) {
  const supersample = 4;
  const n = size * supersample;
  const pixels = new Uint8ClampedArray(n * n * 4);

  const cx = n / 2;
  const cy = n / 2;
  const outerR = n * 0.42;
  const ringWidth = n * 0.1;
  const slashWidth = n * 0.09;

  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.hypot(dx, dy);

      const onRing = dist > outerR - ringWidth && dist <= outerR;
      // Diagonal slash from top-left to bottom-right of the circle,
      // masked to the circle interior -- the universal "blocked" glyph.
      const distToSlash = Math.abs(dx - dy) / Math.SQRT2;
      const onSlash = distToSlash < slashWidth / 2 && dist < outerR - ringWidth * 0.15;

      const color = onRing || onSlash ? FG : BG;
      const idx = (y * n + x) * 4;
      pixels[idx] = color[0];
      pixels[idx + 1] = color[1];
      pixels[idx + 2] = color[2];
      pixels[idx + 3] = color[3];
    }
  }

  // Downsample by averaging each supersample x supersample block.
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < supersample; sy += 1) {
        for (let sx = 0; sx < supersample; sx += 1) {
          const idx = ((y * supersample + sy) * n + (x * supersample + sx)) * 4;
          r += pixels[idx];
          g += pixels[idx + 1];
          b += pixels[idx + 2];
          a += pixels[idx + 3];
        }
      }
      const count = supersample * supersample;
      const outIdx = (y * size + x) * 4;
      out[outIdx] = Math.round(r / count);
      out[outIdx + 1] = Math.round(g / count);
      out[outIdx + 2] = Math.round(b / count);
      out[outIdx + 3] = Math.round(a / count);
    }
  }

  return out;
}

for (const size of [16, 32, 48, 128]) {
  const rgba = renderIcon(size);
  const png = encodePng(size, size, rgba);
  writeFileSync(join(outDir, `icon${size}.png`), png);
  console.log(`icons/icon${size}.png`);
}
