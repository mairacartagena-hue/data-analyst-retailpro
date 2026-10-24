// Genera los íconos PNG de la PWA a partir de public/icon.svg
import sharp from "sharp";
import { readFile } from "node:fs/promises";

const svg = await readFile(new URL("../public/icon.svg", import.meta.url));
const out = (name) => new URL(`../public/icons/${name}`, import.meta.url).pathname;

await sharp(svg).resize(192, 192).png().toFile(out("icon-192.png"));
await sharp(svg).resize(512, 512).png().toFile(out("icon-512.png"));
await sharp(svg).resize(180, 180).png().toFile(out("apple-touch-icon.png"));
// Maskable: el dibujo ocupa el 70 % central para que Android lo recorte sin cortar los aros
const inner = await sharp(svg).resize(360, 360).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: "#5f6d33" } })
  .composite([{ input: inner, gravity: "center" }]).png().toFile(out("icon-512-maskable.png"));
console.log("Íconos generados");
