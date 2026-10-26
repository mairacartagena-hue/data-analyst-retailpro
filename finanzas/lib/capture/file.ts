"use client";
// Archivos para enviar a la IA: fotos reducidas y PDF en base64.

/** Reduce la foto (máx. 1600 px, JPEG) para enviarla rápido. */
export async function shrink(file: File, maxSide = 1600): Promise<{ data: string; mime: string }> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const url = canvas.toDataURL("image/jpeg", 0.82);
    return { data: url.slice(url.indexOf(",") + 1), mime: "image/jpeg" };
  } catch {
    // El navegador no pudo abrirla (ej. HEIC): se envía tal cual
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { data: btoa(bin), mime: file.type || "image/jpeg" };
  }
}

/** Archivo tal cual en base64 (PDF del banco). */
export async function toBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}
