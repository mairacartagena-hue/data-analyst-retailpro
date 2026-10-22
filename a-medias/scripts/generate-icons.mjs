// Genera los PNG de la PWA desde un SVG simple con las iniciales "AM".
// Uso: npm run icons
import sharp from "sharp";
import { writeFile } from "node:fs/promises";

const BG = "#7c0116";
const FG = "#ffd7e7";

// Letras dibujadas con trazos (no dependen de fuentes instaladas)
const letras = `
  <path fill="${FG}" fill-rule="evenodd" d="M76 376 L134 136 L186 136 L244 376 L196 376 L184 324 L136 324 L124 376 Z M146 282 L174 282 L160 212 Z"/>
  <path fill="${FG}" d="M268 376 L268 136 L324 136 L352 236 L380 136 L436 136 L436 376 L392 376 L392 236 L366 322 L338 322 L312 236 L312 376 Z"/>`;

const svg = ({ rx = 112, escala = 1 } = {}) => {
  const t = (512 * (1 - escala)) / 2;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${rx}" fill="${BG}"/>
  <g transform="translate(${t} ${t}) scale(${escala})">${letras}</g>
</svg>`);
};

// Silueta monocroma para la barra de estado de Android
const badge = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <g transform="translate(-30 -40) scale(1.12)"><path fill="#ffffff" fill-rule="evenodd" d="M76 376 L134 136 L186 136 L244 376 L196 376 L184 324 L136 324 L124 376 Z M146 282 L174 282 L160 212 Z"/><path fill="#ffffff" d="M268 376 L268 136 L324 136 L352 236 L380 136 L436 136 L436 376 L392 376 L392 236 L366 322 L338 322 L312 236 L312 376 Z"/></g></svg>`);

const out = "public";
const png = (buf, size, file) => sharp(buf).resize(size, size).png().toFile(`${out}/${file}`);

await png(svg(), 192, "icons/icon-192.png");
await png(svg(), 512, "icons/icon-512.png");
// Maskable: fondo a sangre y letras dentro de la zona segura (80%)
await png(svg({ rx: 0, escala: 0.72 }), 512, "icons/icon-512-maskable.png");
// iOS recorta las esquinas solo
await png(svg({ rx: 0, escala: 0.86 }), 180, "icons/apple-touch-icon.png");
await png(badge, 96, "icons/badge-96.png");

// favicon.ico (contenedor ICO con un PNG de 32 px dentro)
const fav = await sharp(svg({ rx: 96 })).resize(32, 32).png().toBuffer();
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0); // reservado
header.writeUInt16LE(1, 2); // tipo icono
header.writeUInt16LE(1, 4); // 1 imagen
header.writeUInt8(32, 6); // ancho
header.writeUInt8(32, 7); // alto
header.writeUInt8(0, 8);
header.writeUInt8(0, 9);
header.writeUInt16LE(1, 10); // planos
header.writeUInt16LE(32, 12); // bits por pixel
header.writeUInt32LE(fav.length, 14);
header.writeUInt32LE(22, 18); // offset
await writeFile(`${out}/favicon.ico`, Buffer.concat([header, fav]));

console.log("Íconos generados en public/icons y public/favicon.ico");
