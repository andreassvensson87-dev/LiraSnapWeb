import { setupPWA, consumeShortcutAction } from "./pwa.js";
import { selectWindow, trimLine, extendLine } from "./editing.js";
import {
  renderToolMenu,
  initializeToolMenu,
  closeToolMenu,
} from "./tool-menu.js";
import {
  UNITS,
  uid,
  distance,
  rectFrom,
  calibrate,
  formatLength,
  snapPoint,
  translateObject,
  dimensionGeometry,
  cropClip,
  validateProject,
  escapeHTML as esc,
} from "./core.js";
import { TrackingReferences } from "./tracking.js";
import { annotationMarkup, imageMarkup, objectMarkup } from "./render.js";
import { loadWorkspace, saveWorkspace } from "./storage.js";
import {
  loadImage,
  canvasBlob,
  renderCollection,
  jpegPDF,
  download,
} from "./export.js";
import { icon, TOOLS } from "./icons.js";
const $ = (selector) => document.querySelector(selector);
const workspace = $("#workspace"),
  board = $("#board");
let project = { version: 1, name: "Namnlöst projekt", clips: [] };
let activeId = null,
  selectedId = null,
  tool = "select",
  gesture = null,
  dimensionPending = null,
  drawPending = null,
  hoverClipId = null,
  showClipProperties = false,
  spaceDown = false;
let view = { x: 0, y: 0, zoom: 1 },
  aids = { snap: true, polar: true, track: true };
let undoStack = [],
  redoStack = [],
  saveChain = Promise.resolve(),
  saveRevision = 0,
  toastTimer,
  menu = null,
  dragCounter = 0,
  importing = false;
const getClip = (id) => project.clips.find((c) => c.id === (id || activeId));
const getObject = () => getClip()?.objects.find((o) => o.id === selectedId);
const clone = (value) => structuredClone(value);
let selectedIds = new Set(),
  selectionClipId = null,
  boxPending = null,
  operation = null;
function clearSelection() {
  selectedId = null;
  selectedIds.clear();
  selectionClipId = null;
}
function setSelection(ids, clipId = activeId) {
  selectedIds = new Set(ids);
  selectedId = ids.at(-1) || null;
  selectionClipId = clipId;
}
function selectedObjects(c = getClip()) {
  return (
    c?.objects.filter(
      (o) => selectionClipId === c.id && selectedIds.has(o.id),
    ) || []
  );
}
function selectionMarkup(c) {
  return c.id === activeId && selectedIds.size ? [...selectedIds] : "__hit__";
}
const editingTool = () => ["move", "copy", "trim", "extend"].includes(tool);

function toast(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 4200);
}
function status(message) {
  $("#status").textContent = message;
}
function snapshot() {
  return clone(project);
}
function remember(before = snapshot()) {
  undoStack.push(before);
  if (undoStack.length > 40) undoStack.shift();
  redoStack = [];
}
function changed() {
  queueSave();
  render();
}
function queueSave() {
  $("#save-status").textContent = "Sparar…";
  const revision = ++saveRevision,
    data = snapshot();
  saveChain = saveChain
    .catch(() => {})
    .then(() => saveWorkspace(data))
    .then(() => {
      if (revision === saveRevision)
        $("#save-status").textContent = "Sparat lokalt";
    })
    .catch(() => {
      if (revision === saveRevision) {
        $("#save-status").textContent = "Ej sparat";
        toast("Autosparandet misslyckades. Spara projektet som fil.");
      }
    });
}
function activate(id, objectId = null) {
  activeId = id;
  setSelection(objectId ? [objectId] : [], id);
  showClipProperties = false;
  render();
}
function chooseTool(next) {
  cancelGesture();
  tool = next;
  closeMenu();
  closeToolMenu();
  if (["move", "copy"].includes(next))
    operation = {
      kind: next,
      clipId: activeId,
      phase: selectedObjects().length ? "base" : "select",
      base: null,
    };
  if (["trim", "extend"].includes(next))
    operation = {
      kind: next,
      clipId: activeId,
      boundaries: selectedObjects()
        .filter((o) => ["line", "rect", "circle"].includes(o.type))
        .map((o) => o.id),
    };
  render();
  status(toolHint());
}
function toolHint() {
  const hints = {
    select: "Klicka objekt eller två hörn · Shift lägger till i markeringen",
    move:
      operation?.phase === "select"
        ? "Markera objekt · Enter fortsätter"
        : "Klicka baspunkt och destination",
    copy:
      operation?.phase === "select"
        ? "Markera objekt · Enter fortsätter"
        : "Klicka baspunkt och placera kopior · Esc avslutar",
    trim: operation?.boundaries?.length
      ? "Klicka den linjedel som ska tas bort · Shift lägger till gränser"
      : "Klicka en gränslinje, rektangel eller cirkel",
    extend: operation?.boundaries?.length
      ? "Klicka linjen nära änden som ska förlängas"
      : "Klicka en gränslinje, rektangel eller cirkel",
    line: "Klicka startpunkt och slutpunkt · ange en exakt längd vid behov",
    rect: "Klicka rektangelns två motsatta hörn",
    circle: "Klicka centrum och sedan cirkelns kant",
    freehand: "Håll ned och rita fritt",
    dimension: "Klicka två punkter · klicka sedan för att placera måttlinjen",
    leader: "Klicka pilspets och sedan textens placering",
    text: "Klicka där texten ska börja",
    scale: "Klicka två punkter med en känd längd",
    crop: "Klicka två hörn i området som ska behållas",
    mask: "Klicka två hörn för att maskera ett område",
    highlight: "Klicka två hörn i området som ska färgmarkeras",
  };
  return project.clips.length
    ? hints[tool]
    : "Lägg till en bild, klistra in eller prova exempelritningen";
}
function render() {
  $("#welcome").hidden = project.clips.length > 0;
  $("#project-name").textContent = project.name;
  if (!getClip()) {
    activeId = project.clips.at(-1)?.id || null;
    clearSelection();
  }
  if (selectedId && !getObject()) clearSelection();
  board.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.zoom})`;
  board.innerHTML = project.clips
    .map((c, index) => {
      const active = c.id === activeId;
      return `<article class="clip ${active ? "active" : ""}" data-clip="${esc(c.id)}" style="left:${c.x}px;top:${c.y}px;width:${c.width}px;z-index:${active ? project.clips.length + 1 : index + 1}">
   <div class="clip-header"><span class="clip-number">${String(index + 1).padStart(2, "0")}</span><span class="clip-name" title="${esc(c.name)}">${esc(c.name)}</span><button class="scale-badge ${c.scale ? "" : "unset"}" data-card-action="scale" title="Ange eller ändra skala">${c.scale ? `1 px = ${Number((c.scale.mmPerPixel / UNITS[c.scale.unit]).toFixed(3)).toLocaleString("sv-SE")} ${c.scale.unit}` : "Sätt skala"}</button><button data-card-action="properties" title="Klippets egenskaper" aria-label="Klippets egenskaper">${icon("settings")}</button><button data-card-action="copy" title="Kopiera klippet" aria-label="Kopiera klippet">${icon("copy")}</button></div>
   <svg class="drawing" viewBox="${c.crop.x} ${c.crop.y} ${c.crop.w} ${c.crop.h}" width="${c.crop.w}" height="${c.crop.h}" style="cursor:${tool === "select" ? "default" : "crosshair"}" aria-label="${esc(c.name)}"><g class="image-layer" pointer-events="none">${imageMarkup(c)}</g><g class="annotation-layer">${annotationMarkup(c, tool === "select" || editingTool() ? selectionMarkup(c) : null, (c.width / c.crop.w) * view.zoom)}</g><g class="preview-layer" pointer-events="none"></g></svg>
   <div class="clip-resize" title="Ändra klippets storlek på arbetsytan"></div></article>`;
    })
    .join("");
  renderToolMenu(tool);
  $("#tool-title").textContent = TOOLS.find((t) => t[0] === tool)[1];
  $("#length-option").hidden = ![
    "line",
    "dimension",
    "leader",
    "circle",
  ].includes(tool);
  $("#length-unit").textContent = getClip()?.scale?.unit || "mm";
  $("#exact-length").disabled = !getClip()?.scale;
  $("#exact-length").title = getClip()?.scale
    ? "Längd i klippets enhet"
    : "Ange skala för att rita med exakt längd";
  $("#zoom-label").textContent = `${Math.round(view.zoom * 100)}%`;
  $("#clip-tray").hidden = !project.clips.length;
  $("#clip-list").innerHTML = project.clips
    .map(
      (c, i) =>
        `<button data-focus="${esc(c.id)}" class="${c.id === activeId ? "active" : ""}" title="${esc(c.name)}"><img src="${esc(c.src)}" alt="">${String(i + 1).padStart(2, "0")}</button>`,
    )
    .join("");
  $("[data-action=undo]").disabled = !undoStack.length;
  $("[data-action=redo]").disabled = !redoStack.length;
  $("#export-menu").disabled = !project.clips.length;
  for (const key of ["snap", "polar", "track"])
    $(`#${key}-toggle`).setAttribute("aria-pressed", String(aids[key]));
  renderInspector();
}
function renderDrawing(c) {
  const svg = board.querySelector(`[data-clip="${c.id}"] svg.drawing`);
  if (!svg) return;
  svg.querySelector(".annotation-layer").innerHTML = annotationMarkup(
    c,
    tool === "select" || editingTool() ? selectionMarkup(c) : null,
    (c.width / c.crop.w) * view.zoom,
  );
}
function renderInspector() {
  const panel = $("#inspector"),
    c = getClip(),
    o = getObject();
  const selection = selectedObjects(c);
  if (selection.length > 1) {
    panel.hidden = false;
    panel.innerHTML = `<button class="inspector-close" data-inspector-action="close" aria-label="Stäng egenskaper">×</button><h3>${selection.length} objekt markerade</h3><p>Flytta eller kopiera markeringen med en baspunkt och en destination.</p><div class="row"><button data-tool="move">Flytta</button><button data-tool="copy">Kopiera</button></div><div class="row" style="margin-top:8px"><button data-inspector-action="duplicate">Duplicera</button><button data-inspector-action="delete" class="danger">Ta bort</button></div>`;
    return;
  }
  panel.hidden = !o && !showClipProperties;
  if (panel.hidden) return;
  if (o) {
    const label = TOOLS.find((t) => t[0] === o.type)?.[1] || "Objekt";
    panel.innerHTML = `<button class="inspector-close" data-inspector-action="close" aria-label="Stäng egenskaper">×</button><h3>${label}</h3>
  ${["text", "leader"].includes(o.type) ? `<label>Text<textarea data-property="text">${esc(o.text)}</textarea></label>` : ""}
  <div class="row"><label>Färg<input type="color" data-property="color" value="${o.color}"></label><label>Linjebredd<input type="number" min="1" max="100" data-property="width" value="${o.width}"></label></div>
  ${["text", "leader", "dimension"].includes(o.type) ? `<label>Textstorlek<input type="number" min="8" max="200" data-property="fontSize" value="${o.fontSize}"></label>` : ""}
  ${["line", "dimension", "leader", "circle"].includes(o.type) ? `<label>${o.type === "circle" ? "Radie" : "Längd"} (${c.scale?.unit || "px"})<input type="number" min="0.001" step="any" data-property="length" value="${Number((distance(o.a, o.b) * (c.scale ? c.scale.mmPerPixel / UNITS[c.scale.unit] : 1)).toFixed(3))}"></label>` : ""}
  ${o.type === "mask" ? "<p>Maskeringen bakas in i PNG/PDF. Den redigerbara projektfilen behåller originalbilden.</p>" : ""}<div class="row"><button data-inspector-action="duplicate">Duplicera</button><button data-inspector-action="delete" class="danger">Ta bort</button></div>`;
  } else {
    panel.innerHTML = `<button class="inspector-close" data-inspector-action="close" aria-label="Stäng egenskaper">×</button><h3>Skärmklipp</h3><label>Namn<input data-clip-property="name" value="${esc(c.name)}" maxlength="100"></label><div class="row"><label>Enhet<select data-clip-property="unit">${Object.keys(
      UNITS,
    )
      .map(
        (u) => `<option ${c.scale?.unit === u ? "selected" : ""}>${u}</option>`,
      )
      .join(
        "",
      )}</select></label><label>Bredd på ytan<input type="number" min="80" max="3000" data-clip-property="width" value="${Math.round(c.width)}"></label></div><p class="scale-info">${c.scale ? `${formatLength(1, c.scale)} per bildpixel · kalibrerad` : "Ingen skala angiven · mått visas i pixlar"}</p><div class="row"><button data-inspector-action="scale">Sätt skala</button><button data-inspector-action="reset-crop">Återställ beskärning</button></div><p>${Math.round(c.crop.w)} × ${Math.round(c.crop.h)} bildpixlar. Bilden är låst när du ritar.</p><div class="row"><button data-inspector-action="duplicate-clip">Duplicera</button><button data-inspector-action="delete-clip" class="danger">Ta bort klipp</button></div>`;
  }
}
function cardElement(c) {
  return board.querySelector(`[data-clip="${c.id}"]`);
}
function imagePoint(event, c) {
  const svg = cardElement(c).querySelector("svg.drawing"),
    rect = svg.getBoundingClientRect();
  return {
    x: c.crop.x + ((event.clientX - rect.left) / rect.width) * c.crop.w,
    y: c.crop.y + ((event.clientY - rect.top) / rect.height) * c.crop.h,
  };
}
function boardPoint(event) {
  const rect = workspace.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left - view.x) / view.zoom,
    y: (event.clientY - rect.top - view.y) / view.zoom,
  };
}
const trackingState = new TrackingReferences();
let trackingClipId = null,
  trackingCursor = null;
