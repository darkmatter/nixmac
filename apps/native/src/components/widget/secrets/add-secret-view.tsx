import { CornerDownRight, Lock } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { RecipientKindIcon, ViewHeader } from "./shared";
import {
  type ApplyRequest,
  backendLabel,
  type SecretBackend,
  type SecretsVault,
  slugifySecretName,
} from "./types";

function buildAddRequest(slug: string, backend: SecretBackend, recipientLabels: string[]): ApplyRequest {
  if (backend === "agenix") {
    return {
      origin: "add",
      title: "Encrypt & commit",
      subtitle: `New secret · ${slug}`,
      files: [{ path: `secrets/${slug}.age`, note: "· new", mark: "+" }],
      diffFile: "secrets/secrets.nix",
      diff: [
        { kind: "meta", text: "@@ agenix recipients @@" },
        { kind: "context", text: "  age.secrets = {" },
        { kind: "added", text: `+   "${slug}.age".publicKeys = [ ${recipientLabels.join(" ")} ];` },
        { kind: "context", text: "  };" },
      ],
      commit: "a1b2c3d",
      commitMsg: `secrets: add ${slug}`,
    };
  }
  return {
    origin: "add",
    title: "Encrypt & commit",
    subtitle: `New secret · ${slug}`,
    files: [{ path: "secrets/secrets.yaml", note: "· updated", mark: "~" }],
    diffFile: "secrets/secrets.yaml",
    diff: [
      { kind: "meta", text: "@@ sops-nix @@" },
      { kind: "context", text: "  # encrypted with .sops.yaml creation rules" },
      { kind: "added", text: `+ ${slug}: ENC[AES256_GCM,data:••••••,type:str]` },
    ],
    commit: "a1b2c3d",
    commitMsg: `secrets: add ${slug} (sops)`,
  };
}

/**
 * The add-secret form: name, backend choice, value, runtime path preview,
 * agent-tool exposure, and the recipient checklist. Submitting hands a
 * ready-to-review {@link ApplyRequest} to the apply sheet.
 */
export function AddSecretView({
  vault,
  onSubmit,
  onBack,
}: {
  vault: SecretsVault;
  onSubmit: (request: ApplyRequest) => void;
  onBack: () => void;
}) {
  const committedRecipients = vault.recipients.filter((r) => r.inRepo);

  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [backend, setBackend] = useState<SecretBackend>("sops");
  const [hidden, setHidden] = useState(true);
  // Every committed host key is a recipient by default — machines should be
  // able to open their own config's secrets; user keys stay opt-in.
  const [recipientIds, setRecipientIds] = useState<string[]>(
    committedRecipients.filter((r) => r.kind === "host").map((r) => r.id),
  );

  const slug = slugifySecretName(name);
  const encryptTarget = backend === "agenix" ? `secrets/${slug}.age` : `secrets/secrets.yaml  ›  ${slug}`;
  const runtimePath = (backend === "agenix" ? "/run/agenix/" : "/run/secrets/") + slug;
  const invalid = !name.trim() || !value.trim();

  const toggleRecipient = (id: string) => {
    if (id === vault.hostId) return;
    setRecipientIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  };

  const submit = () => {
    if (invalid) return;
    const labels = committedRecipients
      .filter((r) => recipientIds.includes(r.id))
      .map((r) => r.label);
    onSubmit(buildAddRequest(slug, backend, labels));
  };

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-4">
      <ViewHeader title="Add a secret" onBack={onBack} />

      <div>
        <label htmlFor="secret-name" className="mb-1.5 block font-medium text-xs">
          Name
        </label>
        <Input
          id="secret-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. github-token"
        />
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="font-medium text-xs">Backend</span>
          <div className="inline-flex gap-0.5 rounded-md border border-border bg-background/60 p-0.5">
            {(["sops", "agenix"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setBackend(option)}
                className={cn(
                  "cursor-pointer rounded-[5px] px-2.5 py-1 font-medium font-mono text-[11px] transition-colors",
                  backend === option
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {backendLabel(option)}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {backend === "sops"
            ? "Recommended — YAML file with .sops.yaml rules; decrypts to a runtime path and can be exposed to the agent."
            : "Per-file age recipients in secrets.nix."}
        </p>
      </div>

      <div>
        <label htmlFor="secret-value" className="mb-1.5 flex items-center justify-between font-medium text-xs">
          Value
          <button
            type="button"
            onClick={() => setHidden((h) => !h)}
            className="cursor-pointer text-[11px] text-muted-foreground"
          >
            {hidden ? "hidden" : "shown"}
          </button>
        </label>
        <Textarea
          id="secret-value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={2}
          placeholder="Paste the plaintext value — it is encrypted before it ever touches disk"
          className={cn("font-mono", hidden && "[-webkit-text-security:disc]")}
        />
        <p className="mt-1.5 text-[11.5px] text-muted-foreground">
          Encrypts to <code className="font-mono text-foreground">{encryptTarget}</code>
        </p>
      </div>

      <div className="rounded-[9px] border border-border bg-muted/15 px-3 py-2.5">
        <div className="flex items-center gap-2 font-medium text-xs">
          <CornerDownRight className="size-3.5" aria-hidden="true" />
          Runtime path
        </div>
        <code className="mt-1.5 block font-mono text-foreground text-xs">{runtimePath}</code>
        <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
          Decrypted to this path at activation so programs can read the plaintext. Set{" "}
          <code className="font-mono text-foreground">owner</code>/
          <code className="font-mono text-foreground">mode</code> to scope who can read it.
        </p>
      </div>

      <div>
        <span className="mb-2 block font-medium text-xs">Recipients — who can decrypt</span>
        <div className="flex flex-col gap-1.5">
          {committedRecipients.map((recipient) => {
            const checked = recipientIds.includes(recipient.id);
            const locked = recipient.id === vault.hostId;
            return (
              <div
                key={recipient.id}
                role="checkbox"
                aria-checked={checked}
                aria-disabled={locked}
                aria-label={`Recipient ${recipient.label}`}
                tabIndex={0}
                onClick={() => toggleRecipient(recipient.id)}
                onKeyDown={(e) => {
                  if (e.key === " " || e.key === "Enter") {
                    e.preventDefault();
                    toggleRecipient(recipient.id);
                  }
                }}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-[9px] border border-border px-3 py-2 text-left",
                  checked && "bg-primary/5",
                )}
              >
                <Checkbox
                  checked={checked}
                  disabled={locked}
                  aria-hidden="true"
                  tabIndex={-1}
                  className="pointer-events-none"
                />
                <RecipientKindIcon kind={recipient.kind} className="text-muted-foreground" />
                <span className="font-medium font-mono text-[13px]">{recipient.label}</span>
                {locked && <span className="text-[10.5px] text-brand">required — this host</span>}
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {recipient.kind === "host" ? "Host key" : "User key"}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex gap-2.5 pt-1">
        <Button disabled={invalid} onClick={submit}>
          <Lock aria-hidden="true" />
          Encrypt &amp; review
        </Button>
        <Button variant="ghost" onClick={onBack}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
