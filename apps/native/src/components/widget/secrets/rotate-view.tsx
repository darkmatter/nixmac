import { RefreshCw } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ViewHeader } from "./shared";
import { type ApplyRequest, backendLabel, type SecretsVault } from "./types";

function buildRotateRequest(vault: SecretsVault, selectedIds: string[], freshValue: boolean): ApplyRequest {
  return {
    origin: "rotate",
    title: "Re-encrypt & commit",
    subtitle: `Re-key ${selectedIds.length} secrets`,
    files: vault.secrets
      .filter((s) => selectedIds.includes(s.id))
      .map((s) => ({ path: s.file, note: "· re-encrypted", mark: "~" as const })),
    diffFile: "secrets/",
    diff: [
      { kind: "meta", text: `@@ re-encrypting ${selectedIds.length} files @@` },
      { kind: "context", text: "  # recipients unchanged — re-sealing to current publicKeys" },
      ...(freshValue ? [{ kind: "added" as const, text: "+ generating fresh secret material" }] : []),
    ],
    commit: "e5f6a7b",
    commitMsg: `secrets: re-encrypt ${selectedIds.length} files`,
  };
}

/**
 * Rotate & re-key: pick which secrets to re-seal to their current recipient
 * list, optionally regenerating the underlying value.
 */
export function RotateView({
  vault,
  onSubmit,
  onBack,
}: {
  vault: SecretsVault;
  onSubmit: (request: ApplyRequest) => void;
  onBack: () => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>(vault.secrets.map((s) => s.id));
  const [freshValue, setFreshValue] = useState(false);

  const toggle = (id: string) =>
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-4">
      <ViewHeader title="Rotate & re-key" onBack={onBack} />
      <p className="text-[13px] text-muted-foreground">
        Re-encrypt secrets to their current recipient list — run this after adding or removing a key
        so every selected file can be decrypted by the right hosts.
      </p>

      <div className="flex flex-col gap-1.5">
        {vault.secrets.map((secret) => {
          const checked = selectedIds.includes(secret.id);
          const recipientCount = secret.recipientIds.length;
          return (
            <div
              key={secret.id}
              role="checkbox"
              aria-checked={checked}
              aria-label={`Re-encrypt ${secret.name}`}
              tabIndex={0}
              onClick={() => toggle(secret.id)}
              onKeyDown={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  toggle(secret.id);
                }
              }}
              className={cn(
                "flex cursor-pointer items-center gap-2.5 rounded-[9px] border border-border px-3 py-2 text-left",
                checked && "bg-primary/5",
              )}
            >
              <Checkbox
                checked={checked}
                aria-hidden="true"
                tabIndex={-1}
                className="pointer-events-none"
              />
              <span className="font-medium font-mono text-[13px]">{secret.name}</span>
              <span className="rounded border border-border px-1 font-mono text-[10.5px] text-muted-foreground">
                {backendLabel(secret.backend)}
              </span>
              <span className="ml-auto text-[11.5px] text-muted-foreground">
                {recipientCount} {recipientCount === 1 ? "recipient" : "recipients"}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2.5 rounded-[9px] border border-border bg-muted/20 px-3 py-2.5">
        <Switch
          checked={freshValue}
          onCheckedChange={setFreshValue}
          aria-label="Also generate a fresh value"
        />
        <div>
          <div className="font-medium text-[13px]">Also generate a fresh value</div>
          <div className="text-[11.5px] text-muted-foreground">
            Rotate the underlying secret, not just its encryption
          </div>
        </div>
      </div>

      <div className="flex gap-2.5">
        <Button
          disabled={selectedIds.length === 0}
          onClick={() => onSubmit(buildRotateRequest(vault, selectedIds, freshValue))}
        >
          <RefreshCw aria-hidden="true" />
          Re-encrypt &amp; review
        </Button>
        <Button variant="ghost" onClick={onBack}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