function clearTracking() {
  trackingState.clear();
  trackingClipId = null;
  trackingCursor = null;
}
function constrained(event, c, start, exact = false, exclude = null) {
  if (trackingClipId !== c.id) {
    clearTracking();
    trackingClipId = c.id;
  }
  const rect = cardElement(c)
    .querySelector("svg.drawing")
    .getBoundingClientRect();
  const inside =
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom;
  const enabled = aids.track && aids.snap && inside;
  trackingCursor = inside
    ? {
        clipId: c.id,
        event: {
          clientX: event.clientX,
          clientY: event.clientY,
          shiftKey: event.shiftKey,
        },
        start,
        exact,
        exclude,
      }
    : null;
  const resolve = () =>
    snapPoint(
      imagePoint(event, c),
      start,
      c,
      {
        ...aids,
        track: enabled,
        anchors: trackingState.points,
        ortho: event.shiftKey,
        polar: aids.polar || event.shiftKey,
      },
      ((8 / view.zoom) * c.crop.w) / c.width,
      exact ? Number($("#exact-length").value) || 0 : 0,
      exclude,
    );
  let snapping = resolve();
  if (enabled) {
    const changed = trackingState.update({
      candidate: snapping.kind === "snäpp" ? snapping.point : null,
      contacts:
        snapping.kind === "otrack" ? snapping.guides.map((g) => g.a) : [],
      now: performance.now(),
    });
    if (changed) snapping = resolve();
  } else if (!aids.track || !aids.snap) trackingState.clear();
  else trackingState.update({ now: performance.now() });
  snapping.references = trackingState.points;
  snapping.acquired =
    snapping.kind === "snäpp" &&
    trackingState.points.some((p) => distance(p, snapping.point) < 1e-7);
  return snapping;
}
// Acquisition and expiry also advance when the pointer is stationary.
setInterval(() => {
  if (!trackingState.pending && !trackingState.points.length) return;
  const cursor = trackingCursor,
    c = cursor && getClip(cursor.clipId);
  if (
    !c ||
    (tool === "select" && !gesture?.grip) ||
    document.querySelector("dialog[open]")
  ) {
    const changed = trackingState.update({ now: performance.now() });
    if (changed) {
      for (const marker of board.querySelectorAll("[data-track-reference]")) {
        const p = {
          x: Number(marker.dataset.trackX),
          y: Number(marker.dataset.trackY),
        };
        if (!trackingState.points.some((ref) => distance(ref, p) < 1e-7))
          marker.remove();
      }
    }
    return;
  }
  if (operation?.base && operation.clipId === c.id)
    previewTransform(cursor.event, c);
  else if (drawPending?.clipId === c.id)
    updateDraft(cursor.event, c, drawPending.object);
  else if (gesture?.type === "draw" && gesture.clipId === c.id)
    updateDraft(cursor.event, c, gesture.object);
  else if (
    gesture?.type === "object" &&
    gesture.grip &&
    gesture.grip !== "offset" &&
    gesture.clipId === c.id
  ) {
    const snapping = constrained(
      cursor.event,
      c,
      cursor.start,
      cursor.exact,
      cursor.exclude,
    );
    const o = c.objects.find((o) => o.id === gesture.objectId);
    if (o) {
      o[gesture.grip] = snapping.point;
      renderDrawing(c);
      preview(c, null, snapping);
    }
  } else if (!gesture && !dimensionPending) {
    const snapping = constrained(
      cursor.event,
      c,
      cursor.start,
      cursor.exact,
      cursor.exclude,
    );
    preview(c, null, snapping);
    status(
      snapping.acquired
        ? "Snäpp · referens fångad"
        : snapping.kind
          ? `${snapping.kind.toUpperCase()} · klicka för att sätta första punkten`
          : toolHint(),
    );
  } else trackingState.update({ now: performance.now() });
}, 100);
function styleObject(type, a, b) {
  return {
    id: uid(),
    type,
    a: { ...a },
    b: { ...b },
    color: type === "mask" ? "#263d43" : $("#color").value,
    width: Number($("#line-width").value),
    fontSize: Number($("#font-size").value),
    ...(type === "freehand" ? { points: [{ ...a }] } : {}),
    ...(type === "dimension" ? { offset: 30 } : {}),
    ...(["text", "leader"].includes(type) ? { text: "" } : {}),
  };
}
function preview(c, o, snapping = null) {
  const svg = cardElement(c)?.querySelector(".preview-layer");
  if (!svg) return;
  let body = o ? objectMarkup(o, c.scale) : "";
  const screenPixel = c.crop.w / c.width / view.zoom;
  if (o && (drawPending?.clipId === c.id || dimensionPending?.clipId === c.id))
    body += `<circle data-start-marker cx="${o.a.x}" cy="${o.a.y}" r="${3.5 * screenPixel}" fill="white" stroke="#147b60" stroke-width="${1.8 * screenPixel}"/>`;
  if (snapping) {
    for (const point of snapping.references || []) {
      const f = screenPixel;
      body += `<g data-track-reference data-track-x="${point.x}" data-track-y="${point.y}"><path d="M${point.x - 5 * f} ${point.y}H${point.x + 5 * f}M${point.x} ${point.y - 5 * f}V${point.y + 5 * f}" fill="none" stroke="white" stroke-width="${4 * f}"/><path d="M${point.x - 5 * f} ${point.y}H${point.x + 5 * f}M${point.x} ${point.y - 5 * f}V${point.y + 5 * f}" fill="none" stroke="#147b60" stroke-width="${2 * f}"/></g>`;
    }
    const factor = c.crop.w / c.width / view.zoom;
    body += snapping.guides
      .map(
        (g) =>
          `<line x1="${g.a.x}" y1="${g.a.y}" x2="${g.b.x}" y2="${g.b.y}" stroke="#45ad89" stroke-width="${factor}" stroke-dasharray="${4 * factor} ${4 * factor}"/>`,
      )
      .join("");
    if (snapping.kind)
      body += `<g data-snap-marker="${esc(snapping.kind)}"><rect x="${snapping.point.x - 6 * factor}" y="${snapping.point.y - 6 * factor}" width="${12 * factor}" height="${12 * factor}" fill="none" stroke="white" stroke-width="${4 * factor}"/><rect x="${snapping.point.x - 6 * factor}" y="${snapping.point.y - 6 * factor}" width="${12 * factor}" height="${12 * factor}" fill="none" stroke="#147b60" stroke-width="${2 * factor}"/></g>`;
  }
  svg.innerHTML = body;
}
function previewWindow(c, b) {
  const r = rectFrom(boxPending.a, b),
    crossing = b.x < boxPending.a.x,
    color = crossing ? "#147b60" : "#4d91c9",
    f = c.crop.w / c.width / view.zoom;
  cardElement(c).querySelector(".preview-layer").innerHTML =
    `<rect data-selection-window="${crossing ? "crossing" : "window"}" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${color}" fill-opacity=".12" stroke="${color}" stroke-width="${f}" ${crossing ? `stroke-dasharray="${5 * f} ${3 * f}"` : ""}/>`;
}
function previewTransform(event, c) {
  const snapping = constrained(event, c, operation.base),
    delta = {
      x: snapping.point.x - operation.base.x,
      y: snapping.point.y - operation.base.y,
    };
  preview(c, null, snapping);
  const layer = cardElement(c).querySelector(".preview-layer");
  layer.insertAdjacentHTML(
    "afterbegin",
    `<g data-transform-preview opacity=".65">${operation.originals.map((o) => objectMarkup(translateObject(o, delta.x, delta.y), c.scale)).join("")}</g>`,
  );
  status(
    `${tool === "copy" ? "Kopiera" : "Flytta"} · ${formatLength(distance(operation.base, snapping.point), c.scale)} · klicka destination`,
  );
  return delta;
}
async function editClick(event, c) {
  if (["move", "copy"].includes(tool)) {
    if (!operation.base) {
      const objects = selectedObjects(c);
      if (!objects.length) {
        operation.phase = "select";
        status(toolHint());
        return;
      }
      operation.base = constrained(event, c, null).point;
      operation.originals = objects.map(clone);
      status("Klicka destination · Esc avbryter");
      return;
    }
    const delta = previewTransform(event, c);
    if (Math.hypot(delta.x, delta.y) < 0.001) return;
    remember();
    const originals = operation.originals;
    if (tool === "copy") {
      c.objects.push(
        ...originals.map((o) => ({
          ...translateObject(o, delta.x, delta.y),
          id: uid(),
        })),
      );
      changed();
      status("Klicka fler destinationer · Esc avslutar");
    } else {
      for (const original of originals)
        Object.assign(
          c.objects.find((o) => o.id === original.id),
          translateObject(original, delta.x, delta.y),
        );
      operation = null;
      tool = "select";
      changed();
      status(toolHint());
    }
    return;
  }
  const hit = event.target.closest("[data-object]"),
    o = c.objects.find((o) => o.id === hit?.dataset.object);
  if (!o) return;
  if (!operation.boundaries.length || event.shiftKey) {
    if (!["line", "rect", "circle"].includes(o.type)) {
      toast("Välj en linje, rektangel eller cirkel som gräns.");
      return;
    }
    operation.boundaries = [...new Set([...operation.boundaries, o.id])];
    setSelection(operation.boundaries, c.id);
    render();
    status(toolHint());
    return;
  }
  if (operation.boundaries.includes(o.id)) return;
  if (o.type !== "line") {
    toast("Trimma och förläng används på linjer.");
    return;
  }
  const boundaries = c.objects.filter((item) =>
      operation.boundaries.includes(item.id),
    ),
    pick = imagePoint(event, c);
  const result =
    tool === "trim"
      ? trimLine(o, boundaries, pick)
      : extendLine(o, boundaries, pick);
  if (!result) {
    toast(
      tool === "trim"
        ? "Linjen korsar inte den valda gränsen."
        : "Ingen gräns hittades i förlängningens riktning.",
    );
    return;
  }
  remember();
  if (tool === "trim") {
    const index = c.objects.indexOf(o);
    c.objects.splice(
      index,
      1,
      ...result.map((piece, i) => ({ ...piece, id: i ? uid() : o.id })),
    );
  } else Object.assign(o, result);
  changed();
  status(toolHint());
}

