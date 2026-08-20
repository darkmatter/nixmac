"use client";

import { Button } from "@/components/ui/button";
import { tauriAPI } from "@/ipc/api";
import type { Permission } from "@/ipc/types";
import { client, orpc } from "@/lib/orpc";
import { HELPER_PERMISSION_ID } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { useViewModel } from "@nixmac/state";
import { useQuery } from "@tanstack/react-query";
import { AppWindow, Check, ExternalLink, Folder, HardDrive, KeyRound, Loader2, ShieldCheck, Terminal } from "lucide-react";
import { type ComponentProps, type ReactNode, useEffect, useState } from "react";

type ActionButtonProps = {
  idle: ReactNode;
  busy: string;
  isBusy: boolean;
  variant?: ComponentProps<typeof Button>["variant"];
  onClick: () => void;
};

/**
 * One row's action button. `isBusy` drives both the running label and
 * `disabled`, so the two cannot disagree.
 *
 * The idle label keeps its box and the spinner is laid over it: swapping
 * content would resize the button, and the design-system Button animates every
 * resize. The spinner stays solid because here `disabled` means "running", and
 * the base's pointer-events rule is what refuses the click. `aria-label`
 * carries the running word while the label is hidden.
 */
function ActionButton({ idle, busy, isBusy, variant, onClick }: ActionButtonProps) {
  return (
    <Button
      size="sm"
      variant={variant}
      onClick={onClick}
      disabled={isBusy}
      aria-label={isBusy ? busy : undefined}
      aria-busy={isBusy}
      className="relative disabled:opacity-100"
    >
      <span className={cn("inline-flex items-center gap-1.5", isBusy && "invisible")}>{idle}</span>
      {isBusy ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        </span>
      ) : null}
    </Button>
  );
}

/**
 * What one row's grant button says. A row nixmac cannot advance on its own
 * can only deep-link into System Settings; the helper is installed by nixmac
 * rather than requested from macOS, hence "Enable".
 */
function grantLabel(perm: Permission): Pick<ActionButtonProps, "idle" | "busy" | "variant"> {
  if (!perm.canRequestProgrammatically) {
    return {
      idle: (
        <>
          Open Settings
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </>
      ),
      busy: "Waiting…",
      variant: "secondary",
    };
  }
  if (perm.id === HELPER_PERMISSION_ID) {
    return { idle: "Enable", busy: "Enabling…" };
  }
  return { idle: "Request", busy: "Requesting…" };
}

/**
 * The macOS permission list: status rows plus grant/request actions. Real
 * permission state is mirrored from the backend cell into the ViewModel; this
 * only triggers probes/requests and the `permissions_changed` round-trip
 * updates the display. Shared between the onboarding permissions step and the
 * Settings → Permissions tab, so it carries no step/tab chrome of its own.
 */
