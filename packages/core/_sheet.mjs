import sharp from "sharp";
import { readdirSync } from "node:fs";
const [,, pattern, out, colsArg, cellW] = process.argv;
const files = readdirSync("/tmp/stprev").filter(f => f.endsWith(".svg") && new RegExp(pattern).test(f)).sort();
const cols = Number(colsArg || 4); const w = Number(cellW || 440);
const imgs = await Promise.all(files.map(async f => { const b = await sharp(`/tmp/stprev/${f}`, { density: 150 }).resize({ width: w }).png().toBuffer(); const m = await sharp(b).metadata(); return { b, h: m.height, f }; }));
const rowH = Math.max(...imgs.map(i => i.h));
const rows = Math.ceil(imgs.length / cols);
await sharp({ create: { width: cols * (w + 10) + 10, height: rows * (rowH + 10) + 10, channels: 3, background: "#888" } })
  .composite(imgs.map((im, i) => ({ input: im.b, left: 10 + (i % cols) * (w + 10), top: 10 + Math.floor(i / cols) * (rowH + 10) })))
  .png().toFile(out);
console.log(files.join(" "));
