import { distance } from "./core.js";
const same = (a, b) => a && b && distance(a, b) < 1e-7;
export class TrackingReferences {
  constructor({ acquireMs = 400, releaseMs = 1200 } = {}) {
    this.acquireMs = acquireMs;
    this.releaseMs = releaseMs;
    this.clear();
  }
  clear() {
    this.entries = [];
    this.pending = null;
  }
  get points() {
    return this.entries.map((e) => e.p);
  }
  update({ candidate = null, contacts = [], now }) {
    const before = JSON.stringify(this.points);
    for (const entry of this.entries)
      if (contacts.some((p) => same(p, entry.p)) || same(candidate, entry.p))
        entry.lastContact = now;
    this.entries = this.entries.filter(
      (e) => now - e.lastContact < this.releaseMs,
    );
    if (!candidate) this.pending = null;
    else if (!this.pending || !same(candidate, this.pending.p))
      this.pending = { p: { ...candidate }, since: now };
    if (
      this.pending &&
      now - this.pending.since >= this.acquireMs &&
      !this.entries.some((e) => same(e.p, this.pending.p))
    ) {
      this.entries.push({ p: { ...this.pending.p }, lastContact: now });
      this.entries = this.entries.slice(-2);
    }
    return before !== JSON.stringify(this.points);
  }
}