function cancelGesture() {
  clearTracking();
  boxPending = null;
  operation = null;
  if (gesture?.before) project = gesture.before;
  gesture = null;
  dimensionPending = null;
  drawPending = null;
  hoverClipId = null;
  render();
}
async function ask({ title, description = "", fields = [], submit = "Spara" }) {
  const dialog = $("#form-dialog");
  if (dialog.open) return null;
  $("#dialog-title").textContent = title;
  $("#dialog-description").textContent = description;
  $("#dialog-description").hidden = !description;
  $("#dialog-submit").textContent = submit;
  $("#dialog-fields").innerHTML = fields
    .map(
      (f) =>
        `<label>${esc(f.label)}${f.options ? `<select name="${f.name}">${f.options.map((v) => `<option value="${esc(v)}" ${f.value === v ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>` : f.multiline ? `<textarea name="${f.name}" ${f.required ? "required" : ""} maxlength="10000">${esc(f.value || "")}</textarea>` : `<input name="${f.name}" type="${f.type || "text"}" value="${esc(f.value ?? "")}" ${f.min != null ? `min="${f.min}"` : ""} ${f.type === "number" ? 'step="any"' : ""} ${f.required ? "required" : ""} maxlength="120">`}</label>`,
    )
    .join("");
  dialog
    .querySelectorAll("[value=cancel]")
    .forEach((b) => (b.formNoValidate = true));
  dialog.returnValue = "cancel";
  dialog.showModal();
  setTimeout(() => dialog.querySelector("input,textarea,select")?.focus(), 0);
  return new Promise((resolve) =>
    dialog.addEventListener(
      "close",
      () =>
        resolve(
          dialog.returnValue === "confirm"
            ? Object.fromEntries(new FormData(dialog.querySelector("form")))
            : null,
        ),
      { once: true },
    ),
  );
}
async function scaleDialog(c, a, b) {
  const result = await ask({
    title: "Ange en känd längd",
    description: `Referensen är ${Math.round(distance(a, b))} bildpixlar. Ange det verkliga avståndet mellan punkterna.`,
    fields: [
      {
        name: "length",
        label: "Verklig längd",
        type: "number",
        min: 0.000001,
        required: true,
        value: c.scale?.length || "",
      },
      {
        name: "unit",
        label: "Enhet",
        options: ["mm", "cm", "m"],
        value: c.scale?.unit || "mm",
      },
    ],
    submit: "Sätt skala",
  });
  if (!result || !getClip(c.id)) return;
  try {
    const scale = calibrate(a, b, Number(result.length), result.unit);
    remember();
    c.scale = scale;
    changed();
    toast(
      "Skalan är satt. Mått och exakta längder använder den här referensen.",
    );
    chooseTool("line");
  } catch (error) {
    toast(error.message);
  }
}
workspace.addEventListener("pointerdown", async (event) => {
  if (event.button !== 0 && event.button !== 1) return;
  if (
    event.target.closest(
      ".lira-rail,.tool-flyout,.tool-options,.inspector,.view-controls,.clip-tray,.welcome",
    )
  )
    return;
  const card = event.target.closest(".clip"),
    c = card ? getClip(card.dataset.clip) : null;
  if (spaceDown || event.button === 1 || !c) {
    if (event.target.closest("button")) return;
    gesture = {
      type: "pan",
      start: { x: event.clientX, y: event.clientY },
      view: { ...view },
    };
    event.preventDefault();
    return;
  }
  if (event.target.closest("[data-card-action]")) return;
  if (c.id !== activeId) {
    boxPending = null;
    operation = null;
    clearTracking();
    activeId = c.id;
    clearSelection();
    showClipProperties = false;
  }
  if (event.target.closest(".clip-header")) {
    gesture = {
      type: "card",
      clipId: c.id,
      start: boardPoint(event),
      initial: { x: c.x, y: c.y },
      before: snapshot(),
    };
    render();
    return;
  }
  if (event.target.closest(".clip-resize")) {
    gesture = {
      type: "resize",
      clipId: c.id,
      start: { x: event.clientX, y: event.clientY },
      initial: c.width,
      before: snapshot(),
    };
    return;
  }
  if (!event.target.closest(".drawing")) return;
  event.preventDefault();
  if (dimensionPending) {
    const o = dimensionPending.object,
      original = getClip(dimensionPending.clipId);
    if (original?.id !== c.id) {
      dimensionPending = null;
    } else {
      const pt = imagePoint(event, c);
      o.offset =
        ((pt.x - o.a.x) * -(o.b.y - o.a.y) + (pt.y - o.a.y) * (o.b.x - o.a.x)) /
        (distance(o.a, o.b) || 1);
      remember();
      original.objects.push(o);
      dimensionPending = null;
      setSelection([o.id], c.id);
      tool = "select";
      changed();
      status(toolHint());
      return;
    }
  }
  if (editingTool() && operation?.clipId !== c.id) {
    operation = ["move", "copy"].includes(tool)
      ? { kind: tool, clipId: c.id, phase: "select", base: null }
      : { kind: tool, clipId: c.id, boundaries: [] };
  }
  if (editingTool() && !(operation.phase === "select")) {
    await editClick(event, c);
    return;
  }
  if (tool === "select" || operation?.phase === "select") {
    if (boxPending && boxPending.clipId === c.id) {
      const ids = selectWindow(c.objects, boxPending.a, imagePoint(event, c));
      setSelection(
        boxPending.add ? [...new Set([...selectedIds, ...ids])] : ids,
        c.id,
      );
      boxPending = null;
      render();
      status(
        `${selectedObjects(c).length} objekt markerade${editingTool() ? " · Enter fortsätter" : ""}`,
      );
      return;
    }
    const hit = event.target.closest("[data-object]");
    if (hit) {
      const id = hit.dataset.object;
      if (event.shiftKey) {
        const ids = new Set(selectedIds);
        ids.has(id) ? ids.delete(id) : ids.add(id);
        setSelection([...ids], c.id);
        render();
        return;
      }
      if (!selectedIds.has(id)) setSelection([id], c.id);
      else selectedId = id;
      showClipProperties = false;
      if (tool === "select") {
        const object = c.objects.find((o) => o.id === id);
        gesture = {
          type: "object",
          clipId: c.id,
          objectId: id,
          grip: hit.dataset.grip,
          start: imagePoint(event, c),
          object: clone(object),
          objects: selectedObjects(c).map(clone),
          before: snapshot(),
        };
      }
      render();
      return;
    }
    if (!event.shiftKey) clearSelection();
    clearTracking();
    boxPending = { clipId: c.id, a: imagePoint(event, c), add: event.shiftKey };
    render();
    status(
      "Klicka andra hörnet · vänster→höger innanför, höger→vänster korsande",
    );
    return;
  }
  if (drawPending) {
    if (drawPending.clipId === c.id) {
      const draft = drawPending;
      updateDraft(event, c, draft.object);
      if (distance(draft.object.a, draft.object.b) < 2) return;
      drawPending = null;
      await completeDrawing(draft);
      return;
    }
    drawPending = null;
    render();
  }
  const snapping = constrained(event, c, null),
    a = snapping.point;
  if (tool === "text") {
    render();
    const result = await ask({
      title: "Lägg till text",
      fields: [
        { name: "text", label: "Text", multiline: true, required: true },
      ],
      submit: "Lägg till",
    });
    if (result?.text.trim() && getClip(c.id)) {
      remember();
      const o = styleObject("text", a, a);
      o.text = result.text.trim();
      delete o.b;
      c.objects.push(o);
      setSelection([o.id], c.id);
      tool = "select";
      changed();
    }
    return;
  }
  const draft = {
    type: "draw",
    clipId: c.id,
    start: a,
    object: styleObject(tool, a, a),
    before: snapshot(),
  };
  if (tool === "freehand") gesture = draft;
  else drawPending = draft;
  render();
  preview(c, draft.object, snapping);
  if (tool !== "freehand") status("Klicka nästa punkt · Esc avbryter");
});
window.addEventListener("pointermove", (event) => {
  if (boxPending && !gesture) {
    const c = getClip(boxPending.clipId);
    if (c) previewWindow(c, imagePoint(event, c));
    return;
  }
  if (operation?.base && !gesture) {
    const c = getClip(operation.clipId);
    if (c) previewTransform(event, c);
    return;
  }
  if (drawPending && !gesture) {
    const c = getClip(drawPending.clipId);
    if (c) updateDraft(event, c, drawPending.object);
    return;
  }
  if (dimensionPending && !gesture) {
    const c = getClip(dimensionPending.clipId);
    if (!c) return;
    const o = dimensionPending.object,
      pt = imagePoint(event, c);
    o.offset =
      ((pt.x - o.a.x) * -(o.b.y - o.a.y) + (pt.y - o.a.y) * (o.b.x - o.a.x)) /
      (distance(o.a, o.b) || 1);
    preview(c, o);
    status("Klicka för att placera måttlinjen · Esc avbryter");
    return;
  }
  if (!gesture) {
    const drawing = event.target.closest?.("svg.drawing");
    const c = drawing ? getClip(drawing.closest(".clip").dataset.clip) : null;
    if (hoverClipId && (hoverClipId !== c?.id || tool === "select")) {
      const previous = getClip(hoverClipId);
      if (previous) preview(previous, null);
      hoverClipId = null;
      status(toolHint());
    }
    if (!c || tool === "select") return;
    const snapping = constrained(event, c, null);
    hoverClipId = c.id;
    preview(c, null, snapping);
    status(
      snapping.acquired
        ? "Snäpp · referens fångad"
        : snapping.kind
          ? `${snapping.kind === "snäpp" ? "Snäpp" : "OTRACK"} · klicka för att sätta första punkten`
          : toolHint(),
    );
    return;
  }
  if (gesture.type === "rail") {
    const rect = workspace.getBoundingClientRect();
    const rail = $("#rail");
    rail.style.left = `${Math.max(0, Math.min(rect.width - rail.offsetWidth, gesture.initial.x + event.clientX - gesture.start.x))}px`;
    rail.style.top = `${Math.max(0, Math.min(rect.height - rail.offsetHeight, gesture.initial.y + event.clientY - gesture.start.y))}px`;
    return;
  }
  if (gesture.type === "pan") {
    view.x = gesture.view.x + event.clientX - gesture.start.x;
    view.y = gesture.view.y + event.clientY - gesture.start.y;
    board.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.zoom})`;
    return;
  }
  const c = getClip(gesture.clipId);
  if (!c) return;
  if (gesture.type === "card") {
    const pt = boardPoint(event);
    c.x = gesture.initial.x + pt.x - gesture.start.x;
    c.y = gesture.initial.y + pt.y - gesture.start.y;
    const card = cardElement(c);
    card.style.left = `${c.x}px`;
    card.style.top = `${c.y}px`;
    return;
  }
  if (gesture.type === "resize") {
    c.width = Math.max(
      80,
      Math.min(
        3000,
        gesture.initial + (event.clientX - gesture.start.x) / view.zoom,
      ),
    );
    cardElement(c).style.width = `${c.width}px`;
    return;
  }
  if (gesture.type === "object") {
    const o = c.objects.find((o) => o.id === gesture.objectId),
      raw = imagePoint(event, c);
    if (gesture.grip === "offset") {
      const base = gesture.object;
      o.offset =
        ((raw.x - base.a.x) * -(base.b.y - base.a.y) +
          (raw.y - base.a.y) * (base.b.x - base.a.x)) /
        (distance(base.a, base.b) || 1);
    } else if (gesture.grip) {
      const snap = constrained(event, c, null, false, o.id);
      o[gesture.grip] = snap.point;
    } else {
      for (const original of gesture.objects || [gesture.object]) {
        const target = c.objects.find((item) => item.id === original.id);
        if (target)
          Object.assign(
            target,
            translateObject(
              original,
              raw.x - gesture.start.x,
              raw.y - gesture.start.y,
            ),
          );
      }
    }
    renderDrawing(c);
    return;
  }
  if (gesture.type === "draw") updateDraft(event, c, gesture.object);
});
workspace.addEventListener("pointerleave", () => {
  trackingCursor = null;
  trackingState.update({ now: performance.now() });
  if (gesture || drawPending || dimensionPending || !hoverClipId) return;
  const c = getClip(hoverClipId);
  if (c) preview(c, null);
  hoverClipId = null;
  status(toolHint());
});
function updateDraft(event, c, o) {
  const free = ["freehand", "crop", "mask", "highlight"].includes(o.type);
  const snapping = free
    ? { point: imagePoint(event, c), guides: [], kind: "" }
    : constrained(
        event,
        c,
        o.a,
        ["line", "dimension", "leader", "circle"].includes(o.type),
      );
  o.b = snapping.point;
  if (o.type === "freehand") {
    if (distance(o.points.at(-1), o.b) > c.crop.w / c.width / view.zoom)
      o.points.push({ ...o.b });
  }
  if (["scale", "crop"].includes(o.type)) {
    const visual = {
      ...o,
      type: o.type === "scale" ? "line" : "rect",
      color: "#32a375",
    };
    preview(c, visual, snapping);
  } else preview(c, o, snapping);
  if (["line", "dimension", "scale", "leader", "circle"].includes(o.type))
    status(
      `${o.type === "circle" ? "Radie" : "Längd"}: ${formatLength(distance(o.a, o.b), c.scale)}${snapping.kind ? " · " + snapping.kind.toUpperCase() : ""}`,
    );
}
window.addEventListener("pointerup", async () => {
  if (!gesture) return;
  const g = gesture;
  gesture = null;
  if (["pan", "rail"].includes(g.type)) return;
  const c = getClip(g.clipId);
  if (!c) return;
  if (["card", "resize", "object"].includes(g.type)) {
    if (JSON.stringify(g.before) !== JSON.stringify(project)) {
      remember(g.before);
      changed();
    } else render();
    return;
  }
  await completeDrawing(g);
});
async function completeDrawing(g) {
  const c = getClip(g.clipId);
  if (!c) return;
  const o = g.object;
  preview(c, null);
  if (o.type === "freehand" ? o.points.length < 2 : distance(o.a, o.b) < 2) {
    status(toolHint());
    return;
  }
  if (o.type === "scale") {
    await scaleDialog(c, o.a, o.b);
    return;
  }
  if (o.type === "crop") {
    try {
      const cropped = cropClip(c, rectFrom(o.a, o.b));
      remember();
      Object.assign(c, cropped);
      changed();
      toast("Klippet är beskuret. Återställ i klippets egenskaper.");
    } catch (e) {
      toast(e.message);
    }
    return;
  }
  if (o.type === "dimension") {
    dimensionPending = { clipId: c.id, object: o };
    preview(c, o);
    status("Flytta pekaren och klicka för att placera måttlinjen");
    return;
  }
  if (o.type === "leader") {
    const result = await ask({
      title: "Leadertext",
      fields: [
        { name: "text", label: "Kommentar", multiline: true, required: true },
      ],
      submit: "Lägg till",
    });
    if (!result?.text.trim() || !getClip(c.id)) return;
    o.text = result.text.trim();
  }
  remember();
  c.objects.push(o);
  changed();
  status(toolHint());
}

