import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CopyIconButton,
  InRepoBadge,
  RecipientKindIcon,
  recipientKindLabel,
  ThisHostChip,
} from "./shared";
import type { SecretsVault } from "@/ipc/orpc-bindings";

/**
 * The keys & recipients tab: every age public key known to the repo, and
 * whether it is committed (only committed keys can decrypt).
 */
export function KeysView({
  vault,
  onCopy,
  onAddRecipient,
}: {
  vault: SecretsVault;
  onCopy: (text: string) => void;
  onAddRecipient: () => void;
}) {
  const opensLabel = (recipientId: string) => {
    const count = vault.entries.filter((s) => s.recipientIds.includes(recipientId)).length;
    return `Opens ${count} ${count === 1 ? "secret" : "secrets"}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-base">Keys &amp; recipients</h2>
          <p className="mt-1 max-w-140 text-[13px] text-muted-foreground">
            Every recipient here is an age public key that can be granted access to a secret. A
            recipient must be committed to the repo before it can decrypt anything.
          </p>
        </div>
        {/* TODO: show this again when the add-recipient flow is implemented. */}
        <Button variant="outline" size="sm" onClick={onAddRecipient} className="hidden">
          <Plus aria-hidden="true" />
          Add recipient key
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        {vault.recipients.map((recipient) => (
          <div
            key={recipient.id}
            className={cn(
              "rounded-[11px] border p-3",
              recipient.isThisHost ? "border-brand/35 bg-brand/5" : "border-border bg-muted/20",
            )}
          >
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-stretch sm:gap-3">
              <div className="min-w-0 flex-1 rounded-[10px] border border-border bg-muted/25 px-3 py-2.5">
                <div className="flex items-center gap-2.5">
                  <span className="inline-flex size-8.5 shrink-0 items-center justify-center rounded-[9px] bg-muted text-foreground">
                    <RecipientKindIcon kind={recipient.kind} className="size-4.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="min-w-0 truncate font-medium font-mono text-sm">
                      {recipient.label}
                    </div>
                    <div className="mt-0.5 flex min-w-0 items-center gap-2">
                      {recipient.isThisHost && <ThisHostChip />}
                      <span className="truncate text-[11px] text-muted-foreground">
                        {recipientKindLabel(recipient.kind)}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted-foreground">
                    {recipient.publicKey}
                  </code>
                  <CopyIconButton
                    label={`Copy ${recipient.label} public key`}
                    onCopy={() => onCopy(recipient.publicKey)}
                  />
                </div>
              </div>

              <div className="flex shrink-0 flex-col items-center justify-center gap-1.5 rounded-[10px] border border-border bg-muted/25 px-3 py-2.5 text-center sm:min-w-40">
                <span className="text-[11.5px] text-muted-foreground">
                  {opensLabel(recipient.id)}
                </span>
                <InRepoBadge inRepo={recipient.inUse} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
