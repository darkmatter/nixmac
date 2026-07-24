import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CopyIconButton, InRepoBadge, RecipientKindIcon, ThisHostChip } from "./shared";
import type { SecretsVault } from "./types";

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
    const count = vault.secrets.filter((s) => s.recipientIds.includes(recipientId)).length;
    return `Opens ${count} ${count === 1 ? "secret" : "secrets"}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-base">Keys &amp; recipients</h2>
          <p className="mt-1 max-w-[560px] text-[13px] text-muted-foreground">
            Every recipient here is an age public key that can be granted access to a secret. A
            recipient must be committed to the repo before it can decrypt anything.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onAddRecipient}>
          <Plus aria-hidden="true" />
          Add recipient key
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        {vault.recipients.map((recipient) => (
          <div
            key={recipient.id}
            className={cn(
              "flex items-center gap-3.5 rounded-[11px] border px-4 py-3",
              recipient.isThisHost ? "border-brand/35 bg-brand/5" : "border-border bg-muted/20",
            )}
          >
            <span className="inline-flex size-8.5 items-center justify-center rounded-[9px] bg-muted text-foreground">
              <RecipientKindIcon kind={recipient.kind} className="size-4.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium font-mono text-sm">{recipient.label}</span>
                {recipient.isThisHost && <ThisHostChip />}
                <span className="text-[11px] text-muted-foreground">
                  {recipient.kind === "host" ? "Host key" : "User key"}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-1.5">
                <code className="max-w-[340px] truncate font-mono text-[11.5px] text-muted-foreground">
                  {recipient.publicKey}
                </code>
                <CopyIconButton
                  label={`Copy ${recipient.label} public key`}
                  onCopy={() => onCopy(recipient.publicKey)}
                />
              </div>
            </div>
            <span className="whitespace-nowrap text-[11.5px] text-muted-foreground">
              {opensLabel(recipient.id)}
            </span>
            <InRepoBadge inRepo={recipient.inRepo} />
          </div>
        ))}
      </div>
    </div>
  );
}