window.addEventListener("pointercancel", () => {
  cancelGesture();
  status(toolHint());
});
$("#rail-handle").addEventListener("pointerdown", (event) => {
  if (event.target.closest("button")) return;
  const rect = $("#rail").getBoundingClientRect(),
    parent = workspace.getBoundingClientRect();
  gesture = {
    type: "rail",
    start: { x: event.clientX, y: event.clientY },
    initial: { x: rect.left - parent.left, y: rect.top - parent.top },
  };
  event.preventDefault();
});
$("#collapse-rail").addEventListener("click", () => {
  closeToolMenu();
  const collapsed = $("#rail").classList.toggle("collapsed");
  $("#collapse-rail").textContent = collapsed ? "›" : "‹";
  $("#collapse-rail").setAttribute(
    "aria-label",
    collapsed ? "Visa verktygsfältet" : "Fäll ihop verktygsfältet",
  );
});
function zoomAt(
  newZoom,
  x = workspace.clientWidth / 2,
  y = workspace.clientHeight / 2,
) {
  const next = Math.min(4, Math.max(0.12, newZoom)),
    ratio = next / view.zoom;
  view.x = x - (x - view.x) * ratio;
  view.y = y - (y - view.y) * ratio;
  view.zoom = next;
  render();
}
function fit(clips = project.clips) {
  if (!clips.length) {
    view = { x: 0, y: 0, zoom: 1 };
    render();
    return;
  }
  const left = Math.min(...clips.map((c) => c.x)),
    top = Math.min(...clips.map((c) => c.y)),
    right = Math.max(...clips.map((c) => c.x + c.width)),
    bottom = Math.max(
      ...clips.map((c) => c.y + 36 + (c.width * c.crop.h) / c.crop.w),
    );
  const area = {
    x: 115,
    y: 95,
    w: Math.max(200, workspace.clientWidth - 160),
    h: Math.max(160, workspace.clientHeight - 200),
  };
  view.zoom = Math.min(1.4, area.w / (right - left), area.h / (bottom - top));
  view.x =
    area.x + (area.w - (right - left) * view.zoom) / 2 - left * view.zoom;
  view.y = area.y + (area.h - (bottom - top) * view.zoom) / 2 - top * view.zoom;
  render();
}
workspace.addEventListener(
  "wheel",
  (event) => {
    if (event.target.closest(".lira-rail,.inspector,.clip-tray")) return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const rect = workspace.getBoundingClientRect();
      zoomAt(
        view.zoom * Math.exp(-event.deltaY * 0.008),
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
    } else {
      view.x -= event.deltaX;
      view.y -= event.deltaY;
      board.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.zoom})`;
    }
  },
  { passive: false },
);
function deleteSelected() {
  const c = getClip(),
    o = getObject();
  if (!c) return;
  remember();
  if (o) {
    c.objects = c.objects.filter((item) => !selectedIds.has(item.id));
    clearSelection();
  } else {
    project.clips = project.clips.filter((item) => item.id !== c.id);
    activeId = project.clips.at(-1)?.id || null;
    showClipProperties = false;
  }
  changed();
  toast(
    o
      ? "Objektet togs bort. Ångra med ⌘/Ctrl Z."
      : "Klippet togs bort. Ångra med ⌘/Ctrl Z.",
  );
}
function duplicateObject() {
  const c = getClip(),
    objects = selectedObjects(c);
  if (!objects.length) return;
  remember();
  const copies = objects.map((o) => ({
    ...translateObject(clone(o), 20, 20),
    id: uid(),
  }));
  c.objects.push(...copies);
  setSelection(
    copies.map((o) => o.id),
    c.id,
  );
  changed();
}
function duplicateClip() {
  const c = getClip();
  if (!c) return;
  remember();
  const copy = clone(c);
  copy.id = uid();
  copy.name += " — kopia";
  copy.x += 40;
  copy.y += 40;
  copy.objects = copy.objects.map((o) => ({ ...o, id: uid() }));
  project.clips.push(copy);
  activeId = copy.id;
  clearSelection();
  changed();
}
$("#inspector").addEventListener("change", (event) => {
  const c = getClip(),
    o = getObject();
  if (!c) return;
  const property = event.target.dataset.property,
    clipProperty = event.target.dataset.clipProperty;
  if (property && o) {
    let value = event.target.value;
    if (["width", "fontSize", "length"].includes(property)) {
      value = Number(value);
      if (!Number.isFinite(value) || value <= 0) {
        renderInspector();
        return;
      }
      if (property === "width") value = Math.min(100, value);
      if (property === "fontSize") value = Math.max(8, Math.min(200, value));
    }
    remember();
    if (property === "length") {
      const len =
          value * (c.scale ? UNITS[c.scale.unit] / c.scale.mmPerPixel : 1),
        angle = Math.atan2(o.b.y - o.a.y, o.b.x - o.a.x);
      o.b = {
        x: o.a.x + Math.cos(angle) * len,
        y: o.a.y + Math.sin(angle) * len,
      };
    } else o[property] = value;
    changed();
  }
  if (clipProperty) {
    if (clipProperty === "unit" && !c.scale) {
      toast("Ange först en skala med två referenspunkter.");
      renderInspector();
      return;
    }
    remember();
    if (clipProperty === "name")
      c.name = event.target.value.trim() || "Skärmklipp";
    if (clipProperty === "width")
      c.width = Math.max(80, Math.min(3000, Number(event.target.value) || 520));
    if (clipProperty === "unit") {
      c.scale.unit = event.target.value;
      c.scale.length =
        (distance(c.scale.a, c.scale.b) * c.scale.mmPerPixel) /
        UNITS[c.scale.unit];
    }
    changed();
  }
});
$("#inspector").addEventListener("click", (event) => {
  const action = event.target.closest("[data-inspector-action]")?.dataset
      .inspectorAction,
    c = getClip();
  if (!action || !c) return;
  if (action === "close") {
    showClipProperties = false;
    clearSelection();
    render();
  }
  if (action === "delete" || action === "delete-clip") deleteSelected();
  if (action === "duplicate") duplicateObject();
  if (action === "duplicate-clip") duplicateClip();
  if (action === "scale") chooseTool("scale");
  if (action === "reset-crop") {
    remember();
    c.width = (c.width * c.naturalWidth) / c.crop.w;
    c.crop = { x: 0, y: 0, w: c.naturalWidth, h: c.naturalHeight };
    changed();
  }
});
board.addEventListener("click", (event) => {
  const button = event.target.closest("[data-card-action]");
  if (!button) return;
  const card = button.closest(".clip");
  activeId = card.dataset.clip;
  clearSelection();
  const action = button.dataset.cardAction;
  if (action === "properties") {
    showClipProperties = !showClipProperties;
    render();
  }
  if (action === "scale") {
    chooseTool("scale");
    toast("Klicka två punkter med en känd längd.");
  }
  if (action === "copy") copyImage([getClip()]);
});
board.addEventListener("dblclick", async (event) => {
  const c = getClip(event.target.closest(".clip")?.dataset.clip);
  if (!c) return;
  if (event.target.closest(".clip-name")) {
    const result = await ask({
      title: "Byt namn på klippet",
      fields: [{ name: "name", label: "Namn", value: c.name, required: true }],
    });
    if (result?.name.trim()) {
      remember();
      c.name = result.name.trim();
      changed();
    }
  }
});
$("#clip-list").addEventListener("click", (event) => {
  const id = event.target.closest("[data-focus]")?.dataset.focus;
  if (id) {
    activate(id);
    fit([getClip(id)]);
  }
});
for (const key of ["snap", "polar", "track"])
  $(`#${key}-toggle`).addEventListener("click", () => {
    aids[key] = !aids[key];
    if (!aids.track || !aids.snap) clearTracking();
    render();
  });
