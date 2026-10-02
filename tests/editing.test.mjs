import test from "node:test";
import assert from "node:assert/strict";
import { selectWindow, trimLine, extendLine } from "../src/editing.js";
const line = (id, a, b) => ({
  id,
  type: "line",
  a,
  b,
  color: "#147b60",
  width: 3,
  fontSize: 22,
});
const horizontal = line("a", { x: 0, y: 50 }, { x: 100, y: 50 }),
  vertical = line("b", { x: 40, y: 0 }, { x: 40, y: 100 });
test("window encloses objects, crossing includes intersections but not bounding-box false positives", () => {
  const objects = [
    horizontal,
    line("short", { x: 20, y: 40 }, { x: 30, y: 60 }),
    line("diagonal", { x: 0, y: 0 }, { x: 100, y: 100 }),
  ];
  assert.deepEqual(selectWindow(objects, { x: 10, y: 30 }, { x: 35, y: 70 }), [
    "short",
  ]);
  assert.deepEqual(selectWindow(objects, { x: 35, y: 70 }, { x: 10, y: 30 }), [
    "a",
    "short",
    "diagonal",
  ]);
  assert.deepEqual(
    selectWindow([objects[2]], { x: 80, y: 5 }, { x: 60, y: 20 }),
    [],
  );
});
test("circle crossing selects the circumference and skips a box entirely inside the circle", () => {
  const c = {
    id: "c",
    type: "circle",
    a: { x: 50, y: 50 },
    b: { x: 90, y: 50 },
  };
  assert.deepEqual(selectWindow([c], { x: 60, y: 45 }, { x: 40, y: 55 }), []);
  assert.deepEqual(selectWindow([c], { x: 100, y: 45 }, { x: 85, y: 55 }), [
    "c",
  ]);
});
test("trim removes the clicked side and keeps the other side unchanged", () => {
  const [piece] = trimLine(horizontal, [vertical], { x: 10, y: 50 });
  assert.deepEqual(piece.a, { x: 40, y: 50 });
  assert.deepEqual(piece.b, horizontal.b);
  assert.deepEqual(horizontal.a, { x: 0, y: 50 });
  const [left] = trimLine(horizontal, [vertical], { x: 90, y: 50 });
  assert.deepEqual(left.b, { x: 40, y: 50 });
});
test("trim between two boundaries splits a line into two retained pieces", () => {
  const pieces = trimLine(
    horizontal,
    [{ type: "rect", a: { x: 20, y: 20 }, b: { x: 80, y: 80 } }],
    { x: 50, y: 50 },
  );
  assert.equal(pieces.length, 2);
  assert.deepEqual(pieces[0].b, { x: 20, y: 50 });
  assert.deepEqual(pieces[1].a, { x: 80, y: 50 });
});
test("extend uses the nearest boundary beyond the chosen endpoint", () => {
  const short = line("short", { x: 0, y: 50 }, { x: 20, y: 50 });
  const result = extendLine(
    short,
    [vertical, line("far", { x: 80, y: 0 }, { x: 80, y: 100 })],
    { x: 19, y: 50 },
  );
  assert.deepEqual(result.b, { x: 40, y: 50 });
  assert.equal(extendLine(short, [vertical], { x: 1, y: 50 }), null);
});
test("trim and extend intersect circles without replacing them by bounding boxes", () => {
  const c = { type: "circle", a: { x: 50, y: 50 }, b: { x: 70, y: 50 } };
  assert.equal(trimLine(horizontal, [c], { x: 50, y: 50 }).length, 2);
  assert.deepEqual(
    extendLine(line("s", { x: 0, y: 50 }, { x: 10, y: 50 }), [c], {
      x: 9,
      y: 50,
    }).b,
    { x: 30, y: 50 },
  );
});
