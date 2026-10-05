import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
const require = createRequire(
  path.resolve(
    process.env.LIRASNAP_TEST_MODULES || "node_modules",
    "package.json",
  ),
);
await mkdir("test-results", { recursive: true });
const { chromium } = require("playwright");
const { PDFDocument } = require("pdf-lib");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(process.env.LIRASNAP_TEST_URL || "http://localhost:5188");
  await page.locator("[data-action=example]").click();
  await page.waitForSelector(".clip");
  const store = () =>
    page.evaluate(async () => {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open("lirasnap-workspace", 1);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      return new Promise((res) => {
        const r = db
          .transaction("projects")
          .objectStore("projects")
          .get("current");
        r.onsuccess = () => res(r.result);
      });
    });
  const settled = () =>
    page.waitForFunction(
      () =>
        document.querySelector("#save-status").textContent === "Sparat lokalt",
    );
  const position = async (x, y, index = 0) => {
    const box = await page.locator("svg.drawing").nth(index).boundingBox();
    const values = await page
      .locator("svg.drawing")
      .nth(index)
      .getAttribute("viewBox");
    const [cx, cy, cw, ch] = values.split(" ").map(Number);
    return {
      x: box.x + ((x - cx) * box.width) / cw,
      y: box.y + ((y - cy) * box.height) / ch,
    };
  };
  const drag = async (a, b) => {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 12 });
    await page.mouse.up();
  };
  const clickPoints = async (a, b) => {
    await page.mouse.click(a.x, a.y);
    await page.mouse.move(b.x, b.y, { steps: 12 });
    await page.mouse.click(b.x, b.y);
  };
  const chooseTool = async (name) => {
    const category = {
      line: "draw",
      rect: "draw",
      circle: "draw",
      freehand: "draw",
      move: "edit",
      copy: "edit",
      trim: "edit",
      extend: "edit",
      dimension: "measure",
      leader: "measure",
      text: "measure",
      scale: "measure",
      crop: "image",
      highlight: "image",
      mask: "image",
    }[name];
    if (category) {
      await page.locator(`[data-category=${category}]`).hover();
      await page.locator(`#tool-flyout [data-tool=${name}]`).click();
    } else await page.locator(`#rail [data-tool=${name}]`).click();
  };
  const draw = async (tool, a, b) => {
    await chooseTool(tool);
    const start = await position(...a),
      end = await position(...b);
    if (tool === "freehand") await drag(start, end);
    else await clickPoints(start, end);
  };
  await settled();
  assert.equal((await store()).clips.length, 2);
  // A card's close button removes that whole card and Undo restores it.
  const beforeClose = await store();
  await page
    .locator(".clip")
    .first()
    .locator("[data-card-action=properties]")
    .click();
  await page.keyboard.press("Escape");
  await page
    .locator(".clip")
    .nth(1)
    .locator("[data-card-action=delete]")
    .click();
  await settled();
  assert.deepEqual((await store()).clips, [beforeClose.clips[0]]);
  await page.locator("[data-action=undo]").click();
  await settled();
  assert.deepEqual((await store()).clips, beforeClose.clips);
  // First-point snapping is visible before clicking, and the saved start remains marked.
  for (const name of [
    "line",
    "rect",
    "circle",
    "dimension",
    "leader",
    "scale",
  ]) {
    await chooseTool(name);
    const first = await position(110, 535);
    await page.mouse.move(first.x + 2, first.y + 2);
    const marker = page
      .locator("svg.drawing")
      .first()
      .locator('[data-snap-marker="snäpp"]');
    await marker.waitFor();
    const box = await marker.evaluate((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    });
    assert.ok(Math.abs(box.x + box.width / 2 - first.x) < 1);
    assert.ok(Math.abs(box.y + box.height / 2 - first.y) < 1);
    await page.mouse.click(first.x + 2, first.y + 2);
    const away = await position(200, 460);
    await page.mouse.move(away.x, away.y);
    await page
      .locator("svg.drawing")
      .first()
      .locator("[data-start-marker]")
      .waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("[data-start-marker]").count(), 0);
    assert.equal((await store()).clips[0].objects.length, 1);
  }
  await chooseTool("line");
  let hover = await position(110, 535);
  await page.mouse.move(hover.x + 2, hover.y + 2);
  await page.locator("#snap-toggle").click();
  await page.locator("#track-toggle").click();
  await page.mouse.move(hover.x + 2, hover.y + 2);
  assert.equal(await page.locator("[data-snap-marker]").count(), 0);
  await page.locator("#snap-toggle").click();
  await page.locator("#track-toggle").click();
  // OTRACK matches LiraCAD: dwell to acquire, retain on guides, expire without contact.
  await chooseTool("line");
  let reference = await position(110, 535),
    aligned = await position(300, 535),
    offGuide = await position(320, 410);
  await page.mouse.move(offGuide.x, offGuide.y);
  await page.mouse.move(reference.x + 2, reference.y + 2);
  await page.waitForTimeout(250);
  assert.equal(await page.locator("[data-track-reference]").count(), 0);
  await page.locator("[data-track-reference]").waitFor({ timeout: 2000 });
  await page.mouse.move(aligned.x, aligned.y);
  await page.locator('[data-snap-marker="otrack"]').waitFor();
  await page.waitForTimeout(1400);
  assert.equal(await page.locator("[data-track-reference]").count(), 1);
  await page.mouse.move(offGuide.x, offGuide.y);
  await page.waitForFunction(
    () => document.querySelectorAll("[data-track-reference]").length === 0,
    {},
    { timeout: 2000 },
  );
  assert.equal(await page.locator('[data-snap-marker="otrack"]').count(), 0);
  await page.keyboard.press("Escape");
  // Exact length under polar control.
  await chooseTool("line");
  await page.locator("#exact-length").fill("1000");
  let start = await position(200, 290),
    end = await position(480, 291);
  await page.mouse.click(start.x, start.y);
  assert.equal((await store()).clips[0].objects.length, 1);
  await page.mouse.move(end.x, end.y, { steps: 12 });
  assert.equal((await store()).clips[0].objects.length, 1);
  await page.mouse.click(end.x, end.y);
  await chooseTool("select");
  await settled();
  let data = await store(),
    line = data.clips[0].objects.at(-1);
  assert.equal(line.type, "line");
  assert.ok(
    Math.abs(Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y) - 100) <
      0.001,
  );
  // Undo / redo.
  await page.locator("[data-action=undo]").click();
  await settled();
  assert.equal((await store()).clips[0].objects.length, 1);
  await page.locator("[data-action=redo]").click();
  await settled();
  assert.equal((await store()).clips[0].objects.length, 2);
  // Calibrate a new scale.
  await draw("scale", [200, 240], [400, 240]);
  await page.locator("#form-dialog[open]").waitFor();
  await page.locator("[name=length]").fill("2000");
  await page.locator("[name=unit]").selectOption("mm");
  await page.locator("#dialog-submit").click();
  await settled();
  data = await store();
  assert.ok(Math.abs(data.clips[0].scale.mmPerPixel - 10) < 0.01);
  // Dimension placement is a separate click.
  await page.locator("#exact-length").fill("");
  await draw("dimension", [150, 380], [500, 380]);
  let p = await position(320, 400);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  await settled();
  assert.equal((await store()).clips[0].objects.at(-1).type, "dimension");
  // Text and edit existing object.
  await chooseTool("text");
  p = await position(330, 185);
  await page.mouse.click(p.x, p.y);
  await page.locator("[name=text]").fill("Ny kommentar <test>");
  await page.locator("#dialog-submit").click();
  await page.locator("[data-property=text]").fill("Uppdaterad kommentar");
  await page.locator("[data-property=text]").blur();
  await settled();
  assert.equal(
    (await store()).clips[0].objects.at(-1).text,
    "Uppdaterad kommentar",
  );
  // Leader, shapes and freehand.
  await draw("leader", [470, 180], [320, 120]);
  await page.locator("[name=text]").fill("Kontrollera måttet");
  await page.locator("#dialog-submit").click();
  await draw("rect", [180, 360], [280, 405]);
  await draw("circle", [420, 450], [450, 470]);
  await draw("freehand", [180, 280], [260, 260]);
  await draw("highlight", [160, 145], [200, 210]);
  await draw("mask", [140, 42], [410, 58]);
  await settled();
  data = await store();
  for (const t of [
    "line",
    "dimension",
    "text",
    "leader",
    "rect",
    "circle",
    "freehand",
    "highlight",
    "mask",
  ])
    assert.ok(
      data.clips[0].objects.some((o) => o.type === t),
      t,
    );
  // Object drag and inspector length update.
  await chooseTool("select");
  p = await position(240, 290);
  await page.mouse.click(p.x, p.y);
  await page.locator("[data-property=length]").fill("1500");
  await page.locator("[data-property=length]").blur();
  await settled();
  data = await store();
  line = data.clips[0].objects.find((o) => o.id === line.id);
  assert.ok(
    Math.abs(Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y) - 150) < 0.1,
  );
  const a = await position(240, 290),
    b = await position(260, 310);
  await drag(a, b);
  await settled();
  data = await store();
  line = data.clips[0].objects.find((o) => o.id === line.id);
  assert.ok(Math.abs(line.a.x - 220) < 0.5);
  // Crop leaves physical calibration intact.
  await draw("crop", [100, 80], [915, 600]);
  await settled();
  data = await store();
  assert.ok(data.clips[0].crop.w < 1000);
  assert.ok(Math.abs(data.clips[0].scale.mmPerPixel - 10) < 0.01);
  await page
    .locator(".clip")
    .first()
    .locator("[data-card-action=properties]")
    .click();
  await page.locator("[data-inspector-action=reset-crop]").click();
  await settled();
  assert.equal((await store()).clips[0].crop.w, 1000);
  await page.locator("[data-inspector-action=close]").click();
  // PNG clipboard promise resolution and PDF export.
  await page.evaluate(() => {
    window.__copies = [];
    Object.defineProperty(navigator, "clipboard", {
      value: {
        write: async (items) => {
          const blob = await items[0].getType("image/png");
          window.__copies.push({ size: blob.size, type: blob.type });
        },
      },
      configurable: true,
    });
  });
  await page
    .locator(".clip")
    .first()
    .locator("[data-card-action=copy]")
    .click();
  await page.waitForFunction(() => window.__copies.length === 1);
  assert.equal(
    (await page.evaluate(() => window.__copies[0])).type,
    "image/png",
  );
  await page.locator("#export-menu").click();
  await page.locator("#export-scope").selectOption("all");
  await page.locator("#export-scale").check();
  const pngDownload = page.waitForEvent("download");
  await page.locator("[data-export=png]").click();
  const png = await pngDownload;
  await png.saveAs("test-results/export.png");
  assert.ok((await readFile("test-results/export.png")).length > 1000);
  await page.locator("#export-menu").click();
  await page.locator("#export-scope").selectOption("all");
  const pdfDownload = page.waitForEvent("download");
  await page.locator("[data-export=pdf]").click();
  const pdf = await pdfDownload;
  await pdf.saveAs("test-results/export.pdf");
  const parsed = await PDFDocument.load(
    await readFile("test-results/export.pdf"),
  );
  assert.equal(parsed.getPageCount(), 1);
  // Reload restores all images and annotations.
  await settled();
  data = await store();
  await page.reload();
  await page.waitForSelector(".clip");
  await settled();
  assert.equal(
    (await store()).clips[0].objects.length,
    data.clips[0].objects.length,
  );
  // Input import and simulated screen capture / rectangular crop.
  await page.locator("#image-input").setInputFiles("test-results/export.png");
  await settled();
  await page.waitForFunction(
    () => document.querySelectorAll(".clip").length === 3,
  );
  await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 640, 480);
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      value: async (options) => {
        window.__captureOptions = options;
        const stream = canvas.captureStream(15);
        window.__captureStream = stream;
        // Simulate the native picker lingering in the initial frames.
        setTimeout(() => {
          ctx.fillStyle = "#147b60";
          ctx.fillRect(0, 0, 640, 480);
        }, 350);
        let i = 0;
        window.__captureTimer = setInterval(() => {
          ctx.fillRect(i++ % 100, 0, 1, 1);
        }, 50);
        return stream;
      },
      configurable: true,
    });
  });
  await page.locator("header [data-action=capture]").click();
  await page.locator("#capture-dialog[open]").waitFor();
  assert.deepEqual(
    await page.evaluate(() => [
      ...document
        .querySelector("#capture-canvas")
        .getContext("2d")
        .getImageData(320, 240, 1, 1).data,
    ]),
    [20, 123, 96, 255],
  );
  assert.equal(
    await page.evaluate(() => window.__captureStream.getTracks()[0].readyState),
    "ended",
  );
  assert.equal(
    await page.evaluate(() => window.__captureOptions.video.displaySurface),
    "monitor",
  );
  assert.equal(await page.locator("#capture-confirm").count(), 0);
  assert.equal(await page.locator("#capture-dialog").innerText(), "×");
  const box = await page.locator("#capture-canvas").boundingBox();
  const captureFactor = box.width / 640;
  await drag(
    { x: box.x + 50 * captureFactor, y: box.y + 60 * captureFactor },
    { x: box.x + 350 * captureFactor, y: box.y + 260 * captureFactor },
  );
  await page.waitForFunction(
    () => document.querySelectorAll(".clip").length === 4,
  );
  await settled();
  data = await store();
  assert.equal(data.clips.at(-1).naturalWidth, 300);
  assert.equal(data.clips.at(-1).naturalHeight, 200);
  await page.evaluate(() => clearInterval(window.__captureTimer));
  // Rail can be dragged and collapsed.
  const rail = await page.locator("#rail-handle").boundingBox();
  await drag(
    { x: rail.x + 20, y: rail.y + 8 },
    { x: rail.x + 40, y: rail.y + 20 },
  );
  assert.ok((await page.locator("#rail").boundingBox()).x > 16);
  await page.locator("#collapse-rail").click();
  assert.equal(await page.locator("#tools").isVisible(), false);
  await page.locator("#collapse-rail").click();
  assert.equal(await page.locator("#tools").isVisible(), true);
  // Save and reopen a project with annotations.
  const projectDownload = page.waitForEvent("download");
  await page.locator("[data-action=save]").click();
  const savedProject = await projectDownload;
  await savedProject.saveAs("test-results/project.lirasnap");
  await page
    .locator("#project-input")
    .setInputFiles("test-results/project.lirasnap");
  await page.locator("#form-dialog[open]").waitFor();
  await page.locator("#dialog-submit").click();
  await settled();
  assert.equal((await store()).clips.length, 4);
  // Verify a clipboard paste imports a real PNG.
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 180;
    canvas.height = 90;
    canvas.getContext("2d").fillRect(0, 0, 180, 90);
    const blob = await new Promise((r) => canvas.toBlob(r));
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([blob], "inklistrad.png", { type: "image/png" }),
    );
    document.body.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await page.waitForFunction(
    () => document.querySelectorAll(".clip").length === 5,
  );
  await settled();
  await page.screenshot({ path: "test-results/workspace.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("[data-action=fit]").click();
  await page.screenshot({ path: "test-results/mobile.png" });
  assert.equal(
    await page.locator("header [data-action=capture]").isVisible(),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: exact scale, undo/redo, all drawing tools, object editing/drag, crop/reset, clipboard PNG, collection PNG/PDF, restore, import, simulated capture/rectangle, movable/collapsible rail.",
  );
} finally {
  await browser.close();
}