async function normalizeImage(src, name) {
  const image = await loadImage(src);
  if (
    image.width > 16000 ||
    image.height > 16000 ||
    image.width * image.height > 80000000
  )
    throw new Error(
      "Bilden är för stor. Välj en bild under 80 megapixlar och 16 000 px per sida.",
    );
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);
  const width = Math.min(600, Math.max(320, image.width * 0.65));
  const origin = {
    x: (135 - view.x) / view.zoom,
    y: (112 - view.y) / view.zoom,
  };
  const previous = getClip();
  return {
    id: uid(),
    name:
      name.replace(/\.[^.]+$/, "").slice(0, 100) ||
      `Skärmklipp ${project.clips.length + 1}`,
    src: canvas.toDataURL("image/png"),
    naturalWidth: image.width,
    naturalHeight: image.height,
    crop: { x: 0, y: 0, w: image.width, h: image.height },
    width,
    x: previous ? previous.x + previous.width + 35 : origin.x,
    y: previous ? previous.y : origin.y,
    scale: null,
    objects: [],
  };
}
async function importFiles(files) {
  if (importing) {
    toast("Vänta tills bilderna har lästs in.");
    return;
  }
  importing = true;
  const images = [...files].filter((file) =>
    /^image\/(png|jpeg|webp|gif)$/.test(file.type),
  );
  if (!images.length) {
    toast("Välj PNG, JPG, WebP eller GIF.");
    importing = false;
    return;
  }
  const before = snapshot();
  let added = 0;
  try {
    for (const file of images) {
      if (project.clips.length >= 80) {
        toast("Högst 80 klipp per projekt.");
        break;
      }
      const url = URL.createObjectURL(file);
      try {
        const c = await normalizeImage(url, file.name);
        project.clips.push(c);
        activeId = c.id;
        clearSelection();
        added++;
      } catch (e) {
        toast(`${file.name}: ${e.message}`);
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    if (added) {
      remember(before);
      changed();
      fit();
      status(
        `${added} ${added === 1 ? "bild tillagd" : "bilder tillagda"} · välj Skala för att börja rita i skala`,
      );
    }
  } finally {
    importing = false;
  }
}
$("#image-input").addEventListener("change", (event) => {
  importFiles(event.target.files);
  event.target.value = "";
});
document.addEventListener("paste", (event) => {
  if (
    event.target.closest("input,textarea,[contenteditable]") ||
    document.querySelector("dialog[open]")
  )
    return;
  const files = [...(event.clipboardData?.items || [])]
    .filter((i) => i.kind === "file" && i.type.startsWith("image/"))
    .map((i) => i.getAsFile())
    .filter(Boolean);
  if (files.length) {
    event.preventDefault();
    importFiles(files);
  }
});
workspace.addEventListener("dragenter", (event) => {
  if (!event.dataTransfer.types.includes("Files")) return;
  event.preventDefault();
  dragCounter++;
  $("#drop-zone").hidden = false;
});
workspace.addEventListener("dragover", (event) => {
  if (event.dataTransfer.types.includes("Files")) event.preventDefault();
});
workspace.addEventListener("dragleave", () => {
  if (--dragCounter <= 0) {
    dragCounter = 0;
    $("#drop-zone").hidden = true;
  }
});
workspace.addEventListener("drop", (event) => {
  event.preventDefault();
  dragCounter = 0;
  $("#drop-zone").hidden = true;
  importFiles(event.dataTransfer.files);
});
async function captureScreen() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    toast(
      "Den här webbläsaren stöder inte skärmklipp. Klistra in en skärmbild eller öppna en bildfil.",
    );
    return;
  }
  if (captureRequestPending || captureBusy || $("#capture-dialog").open) return;
  if (project.clips.length >= 80) {
    toast("Högst 80 klipp per projekt.");
    return;
  }
  captureRequestPending = true;
  let stream, video;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        displaySurface: "monitor",
        width: { ideal: 3840 },
        height: { ideal: 2160 },
      },
      monitorTypeSurfaces: "include",
      preferCurrentTab: false,
      audio: false,
    });
    video = document.createElement("video");
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    if (video.requestVideoFrameCallback)
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Ingen bild kom från skärmdelningen.")),
          6000,
        );
        video.requestVideoFrameCallback(() => {
          clearTimeout(timeout);
          resolve();
        });
      });
    if (!video.videoWidth || !video.videoHeight)
      throw new Error("Ingen bild kom från skärmdelningen.");
    const canvas = $("#capture-canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    captureRect = null;
    captureStart = null;
    $("#capture-selection").hidden = true;
    canvas.style.setProperty("--capture-ratio", canvas.width / canvas.height);
    $("#capture-dialog").showModal();
  } catch (error) {
    if (error.name === "NotAllowedError" || error.name === "AbortError")
      toast("Skärmklippet avbröts eller skärmdelning tilläts inte.");
    else toast(error.message || "Skärmklippet kunde inte tas.");
  } finally {
    captureRequestPending = false;
    stream?.getTracks().forEach((track) => track.stop());
    if (video) {
      video.pause();
      video.srcObject = null;
    }
  }
}
let captureStart = null,
  captureRect = null,
  captureBusy = false,
  captureRequestPending = false;
