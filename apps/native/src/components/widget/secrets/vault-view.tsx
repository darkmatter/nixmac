import { Check, ChevronRight } from "lucide-react";

import { AccessBadge, CopyIconButton, ThisHostChip } from "./shared";
import {
  backendLabel,
  canHostDecrypt,
  hostRecipient,
  secretPathDisplay,
  type SecretsVault,
} from "./types";

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
  const host = hostRecipient(vault);
  const openCount = vault.secrets.filter((s) => canHostDecrypt(s, vault.hostId)).length;

  return (
    <div className="flex flex-col gap-4.5">
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card/75 px-4.5 py-4">
        <div className="flex items-center gap-3">
          <img src="/logo.svg" alt="" aria-hidden="true" className="size-9 object-contain" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-[15px]">{host.label}</span>
              <ThisHostChip />
            </div>
            <span className="text-muted-foreground text-xs">{host.device}</span>
          </div>
          <span className="inline-flex items-center rounded-md border border-border px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
            age identity
          </span>
        </div>

        <div className="grid grid-cols-[1.4fr_1fr_0.8fr] gap-3">
          <div className="rounded-[10px] border border-border bg-muted/20 px-3 py-2.5">
            <div className="mb-1.5 text-[11px] text-muted-foreground">This host's public key</div>
            <div className="flex items-center gap-1.5">
              <code className="truncate font-mono text-foreground text-xs">{host.publicKey}</code>
              <CopyIconButton label="Copy public key" onCopy={() => onCopy(host.publicKey)} />
            </div>
            <div className="mt-1 font-mono text-[10.5px] text-muted-foreground/80">
              {host.fingerprint}
            </div>
          </div>

          <div className="rounded-[10px] border border-border bg-muted/20 px-3 py-2.5">
            <div className="mb-1.5 text-[11px] text-muted-foreground">Registered in repo</div>
            <span className="inline-flex items-center gap-1 rounded-md border border-success/30 bg-success/15 px-2 py-0.5 font-medium text-success text-xs">
              <Check className="size-3" aria-hidden="true" />
              Yes
            </span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <code className="rounded bg-muted px-1 font-mono text-[10.5px] text-muted-foreground">
                secrets.nix
              </code>
              <code className="rounded bg-muted px-1 font-mono text-[10.5px] text-muted-foreground">
                .sops.yaml
              </code>
            </div>
          </div>

          <div className="rounded-[10px] border border-border bg-muted/20 px-3 py-2.5">
            <div className="mb-1.5 text-[11px] text-muted-foreground">This host can open</div>
            <div className="flex items-baseline gap-1">
              <span className="font-semibold text-[22px] leading-none">{openCount}</span>
              <span className="text-[13px] text-muted-foreground">/ {vault.secrets.length}</span>
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
        {vault.secrets.map((secret) => {
          const recipientCount = secret.recipientIds.length;
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
              <code className="truncate font-mono text-[11px] text-muted-foreground">
                {secretPathDisplay(secret)}
              </code>
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
