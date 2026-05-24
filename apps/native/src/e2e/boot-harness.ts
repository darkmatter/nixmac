import { bootBreadcrumb } from "@/lib/boot-diagnostics";
import { recordE2eDomSnapshot, scheduleE2eDomSnapshots } from "./dom-snapshots";

const APP_MOUNT_RELOAD_TIMEOUT_MS = 12000;
const APP_MOUNT_RELOAD_KEY = "nixmac:e2e-app-mount-reload-attempted";

// Window-level error capture for boot diagnostics. Registered at module load
// so it picks up errors that fire between import resolution and app mount.
window.addEventListener("error", (event) => {
  bootBreadcrumb("window error", event.error ?? event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  bootBreadcrumb("window unhandled rejection", event.reason);
});

bootBreadcrumb("boot-harness loaded");

type AttachBootHarnessOptions = {
  rootElement: Element;
};

export function attachBootHarness({ rootElement }: AttachBootHarnessOptions): void {
  let heartbeatStopped = false;
  let heartbeatTick = 0;
  const heartbeat = window.setInterval(() => {
    if (heartbeatStopped) {
      window.clearInterval(heartbeat);
      return;
    }
    heartbeatTick += 1;
    bootBreadcrumb("boot heartbeat", { tick: heartbeatTick });
    if (heartbeatTick >= 30) {
      bootBreadcrumb("boot heartbeat upper bound reached", { tick: heartbeatTick });
      window.clearInterval(heartbeat);
    }
  }, 1000);

  const stopHeartbeat = () => {
    if (!heartbeatStopped) {
      heartbeatStopped = true;
      window.clearInterval(heartbeat);
      bootBreadcrumb("boot heartbeat stopped", { tick: heartbeatTick });
    }
  };

  window.addEventListener(
    "nixmac:app-mounted",
    () => {
      bootBreadcrumb("app mounted event received");
      scheduleE2eDomSnapshots("post-mount");
      window.sessionStorage.removeItem(APP_MOUNT_RELOAD_KEY);
      stopHeartbeat();
    },
    { once: true },
  );

  window.setTimeout(() => {
    if (heartbeatStopped) {
      return;
    }

    if (window.sessionStorage.getItem(APP_MOUNT_RELOAD_KEY) === "true") {
      bootBreadcrumb("E2E app-mounted watchdog exhausted", {
        timeoutMs: APP_MOUNT_RELOAD_TIMEOUT_MS,
      });
      return;
    }

    window.sessionStorage.setItem(APP_MOUNT_RELOAD_KEY, "true");
    recordE2eDomSnapshot("app-mounted-watchdog-before-reload", {
      storagePrefix: "nixmac:e2e-dom-snapshot:watchdog-pre-reload",
    });
    bootBreadcrumb("E2E app-mounted watchdog reloading", {
      timeoutMs: APP_MOUNT_RELOAD_TIMEOUT_MS,
      rootChildCount: rootElement.childElementCount,
    });
    window.setTimeout(() => {
      window.location.reload();
    }, 250);
  }, APP_MOUNT_RELOAD_TIMEOUT_MS);

  window.setTimeout(() => {
    bootBreadcrumb("post-render dom probe", {
      rootChildCount: rootElement.childElementCount,
      bodyWidth: document.body?.clientWidth ?? null,
      bodyHeight: document.body?.clientHeight ?? null,
    });
  }, 0);
}
