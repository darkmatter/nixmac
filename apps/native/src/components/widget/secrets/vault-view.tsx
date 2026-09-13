import { Check, ChevronRight, CircleHelp } from "lucide-react";

import { AccessBadge, CopyIconButton, LocalIdentityChip } from "./shared";
import {
  backendLabel,
  primaryDecryptionIdentity,
  recipientKeyLabel,
  secretPathDisplay,
} from "./types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SecretBackend, SecretsVault } from "@/ipc/orpc-bindings";

/**
 * The vault tab summarizes the primary local decryption identity and then
 * lists every secret in the repo.
 */
export function VaultView({
  vault,
  onOpenSecret,
  onCopy,
}: {
  vault: SecretsVault;
  onOpenSecret: (secretId: string, backend: SecretBackend) => void;
  onCopy: (text: string) => void;
}) {
  const primaryIdentity = primaryDecryptionIdentity(vault);
  const primaryIdentityMissing = primaryIdentity === null;
  const primaryIdentityLabel = primaryIdentity?.label ?? "Unresolved";
  const primaryIdentityDevice = primaryIdentity?.device ?? "";
  const primaryIdentityPublicKey = primaryIdentity?.publicKey ?? "Unknown";
  const primaryIdentityFingerprint = primaryIdentity?.fingerprint ?? "Unknown";
  const primaryIdentityRegistrations = primaryIdentity?.registrations ?? [];
  const primaryIdentityRegistered = primaryIdentityRegistrations.length > 0;
  const registeredLabel = primaryIdentityRegistered ? "Yes" : "No";
  const openCount = vault.entries.filter(
    (secret) => secret.decryptionCapability === "available",
  ).length;
  const unknownCount = vault.entries.filter(
    (secret) => secret.decryptionCapability === "unknown",
  ).length;

  return (
    <div className="flex flex-col gap-4.5">
      {primaryIdentityMissing ? (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-warning">
          <CircleHelp className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="text-xs">
            <p className="font-medium">Primary decryption identity unresolved</p>
            <p className="text-warning/90">
              No primary local identity could be resolved. Decryption may still be available
              through the process environment, an agent, or a plugin.
            </p>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card/75 px-4.5 py-4">
        <div className="flex items-center gap-3">
          <img src="/logo.svg" alt="" aria-hidden="true" className="size-9 object-contain" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-[15px]">{primaryIdentityLabel}</span>
              {primaryIdentity ? <LocalIdentityChip /> : null}
            </div>
            <span className="text-muted-foreground text-xs">{primaryIdentityDevice}</span>
          </div>
          <span className="inline-flex items-center rounded-md border border-border px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
            {primaryIdentity ? recipientKeyLabel(primaryIdentity) : "Unknown key"}
          </span>
        </div>

        <div className="grid grid-cols-[1.4fr_1fr_0.8fr] gap-3">
          <div className="rounded-[10px] border border-border bg-muted/20 px-3 py-2.5">
            <div className="mb-1.5 text-[11px] text-muted-foreground">
              Primary identity's public recipient
            </div>
            <div className="flex items-center gap-1.5">
              <code className="truncate font-mono text-foreground text-xs">
                {primaryIdentityPublicKey}
              </code>
              {primaryIdentity?.publicKey ? (
                <CopyIconButton
                  label="Copy public key"
                  onCopy={() => onCopy(primaryIdentityPublicKey)}
                />
              ) : null}
            </div>
            <div className="mt-1 font-mono text-[10.5px] text-muted-foreground/80">
              {primaryIdentityFingerprint}
            </div>
          </div>

          <div className="rounded-[10px] border border-border bg-muted/20 px-3 py-2.5">
            <div className="mb-1.5 text-[11px] text-muted-foreground">Registered in repo</div>
            {primaryIdentityRegistered ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-success/30 bg-success/15 px-2 py-0.5 font-medium text-success text-xs">
                <Check className="size-3" aria-hidden="true" />
                {registeredLabel}
              </span>
            ) : (
              <span className="inline-flex items-center rounded-md border border-muted-foreground/35 bg-muted/45 px-2 py-0.5 font-medium text-muted-foreground text-xs">
                {registeredLabel}
              </span>
            )}
            {primaryIdentityRegistrations.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {primaryIdentityRegistrations.map((registration) => (
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
            <div className="mb-1.5 text-[11px] text-muted-foreground">Known available here</div>
            <div className="flex items-baseline gap-1">
              <span className="font-semibold text-[22px] leading-none">{openCount}</span>
              <span className="text-[13px] text-muted-foreground">/ {vault.entries.length}</span>
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">secrets in this repo</div>
            {unknownCount > 0 ? (
              <div className="mt-1 text-[10.5px] text-muted-foreground">
                {unknownCount} more unknown
              </div>
            ) : null}
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-[11px] text-muted-foreground">
            Local decryption identity sources
          </div>
          <div className="flex flex-wrap gap-1.5">
            {vault.decryptionIdentities.length > 0 ? (
              vault.decryptionIdentities.map((identity) => (
                <Tooltip key={`${identity.locality}:${identity.kind}:${identity.path}`}>
                  <TooltipTrigger asChild>
                    <span className="inline-flex rounded-md border border-border bg-muted/30 px-2 py-0.5 font-mono text-[10.5px] text-muted-foreground">
                      {identity.locality} ·{" "}
                      {identity.kind === "ageKeyFile" ? "age key file" : "SSH key path"}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-105 break-all font-mono text-[11px]">
                    {identity.path}
                  </TooltipContent>
                </Tooltip>
              ))
            ) : (
              <span className="text-[11px] text-muted-foreground">None discovered</span>
            )}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl">
        <div className="grid grid-cols-[1.6fr_0.7fr_1.5fr_1fr_1.3fr_24px] gap-2.5 border-border border-b px-3.5 pb-2 font-medium text-[11px] text-muted-foreground">
          <span>Secret</span>
          <span>Backend</span>
          <span>File</span>
          <span>Recipients</span>
          <span>Local capability</span>
          <span />
        </div>
        {vault.entries.map((secret) => {
          const recipientCount = secret.publicRecipients.length;
          const secretPath = secretPathDisplay(secret);
          return (
            <button
              key={`${secret.backend}:${secret.id}`}
              type="button"
              aria-label={`Open ${secret.name} (${backendLabel(secret.backend)})`}
              onClick={() => onOpenSecret(secret.id, secret.backend)}
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
                {secret.publicRecipientsResolved
                  ? `${recipientCount} ${recipientCount === 1 ? "recipient" : "recipients"}`
                  : "Unknown"}
              </span>
              <span>
                <AccessBadge capability={secret.decryptionCapability} />
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
