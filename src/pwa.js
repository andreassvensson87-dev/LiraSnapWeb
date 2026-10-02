export function consumeShortcutAction(href) {
  const url = new URL(href),
    action = url.searchParams.get("action");
  url.searchParams.delete("action");
  return {
    action: ["capture", "new-project"].includes(action) ? action : null,
    url,
  };
}
export function setupPWA({ beforeUpdate, notify }) {
  const install = document.querySelector("#install-app"),
    update = document.querySelector("#update-app");
  let installPrompt = null,
    waitingWorker = null,
    updating = false;
  const standalone = () =>
    matchMedia("(display-mode: standalone)").matches ||
    navigator.standalone === true;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    if (!standalone()) install.hidden = false;
  });
  window.addEventListener("appinstalled", () => {
    install.hidden = true;
    installPrompt = null;
    notify("LiraSnap är installerad.");
  });
  install.addEventListener("click", async () => {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null;
    install.hidden = true;
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      notify("Installera LiraSnap via webbläsarens meny.");
    }
  });
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (updating) location.reload();
  });
  update.addEventListener("click", async () => {
    if (!waitingWorker || updating) return;
    update.disabled = true;
    try {
      await beforeUpdate();
      updating = true;
      update.textContent = "Uppdaterar …";
      waitingWorker.postMessage({ type: "ACTIVATE_UPDATE" });
    } catch {
      update.disabled = false;
      notify(
        "Spara projektet som fil innan du uppdaterar. Autosparandet misslyckades.",
      );
    }
  });
  navigator.serviceWorker
    .register("./sw.js", { updateViaCache: "none" })
    .then((registration) => {
      const offer = () => {
        waitingWorker = registration.waiting;
        update.hidden = !waitingWorker || !navigator.serviceWorker.controller;
      };
      const watch = () =>
        registration.installing?.addEventListener("statechange", offer);
      offer();
      watch();
      registration.addEventListener("updatefound", watch);
      const check = () => {
        if (!document.hidden && navigator.onLine && !updating)
          registration.update().catch(() => {});
      };
      window.addEventListener("focus", check);
      window.addEventListener("online", check);
      document.addEventListener("visibilitychange", check);
      setInterval(check, 15 * 60 * 1000);
    })
    .catch(() => {
      notify(
        "Offlinefunktionen kunde inte startas. Appen kan fortfarande användas med anslutning.",
      );
    });
}