function capturePoint(event) {
  const canvas = $("#capture-canvas"),
    r = canvas.getBoundingClientRect();
  return {
    x: Math.max(
      0,
      Math.min(
        canvas.width,
        ((event.clientX - r.left) / r.width) * canvas.width,
      ),
    ),
    y: Math.max(
      0,
      Math.min(
        canvas.height,
        ((event.clientY - r.top) / r.height) * canvas.height,
      ),
    ),
  };
}
function resetCaptureSelection() {
  captureStart = null;
  captureRect = null;
  $("#capture-selection").hidden = true;
}
$("#capture-stage").addEventListener("pointerdown", (event) => {
  if (
    event.button !== 0 ||
    captureBusy ||
    event.target !== $("#capture-canvas")
  )
    return;
  resetCaptureSelection();
  captureStart = capturePoint(event);
  $("#capture-stage").setPointerCapture(event.pointerId);
});
$("#capture-stage").addEventListener("pointermove", (event) => {
  if (!captureStart) return;
  captureRect = rectFrom(captureStart, capturePoint(event));
  const canvas = $("#capture-canvas"),
    r = canvas.getBoundingClientRect(),
    stage = $("#capture-stage").getBoundingClientRect(),
    selection = $("#capture-selection"),
    factor = r.width / canvas.width;
  selection.hidden = false;
  Object.assign(selection.style, {
    left: `${r.left - stage.left + captureRect.x * factor}px`,
    top: `${r.top - stage.top + captureRect.y * factor}px`,
    width: `${captureRect.w * factor}px`,
    height: `${captureRect.h * factor}px`,
  });
});
$("#capture-stage").addEventListener("pointerup", (event) => {
  if (!captureStart || captureBusy) return;
  captureRect = rectFrom(captureStart, capturePoint(event));
  captureStart = null;
  if (captureRect.w < 2 || captureRect.h < 2) {
    resetCaptureSelection();
    return;
  }
  addCapturedRectangle(captureRect);
});
$("#capture-stage").addEventListener("pointercancel", resetCaptureSelection);
$("#capture-dialog").addEventListener("close", resetCaptureSelection);
$("#capture-dialog").addEventListener("cancel", () => {
  if (captureBusy) captureGeneration++;
});
$("#capture-close").addEventListener("click", () => {
  captureGeneration++;
  $("#capture-dialog").close();
});
let captureGeneration = 0;
async function addCapturedRectangle(r) {
  if (captureBusy) return;
  captureBusy = true;
  const generation = ++captureGeneration;
  const source = $("#capture-canvas"),
    canvas = document.createElement("canvas");
  canvas.width = Math.round(r.w);
  canvas.height = Math.round(r.h);
  canvas
    .getContext("2d")
    .drawImage(source, r.x, r.y, r.w, r.h, 0, 0, canvas.width, canvas.height);
  try {
    const c = await normalizeImage(
      canvas.toDataURL("image/png"),
      `Skärmklipp ${project.clips.length + 1}`,
    );
    if (generation !== captureGeneration || !$("#capture-dialog").open) return;
    remember();
    project.clips.push(c);
    activeId = c.id;
    clearSelection();
    $("#capture-dialog").close();
    changed();
    fit();
    status(toolHint());
  } catch (e) {
    toast(e.message);
    resetCaptureSelection();
  } finally {
    captureBusy = false;
  }
}
function exportClips() {
  return menu?.querySelector("#export-scope")?.value === "all"
    ? project.clips
    : [getClip()].filter(Boolean);
}
function exportScaleBar() {
  return !!menu?.querySelector("#export-scale")?.checked;
}
function copyImage(clips = exportClips(), scaleBar = exportScaleBar()) {
  if (!clips.length) {
    toast("Lägg till ett skärmklipp först.");
    return;
  }
  if (!navigator.clipboard?.write || !globalThis.ClipboardItem) {
    toast("Bildkopiering stöds inte här. Exportera PNG i stället.");
    return;
  }
  const promise = renderCollection(clips, scaleBar).then((c) => canvasBlob(c));
  promise.catch(() => {});
  // Pass a promise while the click is still active; Safari requires this.
  navigator.clipboard
    .write([new ClipboardItem({ "image/png": promise })])
    .then(() =>
      toast("Bilden är kopierad. Klistra in i mejl eller en annan app."),
    )
    .catch((error) =>
      toast(
        `Kunde inte kopiera. Exportera PNG i stället. ${error.name === "NotAllowedError" ? "Tillåt urklipp i webbläsaren." : error.message}`,
      ),
    );
  closeMenu();
}
async function exportFile(type) {
  const clips = exportClips(),
    scaleBar = exportScaleBar();
  closeMenu();
  if (!clips.length) return;
  try {
    status("Förbereder export…");
    const canvas = await renderCollection(clips, scaleBar);
    const name = (clips.length === 1 ? clips[0].name : project.name).replace(
      /[<>:"/\\|?*]/g,
      "-",
    );
    if (type === "png") download(await canvasBlob(canvas), `${name}.png`);
    else {
      const flat = document.createElement("canvas");
      flat.width = canvas.width;
      flat.height = canvas.height;
      const ctx = flat.getContext("2d");
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, flat.width, flat.height);
      ctx.drawImage(canvas, 0, 0);
      const jpg = new Uint8Array(
        await (await canvasBlob(flat, "image/jpeg", 0.97)).arrayBuffer(),
      );
      download(
        new Blob([jpegPDF(jpg, flat.width, flat.height)], {
          type: "application/pdf",
        }),
        `${name}.pdf`,
      );
    }
    toast(
      type === "png"
        ? "PNG exporterad."
        : "PDF exporterad — öppna den i LiraPDFWeb.",
    );
    status(toolHint());
  } catch (e) {
    toast(e.message);
    status(toolHint());
  }
}
function closeMenu() {
  menu?.remove();
  menu = null;
}
$("#export-menu").addEventListener("click", () => {
  if (menu) {
    closeMenu();
    return;
  }
  menu = document.createElement("section");
  menu.className = "floating-menu";
  menu.setAttribute("aria-label", "Kopiera och exportera");
  const r = $("#export-menu").getBoundingClientRect();
  menu.style.right = `${Math.max(10, innerWidth - r.right)}px`;
  menu.style.bottom = `${innerHeight - r.top + 10}px`;
  menu.innerHTML = `<h3>Kopiera & exportera</h3><select id="export-scope" aria-label="Vad ska exporteras?"><option value="active">Aktivt klipp</option><option value="all">Alla klipp som en samling</option></select><label><input id="export-scale" type="checkbox"> Visa skalstreck</label><div class="menu-divider"></div><button data-export="copy">${icon("copy")}Kopiera bild</button><button data-export="png">${icon("download")}Exportera PNG</button><button data-export="pdf">${icon("pdf")}Exportera PDF</button><p>PDF kan öppnas i LiraPDFWeb. Klippens placering följer med när hela samlingen exporteras.</p>`;
  document.body.append(menu);
  menu.addEventListener("click", (event) => {
    const action = event.target.closest("[data-export]")?.dataset.export;
    if (action === "copy") copyImage();
    else if (action) exportFile(action);
  });
  menu.querySelector("select").focus();
});
document.addEventListener("pointerdown", (event) => {
  if (menu && !event.target.closest(".floating-menu,#export-menu")) closeMenu();
});
async function openProject(file) {
  if (!file) return;
  try {
    if (file.size > 150000000) throw new Error("Projektfilen är för stor.");
    const data = validateProject(JSON.parse(await file.text()));
    const replace = () => {
      remember();
      project = data;
      activeId = data.clips.at(-1)?.id || null;
      clearSelection();
      showClipProperties = false;
      changed();
      fit();
      toast("Projektet har öppnats.");
    };
    if (project.clips.length) {
      const result = await ask({
        title: "Öppna projekt",
        description:
          "Det öppnade projektet ersätter arbetsytan. Den nuvarande arbetsytan kan återställas med Ångra.",
        submit: "Öppna",
      });
      if (!result) return;
    }
    replace();
  } catch (e) {
    toast(e.message || "Projektet kunde inte öppnas.");
  }
}
$("#project-input").addEventListener("change", (event) => {
  openProject(event.target.files[0]);
  event.target.value = "";
});
$("#project-menu").addEventListener("click", async () => {
  const result = await ask({
    title: "Projektnamn",
    fields: [
      { name: "name", label: "Namn", value: project.name, required: true },
    ],
  });
  if (result?.name.trim()) {
    remember();
    project.name = result.name.trim();
    changed();
  }
});
async function newProject() {
  const result = await ask({
    title: "Nytt projekt",
    description: project.clips.length
      ? "Nuvarande arbetsyta kan återställas med Ångra. Spara som projektfil om du vill behålla den även efter att appen stängs."
      : "",
    fields: [
      {
        name: "name",
        label: "Projektnamn",
        value: "Namnlöst projekt",
        required: true,
      },
    ],
    submit: "Skapa",
  });
  if (!result) return;
  cancelGesture();
  remember();
  project = {
    version: 1,
    name: result.name.trim() || "Namnlöst projekt",
    clips: [],
  };
  activeId = null;
  clearSelection();
  showClipProperties = false;
  tool = "select";
  view = { x: 0, y: 0, zoom: 1 };
  changed();
  status(toolHint());
}
$("#capture-launch-start").innerHTML = icon("capture") + "Nytt skärmklipp";
$("#capture-launch-close").addEventListener("click", () =>
  $("#capture-launch").close(),
);
$("#capture-launch-start").addEventListener("click", () => {
  $("#capture-launch").close();
  captureScreen();
});
setupPWA({
  notify: toast,
  beforeUpdate: async () => {
    await saveChain;
    await saveWorkspace(clone(gesture?.before || project));
  },
});
const actions = {
  new: newProject,
  import: () => $("#image-input").click(),
  capture: captureScreen,
  open: () => $("#project-input").click(),
  save: () => {
    download(
      new Blob([JSON.stringify(project)], { type: "application/json" }),
      `${project.name.replace(/[<>:"/\\|?*]/g, "-")}.lirasnap`,
    );
    toast("Projektfilen har sparats.");
  },
  undo: () => {
    if (!undoStack.length) return;
    cancelGesture();
    redoStack.push(snapshot());
    project = undoStack.pop();
    clearSelection();
    changed();
    status("Ångrat");
  },
  redo: () => {
    if (!redoStack.length) return;
    cancelGesture();
    undoStack.push(snapshot());
    project = redoStack.pop();
    clearSelection();
    changed();
    status("Gjort om");
  },
  "zoom-in": () => zoomAt(view.zoom * 1.2),
  "zoom-out": () => zoomAt(view.zoom / 1.2),
  "zoom-reset": () => zoomAt(1),
  fit: () => fit(),
  help: () => $("#help-dialog").showModal(),
  "close-help": () => $("#help-dialog").close(),
  example: loadExample,
};
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action],[data-tool]");
  if (!button) return;
  if (button.dataset.tool) chooseTool(button.dataset.tool);
  else {
    const result = actions[button.dataset.action]?.();
    if (result instanceof Promise) result.catch((e) => toast(e.message));
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    cancelGesture();
    tool = "select";
    spaceDown = false;
    closeMenu();
    closeToolMenu();
    clearSelection();
    showClipProperties = false;
    render();
    status(toolHint());
    return;
  }
  if (
    event.target.closest("input,textarea,select,[contenteditable]") ||
    document.querySelector("dialog[open]")
  )
    return;
  const cmd = event.metaKey || event.ctrlKey,
    key = event.key.toLowerCase();
  if (event.code === "Space") {
    spaceDown = true;
    event.preventDefault();
    return;
  }
  if (cmd && key === "z") {
    event.preventDefault();
    actions[event.shiftKey ? "redo" : "undo"]();
    return;
  }
  if (cmd && key === "y") {
    event.preventDefault();
    actions.redo();
    return;
  }
  if (cmd && key === "s") {
    event.preventDefault();
    actions.save();
    return;
  }
  if (cmd && key === "o") {
    event.preventDefault();
    actions.open();
    return;
  }
  if (cmd && key === "c") {
    if (getClip()) {
      event.preventDefault();
      copyImage([getClip()], false);
    }
    return;
  }
  if (cmd && key === "d") {
    event.preventDefault();
    getObject() ? duplicateObject() : duplicateClip();
    return;
  }
  if (key === "enter" && operation?.phase === "select") {
    event.preventDefault();
    if (selectedObjects().length) {
      operation.phase = "base";
      boxPending = null;
      render();
      status(toolHint());
    } else toast("Markera minst ett objekt.");
    return;
  }
  if (key === "delete" || key === "backspace") {
    if (selectedId || showClipProperties) {
      event.preventDefault();
      deleteSelected();
    }
    return;
  }
  if (["F3", "F10", "F11"].includes(event.key)) {
    event.preventDefault();
    const key = { F3: "snap", F10: "polar", F11: "track" }[event.key];
    aids[key] = !aids[key];
    if (!aids.track || !aids.snap) clearTracking();
    render();
    return;
  }
  if (cmd || event.altKey) return;
  const entry = TOOLS.find((t) => t[2].toLowerCase() === key);
  if (entry) {
    event.preventDefault();
    chooseTool(entry[0]);
  }
});
document.addEventListener("keyup", (event) => {
  if (event.code === "Space") spaceDown = false;
});
window.addEventListener("blur", () => {
  spaceDown = false;
  if (gesture) cancelGesture();
});
for (const name of ["undo", "redo", "help", "fit"])
  $(`[data-action=${name}]`).innerHTML = icon(name);
