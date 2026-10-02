import { cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { writeServiceWorker } from "./pwa-worker.mjs";
const root = path.resolve(import.meta.dirname, ".."),
  out = path.join(root, "dist");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const dir of ["src", "public"])
  await cp(path.join(root, dir), path.join(out, dir), { recursive: true });
await cp(path.join(root, "index.html"), path.join(out, "index.html"));
await writeServiceWorker(root);
await writeServiceWorker(out);
await writeFile(path.join(out, ".nojekyll"), "");
console.log("LiraSnap byggd: dist/ (fristående, inga externa resurser)");
