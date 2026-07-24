import { Check, Copy, Eye, EyeOff, Lock, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { RecipientKindIcon, ViewHeader } from "./shared";
import { backendLabel, canHostDecrypt, type SecretEntry, type SecretsVault } from "./types";

const MASKED_VALUE = "•••••••••••••••••••••••••";

/**
 * One secret: metadata, the (reveal-gated) decrypted value, and the recipient
 * list answering "can this host decrypt?".
 */
export function SecretDetailView({
  vault,
  secret,
  revealed,
  onAskReveal,
  onHide,
  onCopyValue,
  onRotate,
  onNotImplemented,
  onBack,
}: {
  vault: SecretsVault;
  secret: SecretEntry;
  revealed: boolean;
  onAskReveal: () => void;
  onHide: () => void;
  onCopyValue: () => void;
  onRotate: () => void;
  onNotImplemented: () => void;
  onBack: () => void;
}) {
  const canDecrypt = canHostDecrypt(secret, vault.hostId);
  const committedRecipients = vault.recipients.filter((r) => r.inRepo);

  // Secrets are always readable at their runtime path; an agent tool is a
  // deliberate, per-secret opt-in.
  const [toolEnabled, setToolEnabled] = useState(false);
  const toolSupported = secret.backend === "sops";

  return (
    <div className="mx-auto flex max-w-[660px] flex-col gap-4">
      <ViewHeader title={secret.name} onBack={onBack} mono>
        <span className="rounded border border-border px-1.5 py-px font-mono text-[11px] text-muted-foreground">
          {backendLabel(secret.backend)}
        </span>
      </ViewHeader>

      <div className="grid grid-cols-3 gap-2.5">
        <div className="rounded-[9px] border border-border px-3 py-2.5">
          <div className="text-[11px] text-muted-foreground">File</div>
          <code className="font-mono text-xs">{secret.file}</code>
        </div>
        <div className="rounded-[9px] border border-border px-3 py-2.5">
          <div className="text-[11px] text-muted-foreground">Updated</div>
          <span className="text-[13px]">{secret.updated}</span>
        </div>
        <div className="rounded-[9px] border border-border px-3 py-2.5">
          <div className="text-[11px] text-muted-foreground">Encrypted size</div>
          <span className="font-mono text-[13px]">{secret.encryptedSize}</span>
        </div>
      </div>

      <div className="rounded-[11px] border border-border bg-muted/20 px-4 py-3.5">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="font-medium text-xs">Decrypted value</span>
          {canDecrypt &&
            (revealed ? (
              <div className="flex gap-1.5">
                <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={onCopyValue}>
                  <Copy aria-hidden="true" />
                  Copy
                </Button>
                <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={onHide}>
                  <EyeOff aria-hidden="true" />
                  Hide
                </Button>
              </div>
            ) : (
              <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={onAskReveal}>
                <Eye aria-hidden="true" />
                Reveal
              </Button>
            ))}
        </div>
        {canDecrypt ? (
          <code
            className={cn(
              "block break-all font-mono text-[13px]",
              revealed ? "text-foreground" : "tracking-[2px] text-muted-foreground",
            )}
          >
            {revealed ? secret.value || "(empty)" : MASKED_VALUE}
          </code>
        ) : (
          <div className="flex items-center gap-2 text-[13px] text-warning">
            <Lock className="size-3.5" aria-hidden="true" />
            This host isn't a recipient — add it in Rotate &amp; re-key to decrypt here.
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 font-medium text-xs">Recipients — can this host decrypt?</div>
        <div className="flex flex-col gap-1.5">
          {committedRecipients.map((recipient) => {
            const isRecipient = secret.recipientIds.includes(recipient.id);
            return (
              <div
                key={recipient.id}
                className={cn(
                  "flex items-center gap-2.5 rounded-[9px] border border-border px-3 py-2",
                  !isRecipient && "opacity-55",
                )}
              >
                <RecipientKindIcon kind={recipient.kind} className="text-muted-foreground" />
                <span className="font-mono text-[13px]">{recipient.label}</span>
                {recipient.isThisHost && <span className="text-[10.5px] text-brand">this host</span>}
                <span className="ml-auto">
                  {isRecipient ? (
                    <span className="inline-flex items-center gap-1 text-[11.5px] text-success">
                      <Check className="size-3" aria-hidden="true" />
                      can decrypt
                    </span>
                  ) : (
                    <span className="text-[11.5px] text-muted-foreground/70">not a recipient</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div
        className={cn(
          "flex items-start gap-3 rounded-[9px] border border-border px-3 py-2.5",
          !toolSupported && "opacity-55",
          toolSupported && toolEnabled && "bg-primary/5",
        )}
      >
        <Switch
          checked={toolSupported && toolEnabled}
          disabled={!toolSupported}
          onCheckedChange={setToolEnabled}
          aria-label="Agent tool"
          className="mt-0.5"
        />
        <div className="flex-1">
          <div className="flex items-center gap-2 font-medium text-[13px]">
            Agent tool
            {!toolSupported && (
              <span className="rounded border border-border px-1 text-[10px] text-muted-foreground">
                sops-nix only
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[11.5px] text-muted-foreground leading-relaxed">
            {toolSupported && toolEnabled ? (
              <>
                nixmac's agent can call{" "}
                <code className="font-mono text-foreground">use_secret.{secret.id}</code> to read
                this value at its runtime path — without ever printing the plaintext.
              </>
            ) : (
              "Off by default. Enable to generate a scoped tool the agent can call to use this value — without ever printing the plaintext."
            )}
          </div>
        </div>
      </div>

      <div className="flex gap-2 pt-0.5">
        <Button variant="outline" size="sm" onClick={onNotImplemented}>
          <Pencil aria-hidden="true" />
          Edit value
        </Button>
        <Button variant="outline" size="sm" onClick={onRotate}>
          <RefreshCw aria-hidden="true" />
          Rotate &amp; re-key
        </Button>
        <Button variant="ghost" size="sm" className="text-destructive" onClick={onNotImplemented}>
          <Trash2 aria-hidden="true" />
          Delete
        </Button>
      </div>
    </div>
  );
}