for (const button of document.querySelectorAll("[data-action=capture]"))
  button.innerHTML = icon("capture") + "Nytt skärmklipp";
for (const button of document.querySelectorAll(
  "[data-action=import]:not(.tray-add)",
))
  button.innerHTML =
    icon("import") + (button.closest("header") ? "Bild" : "Öppna bild");
initializeToolMenu();
render();
async function loadExample() {
  if (project.clips.length >= 79) {
    toast("Högst 80 klipp per projekt.");
    return;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="650" viewBox="0 0 1000 650"><rect width="1000" height="650" fill="#fff"/><g stroke="#354750" fill="none"><path stroke-width="10" d="M110 105H890V535H110Z M570 105V285M570 375V535M110 330H350M440 330H570"/><path stroke-width="2" d="M575 285h-85a85 85 0 0 0 85 85M350 335v85a85 85 0 0 0 85-85"/><path stroke-width="4" d="M225 105h180M655 105h125M890 230v180M240 535h180" stroke="white"/><path stroke-width="1.5" d="M225 100v10h180v-10ZM655 100v10h125v-10ZM885 230h10v180h-10ZM240 530v10h180v-10Z"/><rect x="145" y="140" width="165" height="90" rx="4"/><path d="M160 150h50v65h-50ZM220 150h50v65h-50Z"/><rect x="140" y="435" width="175" height="62" rx="4"/><path d="M155 435v-13h145v13M155 497v13h145v-13"/><rect x="640" y="145" width="115" height="58" rx="5"/><rect x="643" y="151" width="42" height="44" rx="4"/><rect x="691" y="151" width="42" height="44" rx="4"/><rect x="785" y="325" width="65" height="165" rx="5"/><path d="M785 338h65m-65 49h65m-65 49h65"/><circle cx="706" cy="340" r="37"/><path stroke="#b4c2c5" stroke-dasharray="8 5" d="M90 80H910M90 560H910"/></g><g fill="#7e9298" font-family="Arial,sans-serif" font-size="15" text-anchor="middle"><text x="365" y="270">SOVRUM</text><text x="360" y="470">KÖK / MATPLATS</text><text x="728" y="265">VARDAGSRUM</text></g><text x="110" y="45" fill="#354750" font-family="Arial,sans-serif" font-size="16">EXEMPELRITNING · PLAN 01</text><text x="110" y="612" fill="#97a5a8" font-family="Arial,sans-serif" font-size="12">LiraSnap / Prova skala, mått och kommentarer</text></svg>`;
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const c = await normalizeImage(url, "Exempel — plan 01");
    c.scale = calibrate({ x: 110, y: 105 }, { x: 890, y: 105 }, 7800, "mm");
    c.width = 600;
    c.objects = [
      {
        ...styleObject("dimension", { x: 110, y: 535 }, { x: 890, y: 535 }),
        offset: 38,
        color: "#147b60",
        fontSize: 19,
      },
    ];
    const detail = clone(c);
    detail.id = uid();
    detail.name = "Exempel — detalj";
    detail.crop = { x: 565, y: 105, w: 325, h: 430 };
    detail.width = 300;
    detail.x = c.x + c.width + 35;
    detail.objects = [
      {
        ...styleObject("leader", { x: 785, y: 380 }, { x: 620, y: 430 }),
        text: "Kontrollera placering",
        fontSize: 14,
        color: "#147b60",
        width: 2,
      },
    ];
    remember();
    project.clips.push(c, detail);
    activeId = c.id;
    clearSelection();
    changed();
    fit();
    status("Exempelritning · skala 10 mm per bildpixel · prova ritverktygen");
  } finally {
    URL.revokeObjectURL(url);
  }
}
try {
  const saved = await loadWorkspace();
  if (saved && !undoStack.length && !project.clips.length) {
    project = validateProject(saved);
    activeId = project.clips.at(-1)?.id || null;
    render();
    fit();
    $("#save-status").textContent = "Sparat lokalt";
    status(toolHint());
  }
} catch {
  $("#save-status").textContent = "Autospara ej tillgängligt";
}

const shortcut = consumeShortcutAction(location.href);
if (new URL(location.href).searchParams.has("action"))
  history.replaceState(null, "", shortcut.url.href);
if (shortcut.action === "capture") $("#capture-launch").showModal();
else if (shortcut.action === "new-project") await newProject();
