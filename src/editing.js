import { distance, rectFrom, objectBounds, dimensionGeometry } from "./core.js";
const EPS = 1e-8;
const inside = (p, r) =>
  p.x >= r.x - EPS &&
  p.x <= r.x + r.w + EPS &&
  p.y >= r.y - EPS &&
  p.y <= r.y + r.h + EPS;
const corners = (r) => [
  { x: r.x, y: r.y },
  { x: r.x + r.w, y: r.y },
  { x: r.x + r.w, y: r.y + r.h },
  { x: r.x, y: r.y + r.h },
];
function segments(o) {
  if (o.type === "freehand")
    return o.points.slice(1).map((p, i) => [o.points[i], p]);
  if (["rect", "mask", "highlight"].includes(o.type)) {
    const p = corners(rectFrom(o.a, o.b));
    return p.map((a, i) => [a, p[(i + 1) % 4]]);
  }
  if (o.type === "dimension") {
    const { p, q } = dimensionGeometry(o.a, o.b, o.offset);
    return [
      [o.a, p],
      [o.b, q],
      [p, q],
    ];
  }
  if (o.type === "leader")
    return [
      [o.a, o.b],
      [o.b, { x: o.b.x + 25, y: o.b.y }],
    ];
  return o.b ? [[o.a, o.b]] : [];
}
export function boundaryParameters(a, b, boundary) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  if (boundary.type === "circle") {
    const r = distance(boundary.a, boundary.b),
      x = a.x - boundary.a.x,
      y = a.y - boundary.a.y;
    const A = dx * dx + dy * dy,
      B = 2 * (x * dx + y * dy),
      C = x * x + y * y - r * r,
      D = B * B - 4 * A * C;
    if (A < EPS || D < -EPS) return [];
    return [
      (-B - Math.sqrt(Math.max(0, D))) / (2 * A),
      (-B + Math.sqrt(Math.max(0, D))) / (2 * A),
    ];
  }
  const result = [];
  for (const [c, d] of segments(boundary)) {
    const ex = d.x - c.x,
      ey = d.y - c.y,
      den = dx * ey - dy * ex;
    if (Math.abs(den) < EPS) continue;
    const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / den,
      u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / den;
    if (u >= -EPS && u <= 1 + EPS) result.push(t);
  }
  return result;
}
export function selectWindow(objects, a, b) {
  const r = rectFrom(a, b),
    crossing = b.x < a.x,
    edges = corners(r).map((p, i, all) => [p, all[(i + 1) % 4]]);
  return objects
    .filter((o) => {
      const bounds = objectBounds(o),
        contained =
          inside({ x: bounds.x, y: bounds.y }, r) &&
          inside({ x: bounds.x + bounds.w, y: bounds.y + bounds.h }, r);
      if (!crossing) return contained;
      if (contained) return true;
      if (
        bounds.x > r.x + r.w ||
        bounds.y > r.y + r.h ||
        bounds.x + bounds.w < r.x ||
        bounds.y + bounds.h < r.y
      )
        return false;
      if (["text", "mask", "highlight", "leader"].includes(o.type)) return true;
      if (o.type === "circle") {
        const radius = distance(o.a, o.b),
          nearest = {
            x: Math.max(r.x, Math.min(r.x + r.w, o.a.x)),
            y: Math.max(r.y, Math.min(r.y + r.h, o.a.y)),
          };
        return (
          distance(nearest, o.a) <= radius + EPS &&
          Math.max(...corners(r).map((p) => distance(p, o.a))) >= radius - EPS
        );
      }
      return segments(o).some(
        ([p, q]) =>
          inside(p, r) ||
          inside(q, r) ||
          edges.some(([x, y]) =>
            boundaryParameters(p, q, { type: "line", a: x, b: y }).some(
              (t) => t >= -EPS && t <= 1 + EPS,
            ),
          ),
      );
    })
    .map((o) => o.id);
}
export function trimLine(line, boundaries, pick) {
  const cuts = [
    ...new Set(
      boundaries
        .flatMap((b) => boundaryParameters(line.a, line.b, b))
        .filter((t) => t > EPS && t < 1 - EPS)
        .map((t) => Number(t.toFixed(9))),
    ),
  ].sort((a, b) => a - b);
  if (!cuts.length) return null;
  const dx = line.b.x - line.a.x,
    dy = line.b.y - line.a.y,
    t =
      ((pick.x - line.a.x) * dx + (pick.y - line.a.y) * dy) /
      (dx * dx + dy * dy);
  const stops = [0, ...cuts, 1];
  let index = stops.findIndex((end, i) => i > 0 && t < end + EPS);
  if (index < 0) index = stops.length - 1;
  const lo = stops[index - 1],
    hi = stops[index],
    at = (t) => ({ x: line.a.x + dx * t, y: line.a.y + dy * t });
  const result = [];
  if (lo > EPS) result.push({ ...line, b: at(lo) });
  if (hi < 1 - EPS) result.push({ ...line, a: at(hi) });
  return result;
}
export function extendLine(line, boundaries, pick) {
  const fromA = distance(pick, line.a) < distance(pick, line.b);
  const cuts = boundaries
    .flatMap((b) => boundaryParameters(line.a, line.b, b))
    .filter((t) => (fromA ? t < -EPS : t > 1 + EPS));
  if (!cuts.length) return null;
  const t = fromA ? Math.max(...cuts) : Math.min(...cuts),
    point = {
      x: line.a.x + (line.b.x - line.a.x) * t,
      y: line.a.y + (line.b.y - line.a.y) * t,
    };
  return { ...line, [fromA ? "a" : "b"]: point };
}
