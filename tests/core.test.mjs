import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calibrate,
  distance,
  formatLength,
  snapPoint,
  translateObject,
  cropClip,
  lineIntersection,
  dimensionGeometry,
  validateProject,
} from "../src/core.js";
import { clipSVG } from "../src/render.js";
import { jpegPDF } from "../src/export.js";
const a = { x: 10, y: 20 },
  b = { x: 110, y: 20 };
const object = {
  id: "line-1",
  type: "line",
  a,
  b,
  color: "#147b60",
  width: 3,
  fontSize: 22,
};
const clip = () => ({
  id: "clip-1",
  name: "Bild",
  src: "data:image/png;base64,aGVsbG8=",
  naturalWidth: 600,
  naturalHeight: 400,
  crop: { x: 0, y: 0, w: 600, h: 400 },
  width: 500,
  x: 120,
  y: 80,
  objects: [structuredClone(object)],
  scale: calibrate(a, b, 1, "m"),
});
test("calibration converts real-world units to millimetres without depending on display size", () => {
  const scale = calibrate(a, b, 1, "m");
  assert.equal(scale.mmPerPixel, 10);
  assert.equal(formatLength(100, scale), "1 m");
  assert.equal(formatLength(500, { ...scale, unit: "mm" }), "5 000 mm");
  assert.equal(formatLength(100, null), "100 px");
});
test("calibration rejects coincident points, negative lengths and unknown units", () => {
  for (const args of [
    [a, a, 10, "mm"],
    [a, b, -1, "m"],
    [a, b, Infinity, "mm"],
    [a, b, 1, "ft"],
  ])
    assert.throws(() => calibrate(...args));
});
test("endpoint, midpoint and intersection snapping", () => {
  const c = clip();
  let snap = snapPoint({ x: 59, y: 21 }, null, c, { snap: true }, 5);
  assert.deepEqual(snap.point, { x: 60, y: 20 });
  c.objects.push({
    ...object,
    id: "cross",
    a: { x: 35, y: 0 },
    b: { x: 35, y: 60 },
  });
  snap = snapPoint({ x: 36, y: 22 }, null, c, { snap: true }, 5);
  assert.deepEqual(snap.point, { x: 35, y: 20 });
  assert.equal(
    lineIntersection(a, b, { x: 200, y: 0 }, { x: 200, y: 30 }),
    null,
  );
});
test("polar snaps near 45 degrees but leaves other directions free", () => {
  const c = { objects: [] };
  const s = snapPoint(
    { x: 100, y: 102 },
    { x: 0, y: 0 },
    c,
    { polar: true },
    8,
  );
  assert.ok(Math.abs(s.point.x - s.point.y) < 1e-6);
  assert.equal(s.kind, "polar");
  assert.deepEqual(
    snapPoint({ x: 100, y: 40 }, { x: 0, y: 0 }, c, { polar: true }, 8).point,
    { x: 100, y: 40 },
  );
});
test("OTRACK aligns to existing reference points", () => {
  const s = snapPoint(
    { x: 112, y: 92 },
    null,
    clip(),
    { track: true, snap: true, anchors: [a, b] },
    5,
  );
  assert.equal(s.point.x, 110);
  assert.equal(s.point.y, 92);
  assert.equal(s.kind, "otrack");
});
test("OTRACK does not align to unacquired geometry or work without OSNAP", () => {
  const raw = { x: 112, y: 92 };
  assert.deepEqual(
    snapPoint(raw, null, clip(), { track: true, snap: true }, 5).point,
    raw,
  );
  assert.deepEqual(
    snapPoint(raw, null, clip(), { track: true, snap: false, anchors: [b] }, 5)
      .point,
    raw,
  );
});
test("exact length takes priority over an incompatible endpoint snap", () => {
  const c = clip();
  const snap = snapPoint(
    { x: 110, y: 20 },
    a,
    c,
    { snap: true, polar: true },
    8,
    0.5,
  );
  assert.equal(distance(a, snap.point), 50);
  assert.equal(snap.kind, "längd");
  assert.equal(snap.guides.length, 0);
});
test("object drag moves geometry without mutating its baseline", () => {
  const moved = translateObject(object, 5, -10);
  assert.deepEqual(moved.a, { x: 15, y: 10 });
  assert.deepEqual(object.a, a);
  const path = translateObject(
    { ...object, type: "freehand", points: [a, b] },
    20,
    30,
  );
  assert.deepEqual(path.points[1], { x: 130, y: 50 });
});
test("crop preserves reference scale and object coordinates, clipping to the image", () => {
  const c = clip();
  const cropped = cropClip(c, { x: -10, y: 40, w: 300, h: 1000 });
  assert.deepEqual(cropped.crop, { x: 0, y: 40, w: 290, h: 360 });
  assert.equal(cropped.scale.mmPerPixel, 10);
  assert.deepEqual(cropped.objects[0].a, a);
  assert.equal(cropped.width, (500 * 290) / 600);
  assert.throws(() => cropClip(c, { x: 700, y: 0, w: 100, h: 100 }));
});
test("dimension offset is perpendicular and labels stay readable in reversed directions", () => {
  const d = dimensionGeometry(b, a, 30);
  assert.deepEqual(d.p, { x: 110, y: -10 });
  assert.ok(d.angle === 360 || d.angle === 0);
});
test("projects reject invalid geometry, executable image sources, duplicate IDs and invalid styles", () => {
  const valid = { version: 1, name: "Projekt", clips: [clip()] };
  assert.equal(validateProject(valid).clips.length, 1);
  for (const mutate of [
    (c) => (c.src = "javascript:alert(1)"),
    (c) => (c.x = NaN),
    (c) => (c.crop.w = 999999),
    (c) => (c.scale.unit = "ft"),
    (c) => (c.objects[0].color = 'red" onload="alert(1)'),
    (c) => (c.objects[0].a.x = Infinity),
  ]) {
    const copy = structuredClone(valid);
    mutate(copy.clips[0]);
    assert.throws(() => validateProject(copy));
  }
  assert.throws(() => validateProject({ ...valid, clips: [clip(), clip()] }));
});
test("SVG export escapes user text and excludes editing handles", () => {
  const c = clip();
  c.objects.push({
    ...object,
    id: "txt",
    type: "text",
    text: '<script>&"',
    a,
    b: undefined,
  });
  const svg = clipSVG(c, true);
  assert.ok(svg.includes("&lt;script&gt;&amp;"));
  assert.ok(!svg.includes('class="grip"'));
  assert.ok(svg.includes('clip-path="url(#bounds)"'));
  assert.ok(svg.includes('viewBox="0 0 600 444"'));
});
test("PDF embeds byte-accurate streams, complete xref offsets and portrait page size", () => {
  const jpeg = new Uint8Array([255, 216, 255, 217]),
    bytes = jpegPDF(jpeg, 100, 200);
  const text = new TextDecoder().decode(bytes);
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.ok(text.includes("/MediaBox [0 0 595 842]"));
  assert.ok(text.includes("/Length 4"));
  const xref = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.equal(new TextDecoder().decode(bytes.slice(xref, xref + 4)), "xref");
  const offsets = text
    .slice(text.indexOf("xref"))
    .split("\n")
    .slice(3, 8)
    .map((line) => Number(line.slice(0, 10)));
  for (const [i, offset] of offsets.entries())
    assert.ok(
      new TextDecoder()
        .decode(bytes.slice(offset, offset + 7))
        .startsWith(`${i + 1} 0 obj`),
    );
});
