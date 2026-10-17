// Renders public/app-icon.svg into every desktop icon the packager and the
// window use: build/icon.ico (Windows), build/icon.icns + build/icon.iconset
// (macOS), build/icon.svg + build/icon-1024.png (Linux) and the window/tray
// icon in electron/resources/app-icon.png.
import { Resvg } from "@resvg/resvg-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "public/app-icon.svg"), "utf8");

// Apple's icon grid draws the tile at 824/1024 of the canvas; a full-bleed
// tile looks oversized beside every other Dock icon.
const macSource = source
  .replace(/(<svg[^>]*>)/, `$1<g transform="translate(100 100) scale(0.8046875)">`)
  .replace(/<\/svg>\s*$/, "</g></svg>\n");

function png(svg, size) {
  return new Resvg(svg, { fitTo: { mode: "width", value: size } }).render();
}

// A 32-bit DIB entry (BITMAPINFOHEADER + bottom-up BGRA + AND mask): NSIS
// refuses PNG-compressed entries in installer icons.
function dibEntry(svg, size) {
  const image = png(svg, size);
  const rgba = image.pixels;
  const maskRow = Math.ceil(size / 32) * 4;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(size * size * 4 + maskRow * size, 20);
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const from = ((size - 1 - y) * size + x) * 4;
      const to = (y * size + x) * 4;
      pixels[to] = rgba[from + 2];
      pixels[to + 1] = rgba[from + 1];
      pixels[to + 2] = rgba[from];
      pixels[to + 3] = rgba[from + 3];
    }
  }
  return Buffer.concat([header, pixels, Buffer.alloc(maskRow * size)]);
}

function ico(svg, sizes) {
  const entries = sizes.map((size) => ({ size, data: dibEntry(svg, size) }));
  const directory = Buffer.alloc(6 + 16 * entries.length);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(entries.length, 4);
  let offset = directory.length;
  entries.forEach(({ size, data }, index) => {
    const at = 6 + 16 * index;
    directory[at] = size >= 256 ? 0 : size;
    directory[at + 1] = size >= 256 ? 0 : size;
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([directory, ...entries.map(({ data }) => data)]);
}

const ICNS_TYPES = [
  ["icp4", 16], ["icp5", 32], ["icp6", 64], ["ic07", 128], ["ic08", 256], ["ic09", 512],
  ["ic10", 1024], ["ic11", 32], ["ic12", 64], ["ic13", 256], ["ic14", 1024],
];

function icns(svg) {
  const chunks = ICNS_TYPES.map(([type, size]) => {
    const data = png(svg, size).asPng();
    const head = Buffer.alloc(8);
    head.write(type, 0, "ascii");
    head.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([head, data]);
  });
  const head = Buffer.alloc(8);
  head.write("icns", 0, "ascii");
  head.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
  return Buffer.concat([head, ...chunks]);
}

const ICONSET = [
  ["icon_16x16.png", 16], ["icon_16x16@2x.png", 32], ["icon_32x32.png", 32], ["icon_32x32@2x.png", 64],
  ["icon_64x64.png", 64], ["icon_64x64@2x.png", 128], ["icon_128x128.png", 128], ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256], ["icon_256x256@2x.png", 512], ["icon_512x512.png", 512], ["icon_512x512@2x.png", 1024],
];

function write(relative, data) {
  const file = join(root, relative);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
  console.log(`${relative} (${data.length} bytes)`);
}

write("build/icon.ico", ico(source, [256, 128, 64, 48, 32, 24, 16]));
write("build/icon.icns", icns(macSource));
for (const [name, size] of ICONSET) write(join("build/icon.iconset", name), png(macSource, size).asPng());
write("build/icon.svg", source);
write("build/icon-1024.png", png(source, 1024).asPng());
write("electron/resources/app-icon.png", png(source, 1024).asPng());
