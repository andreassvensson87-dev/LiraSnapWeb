import { clipSVG } from "./render.js";
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Bilden kunde inte läsas."));
    image.src = src;
  });
}
export function canvasBlob(canvas, type = "image/png", quality = 0.96) {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Bilden är för stor för att exporteras.")),
      type,
      quality,
    ),
  );
}
export async function renderClip(clip, scaleBar = false) {
  const svg = clipSVG(clip, scaleBar),
    url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    if (canvas.width * canvas.height > 80000000)
      throw new Error("Bilden är för stor. Beskär den före export.");
    canvas.getContext("2d").drawImage(img, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}
export async function renderCollection(clips, scaleBar = false) {
  if (!clips.length) throw new Error("Lägg till en bild först.");
  if (clips.length === 1) return renderClip(clips[0], scaleBar);
  const left = Math.min(...clips.map((c) => c.x)),
    top = Math.min(...clips.map((c) => c.y));
  const factor = Math.min(3, Math.max(...clips.map((c) => c.crop.w / c.width)));
  const right = Math.max(...clips.map((c) => c.x + c.width)),
    bottom = Math.max(
      ...clips.map(
        (c) =>
          c.y +
          (c.width *
            (c.crop.h +
              (scaleBar && c.scale ? Math.max(44, c.crop.w * 0.05) : 0))) /
            c.crop.w,
      ),
    );
  const w = Math.ceil((right - left + 32) * factor),
    h = Math.ceil((bottom - top + 32) * factor);
  if (w > 16000 || h > 16000 || w * h > 80000000)
    throw new Error(
      "Samlingen är för stor. Flytta klippen närmare varandra eller exportera ett i taget.",
    );
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  for (const clip of clips) {
    const image = await renderClip(clip, scaleBar);
    const ratio = clip.width / clip.crop.w;
    ctx.drawImage(
      image,
      (clip.x - left + 16) * factor,
      (clip.y - top + 16) * factor,
      image.width * ratio * factor,
      image.height * ratio * factor,
    );
  }
  return canvas;
}
// A single-page PDF containing a JPEG, with offsets measured in bytes.
export function jpegPDF(jpegBytes, imageWidth, imageHeight) {
  const enc = new TextEncoder(),
    parts = [],
    offsets = [0];
  let size = 0;
  const append = (data) => {
    const bytes = typeof data === "string" ? enc.encode(data) : data;
    parts.push(bytes);
    size += bytes.length;
  };
  const landscape = imageWidth >= imageHeight,
    pw = landscape ? 842 : 595,
    ph = landscape ? 595 : 842;
  const ratio = Math.min((pw - 40) / imageWidth, (ph - 40) / imageHeight),
    w = imageWidth * ratio,
    h = imageHeight * ratio;
  const content = `q\n${w.toFixed(4)} 0 0 ${h.toFixed(4)} ${((pw - w) / 2).toFixed(4)} ${((ph - h) / 2).toFixed(4)} cm\n/Im0 Do\nQ\n`;
  append("%PDF-1.4\n");
  const obj = (n, text) => {
    offsets[n] = size;
    append(`${n} 0 obj\n${text}\nendobj\n`);
  };
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
  );
  offsets[4] = size;
  append(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`,
  );
  append(jpegBytes);
  append("\nendstream\nendobj\n");
  obj(
    5,
    `<< /Length ${enc.encode(content).length} >>\nstream\n${content}endstream`,
  );
  const xref = size;
  append(
    `xref\n0 6\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
      .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`,
  );
  const output = new Uint8Array(size);
  let cursor = 0;
  for (const part of parts) {
    output.set(part, cursor);
    cursor += part.length;
  }
  return output;
}
export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
