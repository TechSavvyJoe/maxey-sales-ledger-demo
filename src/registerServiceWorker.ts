let currentRegistration: ServiceWorkerRegistration | null = null;

function announceUpdate(): void {
  window.dispatchEvent(new CustomEvent("sales-ledger-update-ready"));
}

export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register("./sw.js", { scope: "./" })
      .then((registration) => {
        currentRegistration = registration;
        if (registration.waiting) announceUpdate();
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) announceUpdate();
          });
        });
        return registration.update();
      })
      .catch(() => {
        // App remains fully usable online; diagnostics expose service-worker status.
      });
  });
}

export function activateWaitingServiceWorker(): void {
  currentRegistration?.waiting?.postMessage({ type: "SKIP_WAITING" });
}
