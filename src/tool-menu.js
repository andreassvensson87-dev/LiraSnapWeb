import { icon, TOOLS } from "./icons.js";
export const CATEGORIES = [
  ["draw", "Rita", ["line", "rect", "circle", "freehand"]],
  ["edit", "Ändra", ["move", "copy", "trim", "extend"]],
  ["measure", "Mått", ["dimension", "leader", "text", "scale"]],
  ["image", "Bild", ["crop", "highlight", "mask"]],
];
let opened = null,
  closeTimer;
export function closeToolMenu() {
  clearTimeout(closeTimer);
  opened = null;
  const panel = document.querySelector("#tool-flyout");
  panel.hidden = true;
  document.querySelectorAll("[data-category]").forEach((b) => {
    b.classList.remove("lira-open");
    b.setAttribute("aria-expanded", "false");
  });
}
function openCategory(name) {
  clearTimeout(closeTimer);
  opened = name;
  const category = CATEGORIES.find((c) => c[0] === name),
    panel = document.querySelector("#tool-flyout"),
    button = document.querySelector(`[data-category="${name}"]`),
    workspace = document.querySelector("#workspace"),
    rect = button.getBoundingClientRect(),
    parent = workspace.getBoundingClientRect();
  panel.innerHTML = `<h3>${category[1]}</h3><div>${category[2]
    .map((tool) => {
      const entry = TOOLS.find((t) => t[0] === tool);
      return `<button data-tool="${tool}" title="${entry[1]} (${entry[2]})">${icon(tool)}<span>${entry[1]}</span><kbd>${entry[2]}</kbd></button>`;
    })
    .join("")}</div>`;
  panel.hidden = false;
  panel.style.left = `${Math.min(workspace.clientWidth - panel.offsetWidth - 8, rect.right - parent.left + 10)}px`;
  panel.style.top = `${Math.max(8, Math.min(workspace.clientHeight - panel.offsetHeight - 8, rect.top - parent.top))}px`;
  document.querySelectorAll("[data-category]").forEach((b) => {
    const active = b.dataset.category === name;
    b.classList.toggle("lira-open", active);
    b.setAttribute("aria-expanded", String(active));
  });
}
export function renderToolMenu(tool) {
  const tools = document.querySelector("#tools");
  tools.innerHTML =
    `<button data-tool="select" class="${tool === "select" ? "active" : ""}" title="Markera (V)">${icon("select")}<span>Markera</span></button>` +
    CATEGORIES.map(
      ([name, label, list]) =>
        `<button data-category="${name}" class="${list.includes(tool) ? "active" : ""}" aria-expanded="false" aria-controls="tool-flyout">${icon(name)}<span>${label}</span></button>`,
    ).join("");
  tools.querySelectorAll("[data-category]").forEach((b) => {
    b.addEventListener("pointerenter", () => openCategory(b.dataset.category));
    b.addEventListener("focus", () => openCategory(b.dataset.category));
    b.addEventListener("click", () => openCategory(b.dataset.category));
  });
  if (opened) openCategory(opened);
}
export function initializeToolMenu() {
  const rail = document.querySelector("#rail"),
    panel = document.querySelector("#tool-flyout");
  const leave = () => {
    closeTimer = setTimeout(closeToolMenu, 180);
  };
  rail.addEventListener("pointerleave", leave);
  panel.addEventListener("pointerleave", leave);
  panel.addEventListener("pointerenter", () => clearTimeout(closeTimer));
  document.addEventListener("pointerdown", (e) => {
    if (!e.target.closest("#rail,#tool-flyout")) closeToolMenu();
  });
}
