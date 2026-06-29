"use client";

import { Button } from "@/components/ui/button";
import { stepEyebrow } from "@/components/widget/onboarding/lib/onboarding";
import { StepShell } from "@/components/widget/onboarding/step-shell";
import { tauriAPI } from "@/ipc/api";
import type { Permission } from "@/ipc/types";
import { cn } from "@/lib/utils";
import { useViewModel } from "@nixmac/state";
import { Check, ExternalLink, Folder, HardDrive, KeyRound, Loader2, ShieldCheck, Terminal } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Permissions step. Real macOS permission state is mirrored from the backend
 * cell into the ViewModel; this only triggers probes/requests and the
 * `permissions_changed` round-trip updates the display. When every required
 * permission is granted the onboarding machine advances on its own.
 */
export function PermissionsStep() {
  const permissionsState = useViewModel((s) => s.permissions);
  const [requesting, setRequesting] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; message: string } | null>(null);

  // Refresh permissions when the step mounts.
  useEffect(() => {
    // deprecated(orpc): replace with client/orpc from @/lib/orpc
    tauriAPI.permissions.refresh().catch((error) => {
      console.error("Failed to check permissions:", error);
    });
  }, []);

  async function handleGrant(permission: Permission) {
    setRequesting(permission.id);
    setNotice(null);
    try {
      if (permission.id === "full-disk") {
        await tauriAPI.permissions.requestFullDiskAccess();
        // Give the user a beat to grant access in System Settings, then re-probe.
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } else if (permission.id === "privileged-helper") {
        // Registers the bundled SMAppService LaunchDaemon. macOS may require
        // one-time approval in Login Items & Extensions before status is granted.
        const result = await tauriAPI.permissions.request(permission.id);
        if (result.status !== "granted") {
          setNotice({
            tone: "info",
            message:
              "nixmac opened Login Items & Extensions. Enable nixmac there, then return here and click Enable again if this row is still pending.",
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
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
      setRequesting(null);
    }
  }

  const permissions = permissionsState?.permissions ?? [];


  return (
    <StepShell
      eyebrow={stepEyebrow("permissions")}
      title="System Permissions"
      description="nixmac needs a few macOS permissions before it can read your configuration and apply changes. Grant the required ones to continue — we’ll move on automatically."
    >
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
          const isRequesting = requesting === perm.id;
          const canRequest = perm.canRequestProgrammatically;
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
              <div className="flex items-start gap-3">
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
                  {perm.instructions ? (
                    <p className="mt-2 rounded-md border border-border bg-secondary/50 p-2 font-mono text-muted-foreground text-xs">
                      {perm.instructions}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="shrink-0 self-start sm:self-center">
                {isGranted ? (
                  <span className="inline-flex items-center gap-1.5 font-medium text-success text-sm">
                    <Check className="size-4" aria-hidden="true" />
                    Granted
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant={canRequest ? "default" : "secondary"}
                    onClick={() => handleGrant(perm)}
                    disabled={isRequesting}
                  >
                    {isRequesting ? (
                      <>
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        {canRequest ? "Requesting…" : "Waiting…"}
                      </>
                    ) : perm.id === "privileged-helper" ? (
                      "Enable"
                    ) : canRequest ? (
                      "Request"
                    ) : (
                      <>
                        Open Settings
                        <ExternalLink className="size-3.5" aria-hidden="true" />
                      </>
                    )}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-5 text-muted-foreground/70 text-xs leading-relaxed">
        The unattended sync helper is installed once during onboarding so later builds can activate
        without repeated password prompts. Full Disk Access is recommended for the smoothest experience.
      </p>
    </StepShell>
  );
}

