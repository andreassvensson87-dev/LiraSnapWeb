import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const require = createRequire(
  path.resolve(
    process.env.LIRASNAP_TEST_MODULES || "node_modules",
    "package.json",
  ),
);
const { chromium } = require("playwright");
let revision = 1;
const root = path.resolve("dist");
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (!pathname.startsWith("/snap/")) {
      res.writeHead(404).end();
      return;
    }
    const file = pathname.slice(6) || "index.html";
    let content = await readFile(path.join(root, file));
    if (file === "sw.js")
      content = Buffer.from(
        content
          .toString()
          .replace(/const VERSION=.*?;/, `const VERSION='test-${revision}';`),
      );
    const type = {
      ".js": "text/javascript",
      ".css": "text/css",
      ".html": "text/html",
      ".webmanifest": "application/manifest+json",
      ".png": "image/png",
      ".svg": "image/svg+xml",
    }[path.extname(file)];
    res.writeHead(200, {
      "Content-Type": type || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(content);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/snap/`;
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    window.captureCalls = 0;
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      value: async () => {
        window.captureCalls++;
        window.captureHadActivation = navigator.userActivation.isActive;
        throw new DOMException("Test cancellation", "NotAllowedError");
      },
    });
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const manifest = await (
    await context.request.get(base + "public/manifest.webmanifest")
  ).json();
  assert.equal(
    new URL(manifest.start_url, base + "public/manifest.webmanifest").href,
    base,
  );
  assert.equal(manifest.shortcuts.length, 3);
  for (const icon of manifest.icons)
    assert.equal(
      (
        await context.request.get(
          new URL(icon.src, base + "public/manifest.webmanifest").href,
        )
      ).status(),
      200,
    );
  await page.locator("[data-action=example]").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".clip").length === 2,
  );
  await page.waitForFunction(
    () =>
      document.querySelector("#save-status").textContent === "Sparat lokalt",
  );

  await page.goto(base + "?action=capture&keep=1");
  await page.locator("#capture-launch[open]").waitFor();
  assert.equal(await page.evaluate(() => window.captureCalls), 0);
  assert.equal(new URL(page.url()).search, "?keep=1");
  assert.equal(await page.locator(".clip").count(), 2);
  await page.locator("#capture-launch-start").click();
  assert.equal(await page.evaluate(() => window.captureCalls), 1);
  assert.equal(await page.evaluate(() => window.captureHadActivation), true);

  await page.goto(base + "?action=new-project");
  await page.locator("#form-dialog[open]").waitFor();
  await page.locator("#form-dialog .secondary").click();
  assert.equal(await page.locator(".clip").count(), 2);
  await page.locator("[data-action=new]").click();
  await page.locator("#dialog-fields [name=name]").fill("PWA-projekt");
  await page.locator("#dialog-submit").click();
  await page.waitForFunction(() => !document.querySelector(".clip"));
  await page.locator("[data-action=undo]").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".clip").length === 2,
  );
  await page.waitForFunction(
    () =>
      document.querySelector("#save-status").textContent === "Sparat lokalt",
  );

  await context.setOffline(true);
  await page.goto(base + "?action=capture");
  await page.locator("#capture-launch[open]").waitFor();
  assert.equal(await page.locator(".clip").count(), 2);
  await page.locator("#capture-launch-close").click();
  await context.setOffline(false);

  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    event.prompt = async () => {
      window.installPromptCalled = true;
    };
    event.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(event);
  });
  await page.locator("#install-app").click();
  assert.equal(await page.evaluate(() => window.installPromptCalled), true);

  revision = 2;
  // Returning to an already open app discovers a new release without reload.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.locator("#update-app").waitFor({ state: "visible" });
  await Promise.all([
    page.waitForEvent("load"),
    page.locator("#update-app").click(),
  ]);
  await page.waitForFunction(
    () => document.querySelectorAll(".clip").length === 2,
  );
  assert.equal(await page.locator("#update-app").isHidden(), true);
  assert.deepEqual(errors, []);
  console.log(
    "PWA: manifest, subpath, shortcuts, activation, cancel/undo, offline, installation prompt and safe update passed.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
