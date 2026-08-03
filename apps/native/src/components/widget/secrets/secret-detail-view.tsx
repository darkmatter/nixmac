import {
  Check,
  CircleHelp,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { client } from "@/lib/orpc";
import { RecipientKindIcon, ViewHeader } from "./shared";
import { backendLabel } from "./types";
import type { SecretEntry, SecretsVault } from "@/ipc/orpc-bindings";

/**
 * One secret's encrypted metadata and recipient access.
 *
 * The shared vault response intentionally contains no plaintext, so value
 * reveal stays unavailable until a separate, explicit decrypt command exists.
 */
export function SecretDetailView({
  vault,
  secret,
  onRotate,
  onNotImplemented,
  onBack,
}: {
  vault: SecretsVault;
  secret: SecretEntry;
  onRotate: () => void;
  onNotImplemented: () => void;
  onBack: () => void;
}) {
  const MASKED_SECRET_VALUE = "****************";
  const readOnly = true; // TODO: implement edit flow
  const capability = secret.decryptionCapability;
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [decryptedValue, setDecryptedValue] = useState<string | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [isRevealed, setIsRevealed] = useState(false);

  // Secrets are always readable at their runtime path; an agent tool is a
  // deliberate, per-secret opt-in.
  const [toolEnabled, setToolEnabled] = useState(false);
  const toolSupported = secret.backend === "sops";

  const onToggleReveal = async () => {
    if (isRevealed) {
      setIsRevealed(false);
      return;
    }

    if (decryptedValue !== null) {
      setIsRevealed(true);
      return;
    }

    setIsDecrypting(true);
    setRevealError(null);
    try {
      const plaintext = await client.secrets.decryptSecret({ secretId: secret.id });
      setDecryptedValue(plaintext);
      setIsRevealed(true);
    } catch (error) {
      setRevealError(error instanceof Error ? error.message : "Failed to decrypt secret");
    } finally {
      setIsDecrypting(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-165 flex-col gap-4">
      <ViewHeader title={secret.name} onBack={onBack} mono>
        <span className="rounded border border-border px-1.5 py-px font-mono text-[11px] text-muted-foreground">
          {backendLabel(secret.backend)}
        </span>
      </ViewHeader>

      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-[9px] border border-border px-3 py-2.5">
          <div className="text-[11px] text-muted-foreground">File</div>
          <code className="font-mono text-xs">{secret.file}</code>
        </div>
        <div className="rounded-[9px] border border-border px-3 py-2.5">
          <div className="text-[11px] text-muted-foreground">SOPS key</div>
          <code className="font-mono text-xs">{secret.sopsKey ?? "—"}</code>
        </div>
      </div>

      <div className="rounded-[11px] border border-border bg-muted/20 px-4 py-3.5">
        <div className="mb-2.5 font-medium text-xs">Decrypted value</div>
        {capability !== "unavailable" ? (
          <div className="flex flex-col gap-2">
            {capability === "unknown" ? (
              <div className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                <CircleHelp className="size-3.5" aria-hidden="true" />
                Capability is unknown; revealing will ask SOPS to try the identities available to
                this process.
              </div>
            ) : null}
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Lock className="size-3.5" aria-hidden="true" />
              <code className="font-mono text-xs whitespace-pre-wrap break-all text-foreground">
                {isRevealed && decryptedValue !== null ? decryptedValue : MASKED_SECRET_VALUE}
              </code>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="ml-auto size-7"
                disabled={isDecrypting}
                aria-label={isRevealed ? "Hide decrypted secret" : "Reveal decrypted secret"}
                onClick={() => void onToggleReveal()}
              >
                {isDecrypting ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : isRevealed ? (
                  <EyeOff className="size-3.5" aria-hidden="true" />
                ) : (
                  <Eye className="size-3.5" aria-hidden="true" />
                )}
              </Button>
            </div>
            {revealError && <div className="text-[11.5px] text-destructive">{revealError}</div>}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[13px] text-warning">
            <Lock className="size-3.5" aria-hidden="true" />
            No usable local decryption identity is available.
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 font-medium text-xs">Public recipients recorded for this secret</div>
        <div className="flex flex-col gap-1.5">
          {!secret.publicRecipientsResolved ? (
            <div className="rounded-[9px] border border-border px-3 py-2 text-[11.5px] text-muted-foreground">
              Recipient metadata could not be resolved; this does not establish that decryption is
              unavailable.
            </div>
          ) : null}
          {secret.publicRecipients.map((publicKey) => {
            const recipient = vault.recipients.find(
              (candidate) => candidate.publicKey === publicKey,
            );
            return (
              <div
                key={publicKey}
                className="flex items-center gap-2.5 rounded-[9px] border border-border px-3 py-2"
              >
                <RecipientKindIcon
                  kind={recipient?.kind ?? "unknown"}
                  className="text-muted-foreground"
                />
                <span className="min-w-0 truncate font-mono text-[13px]">
                  {recipient?.label ?? publicKey}
                </span>
                {recipient?.isLocalIdentity && (
                  <span className="text-[10.5px] text-brand">local identity</span>
                )}
                <span className="ml-auto">
                  <span className="inline-flex items-center gap-1 text-[11.5px] text-success">
                    <Check className="size-3" aria-hidden="true" />
                    recorded recipient
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {!readOnly && (
        <>
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
                    <code className="font-mono text-foreground">use_secret.{secret.id}</code> to
                    read this value at its runtime path — without ever printing the plaintext.
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
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={onNotImplemented}
            >
              <Trash2 aria-hidden="true" />
              Delete
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