export function PermissionsPanel() {
  const permissionsState = useViewModel((s) => s.permissions);
  // The standing helper decision picks the helper row's action. Both actions
  // record the decision before their run finishes, so an action in flight pins
  // its button rather than re-deriving it from here.
  const helperPreference = useViewModel((s) => s.preferences?.helperPreference ?? null);
  // The action in flight, per row. Per row because only the row that owns an
  // action is disabled; a single panel-wide slot would let a click on one row
  // evict another's entry while its action still runs.
  const [requesting, setRequesting] = useState<ReadonlyMap<string, "grant" | "disable">>(
    () => new Map(),
  );
  const [notice, setNotice] = useState<{ tone: "info" | "error"; message: string } | null>(null);

  // Updater form: two rows can start or settle in the same tick.
  function startAction(id: string, action: "grant" | "disable") {
    setRequesting((inFlight) => new Map(inFlight).set(id, action));
  }

  function finishAction(id: string) {
    setRequesting((inFlight) => {
      const next = new Map(inFlight);
      next.delete(id);
      return next;
    });
  }

  // Refresh permissions when the panel mounts.
  useEffect(() => {
    // deprecated(orpc): replace with client/orpc from @/lib/orpc
    tauriAPI.permissions.refresh().catch((error) => {
      console.error("Failed to check permissions:", error);
    });
  }, []);

  // macOS TCC grants key off the bundle's location, so an app launched from
  // the DMG or a download folder silently fails to match its grants. Warn only
  // when actually inside a bundle but misplaced — `bundlePath` is null under
  // `tauri dev` and tests.
  const { data: installLocation } = useQuery(orpc.system.installLocation.queryOptions());
  const showMisplacedWarning =
    installLocation?.bundlePath != null && !installLocation.inApplicationsDir;

  async function handleGrant(permission: Permission) {
    startAction(permission.id, "grant");
    setNotice(null);
    try {
      if (permission.id === "full-disk") {
        await tauriAPI.permissions.requestFullDiskAccess();
        // Give the user a beat to grant access in System Settings, then re-probe.
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } else if (permission.id === "app-management") {
        // macOS cannot grant this programmatically and exposes no probe, so
        // deep-link, give the user a beat, then re-probe; the backend keeps
        // the row pending rather than report a false grant.
        await tauriAPI.permissions.request(permission.id);
        setNotice({
          tone: "info",
          message:
            "nixmac opened System Settings → Privacy & Security → App Management. Enable nixmac there, then return here. macOS does not let nixmac verify this permission, so this recommended row may remain pending.",
        });
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } else if (permission.id === HELPER_PERMISSION_ID) {
        // The backend records the decision and reconciles; it may open Login
        // Items when approval is pending. Show this run's report only when it
        // differs from the row's sentence — otherwise every click while
        // approval is pending prints the same sentence twice.
        const result = await tauriAPI.permissions.request(permission.id);
        if (result.status !== "granted" && result.instructions !== permission.instructions) {
          setNotice({
            tone: "info",
            message:
              result.instructions ??
              "nixmac could not finish enabling the unattended sync helper.",
          });
        }
      } else {
        // deprecated(orpc): replace with client/orpc from @/lib/orpc
        await tauriAPI.permissions.request(permission.id);
      }
      // deprecated(orpc): replace with client/orpc from @/lib/orpc
      await tauriAPI.permissions.refresh();
    } catch (error) {
      console.error("Failed to request permission:", error);
      setNotice({
        tone: "error",
        message: `Permission request failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      finishAction(permission.id);
    }
  }

  /**
   * The backend records the decision, waits out a running activation, and
   * unregisters. Not offered while macOS holds the registration pending
   * approval — that row deep-links to Login Items instead.
   */
  async function handleDisableHelper() {
    startAction(HELPER_PERMISSION_ID, "disable");
    setNotice(null);
    try {
      const report = await client.darwin.helperDisable();
      setNotice({ tone: "info", message: report.detail });
      await client.permissions.refresh();
    } catch (error) {
      console.error("Failed to disable the unattended sync helper:", error);
      setNotice({
        tone: "error",
        message: `Disabling the unattended sync helper failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      finishAction(HELPER_PERMISSION_ID);
    }
  }

  const permissions = permissionsState?.permissions ?? [];

  return (
    <>
      {showMisplacedWarning ? (
        <p className="mb-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          nixmac is running from{" "}
          <span className="font-mono text-xs">
            {installLocation?.bundlePath}
          </span>
          , not from <span className="font-mono text-xs">/Applications</span>. macOS
          permissions like Full Disk Access are tied to the app’s location, so grants
          won’t take effect here. Quit nixmac, drag it into{" "}
          <span className="font-mono text-xs">/Applications</span>, and launch it from
          there before granting permissions.
        </p>
      ) : null}

      {notice ? (
        <p
          className={cn(
            "mb-4 rounded-lg border p-3 text-sm",
            notice.tone === "error"
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-primary/20 bg-primary/10 text-primary",
          )}
        >
          {notice.message}
        </p>
      ) : null}

      <ul className="flex flex-col gap-3">
        {permissions.map((perm) => {
          const isGranted = perm.status === "granted";
          const pendingAction = requesting.get(perm.id) ?? null;
          const isGranting = pendingAction === "grant";
          const isDisabling = pendingAction === "disable";
          // The one action this row offers. The helper is the one permission
          // nixmac installs rather than asks macOS for, so its row can hand it
          // back — a toggle of the standing decision, not of the row's status.
          // While macOS holds the registration pending approval the backend
          // clears `canRequestProgrammatically` and the row deep-links to Login
          // Items instead. An action in flight keeps its own button: it has
          // already recorded the opposite decision.
          const offersDisable =
            perm.id === HELPER_PERMISSION_ID &&
            perm.canRequestProgrammatically &&
            (helperPreference === "granted" || isGranted);
          const action: "grant" | "disable" | null =
            pendingAction ?? (offersDisable ? "disable" : isGranted ? null : "grant");
          // A fresh DOM node whenever the button changes shape: the
          // design-system Button animates a reused one, cross-fading fill and
          // width between shapes.
          const buttonKey =
            action === "disable"
              ? "disable"
              : perm.canRequestProgrammatically
                ? "grant"
                : "open-settings";
          const icon = (() => {
            if (isGranted) {
              return <ShieldCheck className="size-5" />;
            }
            switch (perm.id) {
              case "desktop":
                return <Folder className="size-5" />;
              case "documents":
                return <Folder className="size-5" />;
              case "admin":
                return <Terminal className="size-5" />;
              case "full-disk":
                return <HardDrive className="size-5" />;
              case "app-management":
                return <AppWindow className="size-5" />;
              case HELPER_PERMISSION_ID:
                return <KeyRound className="size-5" />;
              default:
                return <Loader2 className="size-5 animate-spin" aria-hidden="true" />;
            }
          })()

          return (
            <li
              key={perm.id}
              className={cn(
                "flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors sm:flex-row sm:items-center sm:justify-between",
                isGranted ? "border-success/30" : "border-border",
              )}
            >
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span
                  className={cn(
                    "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg",
                    isGranted ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
                  )}
                  aria-hidden="true"
                >
                  {icon}
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-sm">{perm.name}</span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 font-medium text-[10px] uppercase tracking-wide",
                        perm.required
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {perm.required ? "Required" : "Recommended"}
                    </span>
                  </div>
                  <p className="mt-1 text-muted-foreground text-sm leading-relaxed">
                    {perm.description}
                  </p>
                  {/* These sentences quote unbreakable `/nix/store/…` paths
                      wider than the row, so they must be allowed to break
                      anywhere. */}
                  {perm.instructions ? (
                    <p className="mt-2 wrap-anywhere rounded-md border border-border bg-secondary/50 p-2 font-mono text-muted-foreground text-xs">
                      {perm.instructions}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="flex shrink-0 flex-col items-end gap-1.5 self-end sm:self-center">
                {isGranted ? (
                  <span className="inline-flex items-center gap-1.5 font-medium text-success text-sm">
                    <Check className="size-4" aria-hidden="true" />
                    Granted
                  </span>
                ) : null}
                {action === "disable" ? (
                  <ActionButton
                    key={buttonKey}
                    idle="Disable"
                    busy="Disabling…"
                    isBusy={isDisabling}
                    variant="ghost"
                    onClick={handleDisableHelper}
                  />
                ) : action === "grant" ? (
                  <ActionButton
                    key={buttonKey}
                    {...grantLabel(perm)}
                    isBusy={isGranting}
                    onClick={() => handleGrant(perm)}
                  />
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-5 text-muted-foreground/70 text-xs leading-relaxed">
        The unattended sync helper is installed once during onboarding so later builds can activate
        without repeated password prompts. Full Disk Access is required for reliable activation; App
        Management is recommended for managed app updates, but macOS does not let nixmac verify it.
      </p>
    </>
  );
}
