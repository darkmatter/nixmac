"use client";

import { Button } from "@/components/ui/button";
import { tauriAPI } from "@/ipc/api";
import type { Permission } from "@/ipc/types";
import { client, orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";
import { useViewModel } from "@nixmac/state";
import { useQuery } from "@tanstack/react-query";
import { AppWindow, Check, ExternalLink, Folder, HardDrive, KeyRound, Loader2, ShieldCheck, Terminal } from "lucide-react";
import { type ComponentProps, type ReactNode, useEffect, useState } from "react";

type ActionButtonProps = {
  idle: ReactNode;
  busy: string;
  isBusy: boolean;
  /** Taken from the Button itself, so this cannot drift from the design system. */
  variant?: ComponentProps<typeof Button>["variant"];
  onClick: () => void;
};

/**
 * One row's action: a button that neither resizes nor dims when it starts.
 *
 * `isBusy` is the only input for both the running label and `disabled`, because
 * those two must never disagree — a button that says it is working while still
 * accepting clicks, or the reverse, is the bug this shape rules out.
 *
 * Not resizing: the idle label stays in the layout and goes `invisible`, and the
 * spinner is laid over it, so the button is the width of that label in every
 * state and starting the action cannot change it — which, with `transition-all`
 * on every Button, would animate the resize and reflow the whole row. The running
 * word is the accessible name rather than a second label in the box, because in
 * Settings → Permissions the row is only about 350px wide: a button sized for
 * "Disabling…" instead of "Disable" takes those pixels out of the description for
 * as long as the app runs, to say something the spinner already says. The spinner
 * is wrapped rather than a direct child for a related reason: `size="sm"` carries
 * `has-[>svg]:px-2.5`, so a top-level icon would shrink the padding mid-flight.
 *
 * Not dimming: `disabled:opacity-100` is a preference, not a fix. Here `disabled`
 * means exactly "this action is running", and a half-faded spinner is a weaker
 * cue than a solid one; `disabled:pointer-events-none` in the base is what
 * actually refuses the click. Deliberately unlike the feedback dialog's footer,
 * which keeps the dim: there `disabled` means the whole footer is inert and the
 * spinner only marks which button caused it, so dimming says something true. (The
 * blurred *text* that first sent us here cannot happen either way now — no label
 * is visible while the action runs, so nothing is left in the opacity layer to
 * lose its antialiasing.)
 *
 * `invisible` hides the label without giving up its box; `aria-label` is what
 * says the running word while it is hidden, so the button is never nameless and
 * never named twice.
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
 * What one row's grant button says, which is the only thing that differs between
 * them.
 *
 * A row nixmac cannot get anywhere on by itself only deep-links into System
 * Settings and waits for the user, so it comes first and is secondary — that
 * includes the helper while macOS holds its registration pending approval in
 * Login Items, which is the state its sentence describes and the pane this
 * button opens. Of the rest, nixmac installs the helper, so that row is enabled
 * rather than requested, and everything else is a macOS prompt nixmac can raise.
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
  if (perm.id === "privileged-helper") {
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
  // The user's standing decision about the helper, which is what picks the one
  // action its row offers (see the row below). Unless the write itself is refused
  // — a gate on this copy of nixmac, or a store that cannot be written — both
  // actions record the decision before the reconciliation run they start, so this
  // flips while that run is still going, which is why an action in flight pins
  // the button rather than re-deriving it from here.
  const helperPreference = useViewModel((s) => s.preferences?.helperPreference ?? null);
  // The action in flight, per row: the one that row shows until it finishes, and
  // the one labelled as running. Keyed by row rather than one slot for the whole
  // panel because only the row that owns an action is disabled — with a single
  // slot, a click on any other row evicts this row's entry, and the row then
  // re-derives its button from the decision its own running action has already
  // recorded, offering to undo an action that is still in flight. A `Map` rather
  // than an object keyed by id, so a lookup can only find an action this panel
  // put there and never an inherited property of a plain object.
  const [requesting, setRequesting] = useState<ReadonlyMap<string, "grant" | "disable">>(
    () => new Map(),
  );
  const [notice, setNotice] = useState<{ tone: "info" | "error"; message: string } | null>(null);

  // Both take the updater form: two rows can start or settle in the same tick,
  // and each has to apply to the map the other just produced rather than to the
  // one its own render closed over.
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

  // Detect whether nixmac is running from /Applications. macOS TCC services
  // (Full Disk Access especially) key off the bundle's location, so an app
  // launched from the mounted DMG or a download folder will not match the TCC
  // entry and grants silently fail. Only warn when we are actually inside a
  // bundle but misplaced — `bundlePath` is null under `tauri dev` / tests, and
  // we must not surface a false warning there.
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
        // Opens System Settings → Privacy & Security → App Management. macOS
        // can't grant this programmatically and exposes no probe, so we can
        // only deep-link and let the user toggle it. Give them a beat, then
        // re-probe; the backend will keep this row pending rather than report
        // a false grant.
        await tauriAPI.permissions.request(permission.id);
        setNotice({
          tone: "info",
          message:
            "nixmac opened System Settings → Privacy & Security → App Management. Enable nixmac there, then return here. macOS does not let nixmac verify this permission, so this recommended row may remain pending.",
        });
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } else if (permission.id === "privileged-helper") {
        // Grant: the backend records the decision and reconciles the installed
        // helper with this build. It is the only action that may open Login
        // Items, and it does so when macOS is waiting for approval there.
        //
        // The notice carries what *this* run reported, which the refresh below
        // can overwrite in the row with a later run's answer — so it is worth
        // showing only when the two differ. A run that reports what the row
        // already said, which is every click while approval is pending, would
        // otherwise print the same sentence twice on the same screen.
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
   * Disable: the backend records the decision, retires a running helper,
   * unregisters it, and registers nothing. It is the helper row's action whenever
   * the helper is the standing decision *and* nixmac can still act on it — a
   * granted row, and equally one whose report only a later run can change. Not
   * while macOS holds the registration pending approval: that row sends the user
   * to Login Items instead (see the row below).
   */
  async function handleDisableHelper() {
    startAction("privileged-helper", "disable");
    setNotice(null);
    try {
      const report = await client.darwin.helperDisable();
      setNotice({ tone: "info", message: report.detail });
      // deprecated(orpc): replace with client/orpc from @/lib/orpc
      await tauriAPI.permissions.refresh();
    } catch (error) {
      console.error("Failed to disable the unattended sync helper:", error);
      setNotice({
        tone: "error",
        message: `Disabling the unattended sync helper failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      finishAction("privileged-helper");
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
          // The one action this row offers.
          //
          // The helper is the one permission nixmac installs rather than asks
          // macOS for, so it is the one row that can hand it back — as a toggle
          // of the standing decision, not of the row's status: with the helper
          // wanted, every startup and refresh reconciles towards it on its own,
          // and a report the user has to act on (move the app, restart) says so
          // in `instructions`. What no automatic run can do is change their mind,
          // so that is the button.
          //
          // Except while macOS holds the registration pending approval, which the
          // backend reports by clearing `canRequestProgrammatically` on this row.
          // Nothing nixmac does next makes that go, so the row offers the same
          // deep link as the other rows that send the user into System Settings —
          // the Login Items pane its sentence names, which is where macOS asks
          // for the approval.
          //
          // An action in flight keeps its own button: it has already recorded the
          // opposite decision.
          const offersDisable =
            perm.id === "privileged-helper" &&
            perm.canRequestProgrammatically &&
            (helperPreference === "granted" || isGranted);
          const action: "grant" | "disable" | null =
            pendingAction ?? (offersDisable ? "disable" : isGranted ? null : "grant");
          // A fresh DOM node whenever the button changes shape, because the base
          // `transition-all` cross-fades a reused one: a helper row that goes from
          // waiting on approval to a failed register would animate secondary
          // "Open Settings ↗" into primary "Enable", easing both the fill and the
          // width. The feedback dialog's footer keys its buttons for this.
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
              case "privileged-helper":
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
              {/* `min-w-0 flex-1` so the text takes the width the actions do not:
                  the action column is `shrink-0`, so without this every pixel the
                  row is short of comes out of this side and the description wraps
                  two words at a time. */}
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
                  {/* `wrap-anywhere` because these sentences quote paths: the
                      helper's reports name `/nix/store/…` activations and
                      `/Volumes/…` bundles, one unbreakable token of 60-odd monospace
                      characters — wider than the row, so without this they run out
                      of the box. Not `break-all`, which would also break the
                      ordinary words around them at the edge of every line. */}
                  {perm.instructions ? (
                    <p className="mt-2 wrap-anywhere rounded-md border border-border bg-secondary/50 p-2 font-mono text-muted-foreground text-xs">
                      {perm.instructions}
                    </p>
                  ) : null}
                </div>
              </div>

              {/* Stacked, not side by side: the status and the action are as wide
                  as their own text, and a row wide enough for both of them next to
                  each other is width the description does not get.

                  No minimum width. In Settings → Permissions the row is only about
                  350px wide, so a column sized for the widest button would spend a
                  third of it on empty space in every row that only says "Granted".

                  `self-end` for the stacked layout the narrowest windows fall back
                  to: the cross axis is horizontal there, so `self-start` would put
                  the actions under the text on the *left*. */}
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
