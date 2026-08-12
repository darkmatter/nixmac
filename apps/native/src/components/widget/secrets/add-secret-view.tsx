import { CornerDownRight, Lock } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { SecretBackend, SecretsVault } from "@/ipc/orpc-bindings";
import { cn } from "@/lib/utils";
import { recipientKindLabel, RecipientKindIcon, ViewHeader } from "./shared";
import { type ApplyRequest, slugifySecretName } from "./types";

export function buildAddRequest(
  slug: string,
  backend: SecretBackend,
  vault: SecretsVault,
): ApplyRequest {
  if (backend === "agenix") {
    if (
      !vault.agenixRulesFile ||
      !vault.agenixDeclarationFile ||
      !vault.agenixEncryptedDirectoryFromDeclaration
    ) {
      throw new Error(
        "The repository's agenix rules and declaration module must be discoverable before reviewing this change.",
      );
    }
    const encryptedFile = `secrets/${slug}.age`;
    const declarationPath = `${vault.agenixEncryptedDirectoryFromDeclaration}/${slug}.age`;
    return {
      origin: "add",
      backend,
      title: "Encrypt & commit",
      subtitle: `New secret · ${slug}`,
      files: [
        { path: encryptedFile, note: "· encrypted", mark: "+" },
        { path: vault.agenixRulesFile, note: "· recipients added", mark: "~" },
        { path: vault.agenixDeclarationFile, note: "· declaration added", mark: "~" },
      ],
      diffFile: vault.agenixDeclarationFile,
      diff: [
        { kind: "meta", text: "@@ agenix @@" },
        {
          kind: "added",
          text: `+ age.secrets."${slug}".file = builtins.path { path = ${declarationPath}; };`,
        },
      ],
      commit: "",
      commitMsg: `secrets: add ${slug} (agenix)`,
    };
  }

  // SOPS backend
  return {
    origin: "add",
    backend,
    title: "Encrypt & commit",
    subtitle: `New secret · ${slug}`,
    files: [
      { path: "secrets/secrets.yaml", note: "· encrypted update", mark: "~" },
      { path: "sops secrets module", note: "· declaration added", mark: "~" },
    ],
    diffFile: "secrets/secrets.yaml",
    diff: [
      { kind: "meta", text: "@@ sops-nix @@" },
      { kind: "context", text: "  # encrypted with .sops.yaml creation rules" },
      { kind: "added", text: `+ ${slug}: ENC[AES256_GCM,data:••••••,type:str]` },
    ],
    commit: "",
    commitMsg: `secrets: add ${slug} (sops)`,
  };
}

/**
 * The add-secret form: backend, name, value, runtime path preview, and the
 * recipients derived from repository configuration. Submitting hands a
 * ready-to-review {@link ApplyRequest} and plaintext payload to the caller.
 */
export function AddSecretView({
  vault,
  onSubmit,
  onBack,
}: {
  vault: SecretsVault;
  onSubmit: (
    request: ApplyRequest,
    secret: { secretId: string; value: string; backend: SecretBackend },
  ) => void;
  onBack: () => void;
}) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [hidden, setHidden] = useState(true);
  const [backend, setBackend] = useState<SecretBackend>("sops");

  const slug = slugifySecretName(name);
  const encryptTarget =
    backend === "agenix" ? `secrets/${slug}.age` : `secrets/secrets.yaml  ›  ${slug}`;
  const runtimePath = backend === "agenix" ? `/run/agenix/${slug}` : `/run/secrets/${slug}`;
  const agenixTargetsAvailable = Boolean(
    vault.agenixRulesFile &&
    vault.agenixDeclarationFile &&
    vault.agenixEncryptedDirectoryFromDeclaration,
  );
  const invalid =
    !name.trim() || !value.trim() || (backend === "agenix" && !agenixTargetsAvailable);
  const committedRecipients = vault.recipients.filter((recipient) =>
    recipient.registrations.some((registration) => registration.backend === backend),
  );

  const submit = () => {
    if (invalid) return;
    onSubmit(buildAddRequest(slug, backend, vault), { secretId: slug, value, backend });
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
          <div className="inline-flex rounded-md border border-border bg-muted p-0.5">
            {(["sops", "agenix"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={backend === option}
                onClick={() => setBackend(option)}
                className={cn(
                  "cursor-pointer rounded px-2.5 py-1 font-medium font-mono text-[11px] transition-colors",
                  backend === option
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground",
                )}
              >
                {option === "sops" ? "sops-nix" : "agenix"}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {backend === "agenix"
            ? "One age-encrypted file, using the recipients in the repository's agenix rules."
            : "YAML encrypted with the repository's SOPS creation rules."}
        </p>
        {backend === "agenix" && !agenixTargetsAvailable && (
          <p role="alert" className="mt-1 text-destructive text-[11px]">
            Could not find both the agenix rules file and the module containing age.secrets.
          </p>
        )}
      </div>

      <div>
        <label
          htmlFor="secret-value"
          className="mb-1.5 flex items-center justify-between font-medium text-xs"
        >
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
        <span className="mb-1 block font-medium text-xs">Recipients — who can decrypt</span>
        <p className="mb-2 text-[11px] text-muted-foreground">
          Encryption uses the recipients registered in the repository&apos;s{" "}
          {backend === "agenix" ? "agenix rules" : <code className="font-mono">.sops.yaml</code>}.
        </p>
        <div className="flex flex-col gap-1.5">
          {committedRecipients.length === 0 && (
            <p className="rounded-[9px] border border-border px-3 py-2 text-[11px] text-muted-foreground">
              No recipients are registered for this backend. Adding the secret will fail until one
              is configured.
            </p>
          )}
          {committedRecipients.map((recipient) => {
            return (
              <div
                key={recipient.id}
                aria-label={`Recipient ${recipient.label}`}
                className="flex items-center gap-2.5 rounded-[9px] border border-border px-3 py-2 text-left"
              >
                <RecipientKindIcon kind={recipient.kind} className="text-muted-foreground" />
                <span className="font-medium font-mono text-[13px]">{recipient.label}</span>
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {recipientKindLabel(recipient.kind)}
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
