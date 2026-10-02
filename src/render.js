import {
  escapeHTML as esc,
  distance,
  dimensionGeometry,
  formatLength,
  objectBounds,
  rectFrom,
} from "./core.js";
const p = (n) => Number(n.toFixed(3));
function line(a, b, attrs = "") {
  return `<line x1="${p(a.x)}" y1="${p(a.y)}" x2="${p(b.x)}" y2="${p(b.y)}" ${attrs}/>`;
}
function arrow(tip, tail, size) {
  const angle = Math.atan2(tail.y - tip.y, tail.x - tip.x),
    half = size * 0.42;
  const base = {
    x: tip.x + Math.cos(angle) * size,
    y: tip.y + Math.sin(angle) * size,
  };
  return `<path d="M${p(tip.x)} ${p(tip.y)} L${p(base.x - Math.sin(angle) * half)} ${p(base.y + Math.cos(angle) * half)} L${p(base.x + Math.sin(angle) * half)} ${p(base.y - Math.cos(angle) * half)} Z" fill="currentColor" stroke="none"/>`;
}
function textMarkup(text, x, y, size, extra = "") {
  return `<text x="${p(x)}" y="${p(y)}" fill="currentColor" ${/\bstroke=/.test(extra) ? "" : 'stroke="none"'} font-family="Arial, sans-serif" font-size="${size}" ${extra}>${String(
    text,
  )
    .split("\n")
    .map(
      (t, i) =>
        `<tspan x="${p(x)}" dy="${i ? size * 1.25 : 0}">${esc(t)}</tspan>`,
    )
    .join("")}</text>`;
}
export function objectMarkup(o, scale) {
  const attrs = `stroke="${o.color}" color="${o.color}" stroke-width="${o.width}" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  let body = "";
  if (o.type === "line") body = line(o.a, o.b);
  if (["rect", "mask", "highlight"].includes(o.type)) {
    const r = rectFrom(o.a, o.b);
    body = `<rect x="${p(r.x)}" y="${p(r.y)}" width="${p(r.w)}" height="${p(r.h)}" ${o.type === "mask" ? `fill="${o.color}" stroke="none"` : o.type === "highlight" ? `fill="${o.color}" fill-opacity=".24" stroke="none"` : ""}/>`;
  }
  if (o.type === "circle")
    body = `<circle cx="${p(o.a.x)}" cy="${p(o.a.y)}" r="${p(distance(o.a, o.b))}"/>`;
  if (o.type === "freehand")
    body = `<path d="${o.points.map((a, i) => `${i ? "L" : "M"}${p(a.x)} ${p(a.y)}`).join(" ")}"/>`;
  if (o.type === "text") body = textMarkup(o.text, o.a.x, o.a.y, o.fontSize);
  if (o.type === "leader")
    body =
      line(o.a, o.b) +
      arrow(o.a, o.b, o.width * 3 + 8) +
      line(o.b, { x: o.b.x + 25, y: o.b.y }) +
      textMarkup(o.text, o.b.x + 30, o.b.y - 5, o.fontSize);
  if (o.type === "dimension") {
    const {
      p: a,
      q: b,
      normal,
      mid,
      angle,
    } = dimensionGeometry(o.a, o.b, o.offset);
    body =
      line(o.a, {
        x: a.x + normal.x * 10 * Math.sign(o.offset),
        y: a.y + normal.y * 10 * Math.sign(o.offset),
      }) +
      line(o.b, {
        x: b.x + normal.x * 10 * Math.sign(o.offset),
        y: b.y + normal.y * 10 * Math.sign(o.offset),
      }) +
      line(a, b) +
      arrow(a, b, 9) +
      arrow(b, a, 9);
    body += `<g transform="translate(${p(mid.x)} ${p(mid.y)}) rotate(${p(angle)})">${textMarkup(formatLength(distance(o.a, o.b), scale), 0, -8, o.fontSize, 'text-anchor="middle" paint-order="stroke" stroke="white" stroke-width="4" stroke-linejoin="round"')}</g>`;
  }
  return `<g ${attrs}>${body}</g>`;
}
export function annotationMarkup(clip, selectedId = null, screenScale = 1) {
  return clip.objects
    .map((o) => {
      const markup = objectMarkup(o, clip.scale);
      if (!selectedId) return markup;
      const bounds = objectBounds(o),
        padding = 8 / screenScale;
      let hit;
      if (o.type === "text")
        hit = `<rect class="hit" data-object="${esc(o.id)}" x="${bounds.x - padding}" y="${bounds.y - padding}" width="${Math.max(bounds.w, padding) + padding * 2}" height="${Math.max(bounds.h, padding) + padding * 2}" fill="transparent"/>`;
      else {
        const hitObject = { ...o, width: Math.max(o.width, 14 / screenScale) };
        hit = `<g class="hit" data-object="${esc(o.id)}" opacity="0" pointer-events="painted">${objectMarkup(hitObject, clip.scale)}</g>`;
      }
      let grips = "";
      if (
        Array.isArray(selectedId)
          ? selectedId.includes(o.id)
          : o.id === selectedId
      ) {
        grips = `<rect x="${bounds.x - padding}" y="${bounds.y - padding}" width="${Math.max(bounds.w, padding) + padding * 2}" height="${Math.max(bounds.h, padding) + padding * 2}" fill="none" stroke="#4bb88c" stroke-width="${1 / screenScale}" stroke-dasharray="${3 / screenScale} ${3 / screenScale}" pointer-events="none"/>`;
        for (const key of ["a", "b"])
          if (o[key])
            grips += `<rect class="grip" data-object="${esc(o.id)}" data-grip="${key}" x="${o[key].x - 4 / screenScale}" y="${o[key].y - 4 / screenScale}" width="${8 / screenScale}" height="${8 / screenScale}" fill="white" stroke="#147b60" stroke-width="${1 / screenScale}"/>`;
        if (o.type === "dimension") {
          const { mid } = dimensionGeometry(o.a, o.b, o.offset);
          grips += `<circle class="grip" data-object="${esc(o.id)}" data-grip="offset" cx="${mid.x}" cy="${mid.y}" r="${5 / screenScale}" fill="white" stroke="#147b60" stroke-width="${1 / screenScale}"/>`;
        }
      }
      return `<g data-render-object="${esc(o.id)}">${markup}${hit}${grips}</g>`;
    })
    .join("");
}
export function imageMarkup(clip) {
  return `<image href="${esc(clip.src)}" x="0" y="0" width="${clip.naturalWidth}" height="${clip.naturalHeight}"/>`;
}
export function clipSVG(clip, scaleBar = false) {
  const c = clip.crop;
  let footer = "";
  let extra = 0;
  if (scaleBar && clip.scale) {
    extra = Math.max(44, c.w * 0.05);
    const target = c.w * 0.25 * clip.scale.mmPerPixel;
    const magnitude = 10 ** Math.floor(Math.log10(target));
    const length =
      [1, 2, 5, 10]
        .map((n) => n * magnitude)
        .filter((n) => n <= target)
        .at(-1) || magnitude;
    const pixels = length / clip.scale.mmPerPixel,
      x = c.x + extra * 0.4,
      y = c.y + c.h + extra * 0.57;
    footer = `<rect x="${c.x}" y="${c.y + c.h}" width="${c.w}" height="${extra}" fill="white"/><g color="#263d43" stroke="#263d43" stroke-width="2">${line({ x, y }, { x: x + pixels, y })}${line({ x, y: y - 5 }, { x, y: y + 5 })}${line({ x: x + pixels, y: y - 5 }, { x: x + pixels, y: y + 5 })}${textMarkup(formatLength(pixels, clip.scale), x + pixels / 2, y - 8, Math.min(extra * 0.25, 22), 'text-anchor="middle"')}</g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(c.w)}" height="${Math.ceil(c.h + extra)}" viewBox="${c.x} ${c.y} ${c.w} ${c.h + extra}"><defs><clipPath id="bounds"><rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}"/></clipPath></defs><g clip-path="url(#bounds)">${imageMarkup(clip)}${annotationMarkup(clip)}</g>${footer}</svg>`;
}
