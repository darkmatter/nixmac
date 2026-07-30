import { Check, ChevronRight, TriangleAlert } from "lucide-react";

import { AccessBadge, CopyIconButton, ThisHostChip } from "./shared";
import {
  backendLabel,
  canHostDecrypt,
  hostRecipient,
  recipientKeyLabel,
  secretPathDisplay,
} from "./types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SecretsVault } from "@/ipc/orpc-bindings";

/**
 * The vault tab: answers "which key is this host, is it registered, what can
 * it open" up top, then lists every secret in the repo.
 */
export function VaultView({
  vault,
  onOpenSecret,
  onCopy,
}: {
  vault: SecretsVault;
  onOpenSecret: (secretId: string) => void;
  onCopy: (text: string) => void;
}) {
  let hostRecipientMissing = false;
  const host = (() => {
    try {
      return hostRecipient(vault);
    } catch {
      hostRecipientMissing = true;
      return null;
    }
  })();

  const hostLabel = host?.label ?? vault.hostId;
  const hostDevice = host?.device ?? "";
  const hostPublicKey = host?.publicKey ?? "Unknown";
  const hostFingerprint = host?.fingerprint ?? "Unknown";
  const hostRegistrations = host?.registrations ?? [];
  const hostRegistered = hostRegistrations.length > 0;
  const registeredLabel = hostRegistered ? "Yes" : "No";
  const openCount = vault.entries.filter((s) => canHostDecrypt(s, vault.hostId)).length;

  return (
    <div className="flex flex-col gap-4.5">
      {hostRecipientMissing ? (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-warning">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="text-xs">
            <p className="font-medium">Host recipient unavailable</p>
            <p className="text-warning/90">
              This host key is not registered as a recipient in this repo yet. You can still
              browse secrets, but host access cannot be resolved until the key is added.
            </p>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card/75 px-4.5 py-4">
        <div className="flex items-center gap-3">
          <img src="/logo.svg" alt="" aria-hidden="true" className="size-9 object-contain" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-[15px]">{hostLabel}</span>
              <ThisHostChip />
            </div>
            <span className="text-muted-foreground text-xs">{hostDevice}</span>
          </div>
          <span className="inline-flex items-center rounded-md border border-border px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
            {host ? recipientKeyLabel(host) : "Unknown key"}
          </span>
        </div>

        <div className="grid grid-cols-[1.4fr_1fr_0.8fr] gap-3">
          <div className="rounded-[10px] border border-border bg-muted/20 px-3 py-2.5">
            <div className="mb-1.5 text-[11px] text-muted-foreground">This host's public key</div>
            <div className="flex items-center gap-1.5">
              <code className="truncate font-mono text-foreground text-xs">{hostPublicKey}</code>
              {host?.publicKey ? (
                <CopyIconButton label="Copy public key" onCopy={() => onCopy(hostPublicKey)} />
              ) : null}
            </div>
            <div className="mt-1 font-mono text-[10.5px] text-muted-foreground/80">
              {hostFingerprint}
            </div>
          </div>

          <div className="rounded-[10px] border border-border bg-muted/20 px-3 py-2.5">
            <div className="mb-1.5 text-[11px] text-muted-foreground">Registered in repo</div>
            {hostRegistered ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-success/30 bg-success/15 px-2 py-0.5 font-medium text-success text-xs">
                <Check className="size-3" aria-hidden="true" />
                {registeredLabel}
              </span>
            ) : (
              <span className="inline-flex items-center rounded-md border border-muted-foreground/35 bg-muted/45 px-2 py-0.5 font-medium text-muted-foreground text-xs">
                {registeredLabel}
              </span>
            )}
            {hostRegistrations.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {hostRegistrations.map((registration) => (
                  <Tooltip key={`${registration.backend}:${registration.file}`}>
                    <TooltipTrigger asChild>
                      <code className="rounded bg-muted px-1 font-mono text-[10.5px] text-muted-foreground">
                        {registration.file}
                      </code>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="font-mono text-[11px]">
                      {backendLabel(registration.backend)} recipient registration
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            ) : null}
          </div>

          <div className="rounded-[10px] border border-border bg-muted/20 px-3 py-2.5">
            <div className="mb-1.5 text-[11px] text-muted-foreground">This host can open</div>
            <div className="flex items-baseline gap-1">
              <span className="font-semibold text-[22px] leading-none">{openCount}</span>
              <span className="text-[13px] text-muted-foreground">/ {vault.entries.length}</span>
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">secrets in this repo</div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl">
        <div className="grid grid-cols-[1.6fr_0.7fr_1.5fr_1fr_1.3fr_24px] gap-2.5 border-border border-b px-3.5 pb-2 font-medium text-[11px] text-muted-foreground">
          <span>Secret</span>
          <span>Backend</span>
          <span>File</span>
          <span>Recipients</span>
          <span>This host</span>
          <span />
        </div>
        {vault.entries.map((secret) => {
          const recipientCount = secret.recipientIds.length;
          const secretPath = secretPathDisplay(secret);
          return (
            <button
              key={secret.id}
              type="button"
              onClick={() => onOpenSecret(secret.id)}
              className="grid w-full cursor-pointer grid-cols-[1.6fr_0.7fr_1.5fr_1fr_1.3fr_24px] items-center gap-2.5 border-border border-b px-3.5 py-2.5 text-left transition-colors hover:bg-muted/30"
            >
              <span className="truncate font-medium font-mono text-[13px]">{secret.name}</span>
              <span className="font-mono text-[10.5px] text-muted-foreground">
                {backendLabel(secret.backend)}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <code className="truncate font-mono text-[11px] text-muted-foreground">
                    {secretPath}
                  </code>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-105 break-all font-mono text-[11px]">
                  {secretPath}
                </TooltipContent>
              </Tooltip>
              <span className="text-muted-foreground text-xs">
                {recipientCount} {recipientCount === 1 ? "recipient" : "recipients"}
              </span>
              <span>
                <AccessBadge canDecrypt={canHostDecrypt(secret, vault.hostId)} />
              </span>
              <span className="inline-flex justify-end text-muted-foreground/70">
                <ChevronRight className="size-4" aria-hidden="true" />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
