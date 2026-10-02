export const UNITS = { mm: 1, cm: 10, m: 1000 };
export const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
export const rectFrom = (a, b) => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(b.x - a.x),
  h: Math.abs(b.y - a.y),
});
export const uid = () => globalThis.crypto.randomUUID();
export const escapeHTML = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function calibrate(a, b, length, unit = "mm") {
  const pixels = distance(a, b);
  if (pixels < 1 || !Number.isFinite(length) || length <= 0 || !UNITS[unit])
    throw new Error("Ange en positiv längd mellan två olika punkter.");
  return {
    mmPerPixel: (length * UNITS[unit]) / pixels,
    unit,
    a: { ...a },
    b: { ...b },
    length,
  };
}
export function formatLength(pixels, scale) {
  if (!scale) return `${Number(pixels.toFixed(1)).toLocaleString("sv-SE")} px`;
  const value = (pixels * scale.mmPerPixel) / UNITS[scale.unit];
  return `${Number(value.toFixed(scale.unit === "m" ? 3 : 1)).toLocaleString("sv-SE")} ${scale.unit}`;
}
export function dimensionGeometry(a, b, offset = 30) {
  const length = distance(a, b) || 1;
  const normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
  const p = { x: a.x + normal.x * offset, y: a.y + normal.y * offset };
  const q = { x: b.x + normal.x * offset, y: b.y + normal.y * offset };
  let angle = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
  if (angle > 90 || angle < -90) angle += 180;
  return {
    p,
    q,
    normal,
    mid: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 },
    angle,
  };
}
export function pointsOf(object) {
  if (object.type === "freehand")
    return object.points.length ? [object.points[0], object.points.at(-1)] : [];
  if (object.type === "text") return [object.a];
  if (["rect", "mask", "highlight"].includes(object.type)) {
    const r = rectFrom(object.a, object.b);
    return [
      { x: r.x, y: r.y },
      { x: r.x + r.w, y: r.y },
      { x: r.x + r.w, y: r.y + r.h },
      { x: r.x, y: r.y + r.h },
      { x: r.x + r.w / 2, y: r.y + r.h / 2 },
    ];
  }
  if (object.type === "circle") {
    const r = distance(object.a, object.b);
    return [
      object.a,
      { x: object.a.x + r, y: object.a.y },
      { x: object.a.x - r, y: object.a.y },
      { x: object.a.x, y: object.a.y + r },
      { x: object.a.x, y: object.a.y - r },
    ];
  }
  return [
    object.a,
    object.b,
    { x: (object.a.x + object.b.x) / 2, y: (object.a.y + object.b.y) / 2 },
  ];
}
export function lineIntersection(a, b, c, d) {
  const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
  const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1
    ? { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }
    : null;
}
export function snapPoint(
  raw,
  start,
  clip,
  aids,
  tolerance = 8,
  exactLength = 0,
  excludeId = null,
) {
  let point = { ...raw },
    kind = "",
    guides = [];
  const objects = clip.objects.filter((o) => o.id !== excludeId);
  const candidates = objects.flatMap(pointsOf);
  if (clip.scale) candidates.push(clip.scale.a, clip.scale.b);
  if (aids.snap) {
    const lines = objects.filter((o) =>
      ["line", "dimension", "leader"].includes(o.type),
    );
    for (let i = 0; i < lines.length; i++)
      for (let j = i + 1; j < lines.length; j++) {
        const p = lineIntersection(
          lines[i].a,
          lines[i].b,
          lines[j].a,
          lines[j].b,
        );
        if (p) candidates.push(p);
      }
    let nearest = tolerance;
    for (const candidate of candidates) {
      const d = distance(raw, candidate);
      if (d < nearest) {
        point = { ...candidate };
        nearest = d;
        kind = "snäpp";
      }
    }
  }
  if (!kind && aids.track && aids.snap) {
    const anchors = aids.anchors || [];
    const x = anchors
      .filter((p) => Math.abs(p.x - raw.x) < tolerance)
      .sort((a, b) => Math.abs(a.x - raw.x) - Math.abs(b.x - raw.x))[0];
    const y = anchors
      .filter((p) => Math.abs(p.y - raw.y) < tolerance)
      .sort((a, b) => Math.abs(a.y - raw.y) - Math.abs(b.y - raw.y))[0];
    if (x) {
      point.x = x.x;
      guides.push({ a: x, b: { x: x.x, y: raw.y } });
      kind = "otrack";
    }
    if (y) {
      point.y = y.y;
      guides.push({ a: y, b: { x: point.x, y: y.y } });
      kind = "otrack";
    }
  }
  if (start && aids.polar && !kind) {
    const radius = distance(start, point),
      angle = Math.atan2(point.y - start.y, point.x - start.x);
    const increment = Math.PI / 4,
      target = Math.round(angle / increment) * increment;
    if (Math.abs(target - angle) < Math.PI / 24 || aids.ortho) {
      const actual = aids.ortho
        ? Math.round(angle / (Math.PI / 2)) * (Math.PI / 2)
        : target;
      point = {
        x: start.x + Math.cos(actual) * radius,
        y: start.y + Math.sin(actual) * radius,
      };
      guides.push({ a: start, b: point });
      kind = "polar";
    }
  }
  if (start && exactLength > 0 && clip.scale) {
    const lengthPx =
      (exactLength * UNITS[clip.scale.unit]) / clip.scale.mmPerPixel;
    const angle = Math.atan2(point.y - start.y, point.x - start.x);
    point = {
      x: start.x + Math.cos(angle) * lengthPx,
      y: start.y + Math.sin(angle) * lengthPx,
    };
    if (kind === "snäpp" || kind === "otrack") {
      kind = "längd";
      guides = [];
    }
  }
  return { point, kind, guides };
}
export function translateObject(object, dx, dy) {
  const shift = (p) => ({ x: p.x + dx, y: p.y + dy });
  return {
    ...object,
    ...(object.a ? { a: shift(object.a) } : {}),
    ...(object.b ? { b: shift(object.b) } : {}),
    ...(object.points ? { points: object.points.map(shift) } : {}),
  };
}
export function objectBounds(object) {
  let points = object.type === "freehand" ? object.points : pointsOf(object);
  if (["text", "leader"].includes(object.type)) {
    const origin =
      object.type === "text"
        ? object.a
        : { x: object.b.x + 30, y: object.b.y - 5 };
    const lines = String(object.text || "").split("\n");
    const width =
      Math.max(1, ...lines.map((t) => t.length)) * object.fontSize * 0.62;
    points = [
      ...points,
      { x: origin.x, y: origin.y - object.fontSize },
      {
        x: origin.x + width,
        y: origin.y + object.fontSize * (lines.length - 1) * 1.25,
      },
    ];
  }
  if (object.type === "dimension") {
    const { p, q } = dimensionGeometry(object.a, object.b, object.offset);
    points = [...points, p, q];
  }
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
}
export function cropClip(clip, rect) {
  const current = clip.crop;
  const x = Math.max(current.x, rect.x),
    y = Math.max(current.y, rect.y);
  const right = Math.min(current.x + current.w, rect.x + rect.w),
    bottom = Math.min(current.y + current.h, rect.y + rect.h);
  if (right - x < 2 || bottom - y < 2)
    throw new Error("Beskärningen är för liten.");
  return {
    ...clip,
    crop: { x, y, w: right - x, h: bottom - y },
    width: (clip.width * (right - x)) / current.w,
  };
}
export function validateProject(value) {
  const fail = () => {
    throw new Error("Filen är inte ett giltigt LiraSnap-projekt.");
  };
  if (
    !value ||
    value.version !== 1 ||
    typeof value.name !== "string" ||
    !Array.isArray(value.clips) ||
    value.clips.length > 80
  )
    fail();
  const finite = (n) =>
    typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e7;
  const point = (p) => p && finite(p.x) && finite(p.y);
  const ids = new Set();
  for (const c of value.clips) {
    if (
      !c ||
      typeof c.id !== "string" ||
      ids.has(c.id) ||
      typeof c.name !== "string" ||
      typeof c.src !== "string" ||
      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(c.src)
    )
      fail();
    ids.add(c.id);
    if (
      !finite(c.naturalWidth) ||
      !finite(c.naturalHeight) ||
      c.naturalWidth <= 0 ||
      c.naturalHeight <= 0 ||
      c.naturalWidth > 16000 ||
      c.naturalHeight > 16000 ||
      c.naturalWidth * c.naturalHeight > 80000000 ||
      !finite(c.x) ||
      !finite(c.y) ||
      !finite(c.width) ||
      c.width < 40
    )
      fail();
    if (
      !c.crop ||
      !finite(c.crop.x) ||
      !finite(c.crop.y) ||
      !finite(c.crop.w) ||
      !finite(c.crop.h) ||
      c.crop.x < 0 ||
      c.crop.y < 0 ||
      c.crop.w <= 0 ||
      c.crop.h <= 0 ||
      c.crop.x + c.crop.w > c.naturalWidth + 0.01 ||
      c.crop.y + c.crop.h > c.naturalHeight + 0.01
    )
      fail();
    if (
      c.scale &&
      (!finite(c.scale.mmPerPixel) ||
        c.scale.mmPerPixel <= 0 ||
        !UNITS[c.scale.unit] ||
        !point(c.scale.a) ||
        !point(c.scale.b) ||
        !finite(c.scale.length) ||
        c.scale.length <= 0)
    )
      fail();
    if (!Array.isArray(c.objects) || c.objects.length > 5000) fail();
    const objectIds = new Set();
    for (const o of c.objects) {
      if (
        !o ||
        typeof o.id !== "string" ||
        objectIds.has(o.id) ||
        ![
          "line",
          "rect",
          "circle",
          "dimension",
          "leader",
          "text",
          "freehand",
          "mask",
          "highlight",
        ].includes(o.type) ||
        !/^#[a-fA-F0-9]{6}$/.test(o.color) ||
        !finite(o.width) ||
        o.width <= 0 ||
        o.width > 100 ||
        !finite(o.fontSize) ||
        o.fontSize < 1 ||
        o.fontSize > 1000
      )
        fail();
      objectIds.add(o.id);
      if (o.type === "freehand") {
        if (
          !Array.isArray(o.points) ||
          !o.points.length ||
          o.points.length > 100000 ||
          !o.points.every(point)
        )
          fail();
      } else if (!point(o.a) || (o.type !== "text" && !point(o.b))) fail();
      if (
        ["text", "leader"].includes(o.type) &&
        (typeof o.text !== "string" || o.text.length > 10000)
      )
        fail();
      if (o.type === "dimension" && !finite(o.offset)) fail();
    }
  }
  return { version: 1, name: value.name.slice(0, 120), clips: value.clips };
}
