import test from "node:test";
import assert from "node:assert/strict";
import { TrackingReferences } from "../src/tracking.js";
const p = { x: 10, y: 20 },
  q = { x: 40, y: 80 };
test("a reference requires continuous hovering for 400 ms", () => {
  const t = new TrackingReferences();
  t.update({ candidate: p, now: 0 });
  t.update({ candidate: p, now: 399 });
  assert.equal(t.points.length, 0);
  t.update({ candidate: p, now: 400 });
  assert.deepEqual(t.points, [p]);
});
test("leaving or changing snap point resets the acquisition delay", () => {
  const t = new TrackingReferences();
  t.update({ candidate: p, now: 0 });
  t.update({ now: 300 });
  t.update({ candidate: p, now: 350 });
  t.update({ candidate: q, now: 700 });
  t.update({ candidate: q, now: 1099 });
  assert.equal(t.points.length, 0);
  t.update({ candidate: q, now: 1100 });
  assert.deepEqual(t.points, [q]);
});
test("reference releases after 1200 ms without contact even with stationary cursor", () => {
  const t = new TrackingReferences();
  t.update({ candidate: p, now: 0 });
  t.update({ candidate: p, now: 400 });
  t.update({ now: 1599 });
  assert.equal(t.points.length, 1);
  t.update({ now: 1600 });
  assert.equal(t.points.length, 0);
});
test("helper-line contact retains a reference and starts a fresh timeout on departure", () => {
  const t = new TrackingReferences();
  t.update({ candidate: p, now: 0 });
  t.update({ candidate: p, now: 400 });
  for (let now = 500; now <= 5000; now += 100) t.update({ contacts: [p], now });
  assert.deepEqual(t.points, [p]);
  t.update({ now: 6199 });
  assert.equal(t.points.length, 1);
  t.update({ now: 6200 });
  assert.equal(t.points.length, 0);
});
test("contact only keeps the referenced point, not all tracked points", () => {
  const t = new TrackingReferences();
  t.update({ candidate: p, now: 0 });
  t.update({ candidate: p, now: 400 });
  t.update({ candidate: q, now: 500 });
  t.update({ candidate: q, now: 900 });
  t.update({ contacts: [q], now: 1600 });
  assert.deepEqual(t.points, [q]);
  t.clear();
  assert.deepEqual(t.points, []);
  assert.equal(t.pending, null);
});
