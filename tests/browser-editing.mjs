import { createRequire } from "node:module";
import path from "node:path";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const require = createRequire(
  path.resolve(
    process.env.LIRASNAP_TEST_MODULES || "node_modules",
    "package.json",
  ),
);
const { chromium } = require("playwright");
await mkdir("test-results", { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.LIRASNAP_TEST_URL || "http://localhost:5188");
  const fixture = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 400;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 600, 400);
    const line = (id, a, b) => ({
      id,
      type: "line",
      a,
      b,
      color: "#147b60",
      width: id === "two" ? 5 : 3,
      fontSize: 22,
    });
    return {
      version: 1,
      name: "Redigering",
      clips: [
        {
          id: "fixture",
          name: "Testbild",
          src: canvas.toDataURL("image/png"),
          naturalWidth: 600,
          naturalHeight: 400,
          width: 600,
          x: 140,
          y: 100,
          crop: { x: 0, y: 0, w: 600, h: 400 },
          scale: null,
          objects: [
            line("one", { x: 100, y: 100 }, { x: 160, y: 100 }),
            line("two", { x: 100, y: 130 }, { x: 160, y: 130 }),
            line("cross", { x: 50, y: 80 }, { x: 210, y: 80 }),
            line("boundary", { x: 300, y: 20 }, { x: 300, y: 300 }),
            line("trim", { x: 250, y: 200 }, { x: 350, y: 200 }),
            line("extend", { x: 200, y: 250 }, { x: 250, y: 250 }),
          ],
        },
      ],
    };
  });
  await page.locator("#project-input").setInputFiles({
    name: "fixture.lirasnap",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await page.waitForSelector(".clip");
  const settled = () =>
    page.waitForFunction(
      () =>
        document.querySelector("#save-status").textContent === "Sparat lokalt",
    );
  const store = () =>
    page.evaluate(async () => {
      const db = await new Promise((r) => {
        const req = indexedDB.open("lirasnap-workspace", 1);
        req.onsuccess = () => r(req.result);
      });
      return new Promise((r) => {
        const req = db
          .transaction("projects")
          .objectStore("projects")
          .get("current");
        req.onsuccess = () => r(req.result);
      });
    });
  const point = async (x, y) => {
    const box = await page.locator("svg.drawing").boundingBox();
    return {
      x: box.x + (x * box.width) / 600,
      y: box.y + (y * box.height) / 400,
    };
  };
  const click = async (x, y) => {
    const p = await point(x, y);
    await page.mouse.click(p.x, p.y);
  };
  const choose = async (tool) => {
    if (tool === "select") {
      await page.locator("#rail [data-tool=select]").click();
      return;
    }
    await page.locator("[data-category=edit]").hover();
    await page.locator(`#tool-flyout [data-tool=${tool}]`).click();
  };
  await settled();
  // Category hover opens a flyout and hides it after leaving.
  await page.locator("[data-category=draw]").hover();
  await page.locator("#tool-flyout").waitFor();
  assert.equal(await page.locator("#tool-flyout [data-tool=line]").count(), 1);
  await page.mouse.move(1100, 100);
  await page.waitForTimeout(250);
  assert.equal(await page.locator("#tool-flyout").isVisible(), false);
  // Enclosing window chooses only the two short lines.
  await choose("select");
  await click(90, 90);
  const p = await point(170, 140);
  await page.mouse.move(p.x, p.y);
  await page.locator("[data-selection-window=window]").waitFor();
  await click(170, 140);
  assert.ok(
    (await page.locator("#inspector").innerText()).includes(
      "2 objekt markerade",
    ),
  );
  await page.locator("[data-category=edit]").hover();
  await page.screenshot({ path: "test-results/edit-menu.png" });
  assert.equal(await page.locator("#tool-options").count(), 0);
  const widthField = page.locator("#inspector [data-property=width]");
  assert.equal(await widthField.inputValue(), "");
  assert.equal(await widthField.getAttribute("placeholder"), "Blandat");
  await widthField.fill("9");
  await widthField.blur();
  await settled();
  const afterWidth = (await store()).clips[0].objects;
  assert.equal(afterWidth.find((o) => o.id === "one").width, 9);
  assert.equal(afterWidth.find((o) => o.id === "two").width, 9);
  assert.equal(afterWidth.find((o) => o.id === "cross").width, 3);
  assert.equal(await widthField.inputValue(), "9");
  await page.locator("#inspector [data-property=color]").fill("#ee3344");
  await page.locator("#inspector [data-property=color]").blur();
  await settled();
  assert.equal(
    (await store()).clips[0].objects.find((o) => o.id === "one").color,
    "#ee3344",
  );
  assert.equal(
    (await store()).clips[0].objects.find((o) => o.id === "two").color,
    "#ee3344",
  );
  await page.locator("[data-action=undo]").click();
  await settled();
  await page.locator("[data-action=undo]").click();
  await settled();
  assert.equal(
    (await store()).clips[0].objects.find((o) => o.id === "one").width,
    3,
  );
  assert.equal(
    (await store()).clips[0].objects.find((o) => o.id === "two").width,
    5,
  );
  // Undo clears selection, so select the same pair again before Move.
  await click(90, 90);
  await click(170, 140);
  await choose("move");
  await click(100, 100);
  await click(120, 160);
  await settled();
  let data = await store();
  assert.ok(
    Math.abs(data.clips[0].objects.find((o) => o.id === "one").a.y - 160) <
      0.01,
  );
  assert.ok(
    Math.abs(data.clips[0].objects.find((o) => o.id === "two").a.y - 190) <
      0.01,
  );
  await choose("copy");
  await click(120, 160);
  await click(220, 160);
  await settled();
  assert.equal((await store()).clips[0].objects.length, 8);
  await click(220, 180);
  await settled();
  assert.equal((await store()).clips[0].objects.length, 10);
  await page.keyboard.press("Escape");
  await page.locator("[data-action=undo]").click();
  await settled();
  assert.equal((await store()).clips[0].objects.length, 8);
  await page.locator("[data-action=undo]").click();
  await settled();
  assert.equal((await store()).clips[0].objects.length, 6);
  // Crossing selection includes the longer line passing through the box.
  await choose("select");
  await click(170, 90);
  await click(90, 70);
  assert.ok((await page.locator("#inspector").innerText()).includes("Linje"));
  await page.keyboard.press("Escape");
  await choose("trim");
  await click(300, 110);
  await click(330, 200);
  await settled();
  data = await store();
  assert.ok(
    Math.abs(data.clips[0].objects.find((o) => o.id === "trim").b.x - 300) <
      0.01,
  );
  await choose("extend");
  await click(245, 250);
  await settled();
  data = await store();
  assert.ok(
    Math.abs(data.clips[0].objects.find((o) => o.id === "extend").b.x - 300) <
      0.01,
  );
  await page.locator("[data-action=undo]").click();
  await settled();
  assert.equal(
    (await store()).clips[0].objects.find((o) => o.id === "extend").b.x,
    250,
  );
  await page.locator("[data-action=undo]").click();
  await settled();
  assert.equal(
    (await store()).clips[0].objects.find((o) => o.id === "trim").b.x,
    350,
  );
  // Empty selection can be built within Move, then confirmed by Enter.
  await page.keyboard.press("Escape");
  await choose("move");
  await click(110, 150);
  await click(190, 200);
  assert.ok(
    (await page.locator("#inspector").innerText()).includes(
      "2 objekt markerade",
    ),
  );
  await page.keyboard.press("Enter");
  await click(120, 160);
  await page.keyboard.press("Escape");
  await settled();
  assert.ok(
    Math.abs(
      (await store()).clips[0].objects.find((o) => o.id === "one").a.y - 160,
    ) < 0.01,
  );
  // Esc cancels unfinished geometry and returns every tool to Select.
  const beforeEscape = await store();
  for (const key of ["l", "r", "c", "d", "s", "b", "h", "m"]) {
    await page.keyboard.press(key);
    await click(400, 50);
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator("#rail [data-tool=select]").getAttribute("class"),
      "active",
    );
    await page.keyboard.press("Escape");
  }
  assert.deepEqual(
    (await store()).clips[0].objects,
    beforeEscape.clips[0].objects,
  );
  // Esc also works while a text dialog has focus, keeping native cancellation.
  await page.keyboard.press("t");
  await click(400, 50);
  await page.locator("#form-dialog[open] textarea").waitFor();
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => !document.querySelector("#form-dialog").open,
  );
  assert.equal(
    await page.locator("#rail [data-tool=select]").getAttribute("class"),
    "active",
  );
  assert.deepEqual(
    (await store()).clips[0].objects,
    beforeEscape.clips[0].objects,
  );
  // The same panel controls new objects without changing existing ones.
  await page.keyboard.press("l");
  await page.locator("#inspector [data-default=width]").fill("7");
  await page.locator("#inspector [data-default=width]").blur();
  assert.deepEqual(
    (await store()).clips[0].objects,
    beforeEscape.clips[0].objects,
  );
  await click(400, 50);
  await click(450, 50);
  await settled();
  assert.equal((await store()).clips[0].objects.at(-1).width, 7);
  await page.keyboard.press("Escape");
  // A mixed selection changes text size only on text-bearing objects.
  const mixedFixture = structuredClone(fixture);
  Object.assign(mixedFixture.clips[0].objects[0], {
    type: "text",
    text: "Hej",
  });
  Object.assign(mixedFixture.clips[0].objects[1], {
    type: "leader",
    text: "Två",
    fontSize: 30,
  });
  await page.locator("#project-input").setInputFiles({
    name: "mixed.lirasnap",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(mixedFixture)),
  });
  await page.locator("#form-dialog[open] #dialog-submit").click();
  await page.waitForFunction(
    () => document.querySelector("svg.drawing text")?.textContent === "Hej",
  );
  await choose("select");
  await click(30, 50);
  await click(280, 155);
  const fontField = page.locator("#inspector [data-property=fontSize]");
  assert.equal(await fontField.inputValue(), "");
  await fontField.fill("24");
  await fontField.blur();
  await settled();
  const mixedObjects = (await store()).clips[0].objects;
  assert.equal(mixedObjects.find((o) => o.id === "one").fontSize, 24);
  assert.equal(mixedObjects.find((o) => o.id === "two").fontSize, 24);
  assert.equal(mixedObjects.find((o) => o.id === "cross").fontSize, 22);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: category hover, window/crossing selection, bulk style and undo, drawing defaults, mixed text sizes, Move/Copy, Trim/Extend and Escape.",
  );
} finally {
  await browser.close();
}
