import type {
  SecretBackend,
  SecretEntry,
  SecretRecipient,
  SecretsVault,
} from "@/ipc/orpc-bindings";

export type SecretsTab = "vault" | "keys";

export type SecretsView =
  | { kind: "browse" }
  | { kind: "add" }
  | { kind: "edit"; secretId: string; backend: SecretBackend }
  | { kind: "detail"; secretId: string; backend: SecretBackend }
  | { kind: "rotate" };

export interface ApplyDiffLine {
  kind: "meta" | "context" | "added" | "removed";
  text: string;
}

export interface ApplyFileChip {
  path: string;
  note: string;
  mark: "+" | "~";
}

/** Payload for the review → build → commit sheet. */
export interface ApplyRequest {
  origin: "add" | "edit" | "rotate" | "prompt" | "register";
  /** Encryption backend for requests that operate on one backend. */
  backend?: SecretBackend;
  title: string;
  subtitle: string;
  plan?: string[];
  files: ApplyFileChip[];
  diffFile: string;
  diff: ApplyDiffLine[];
  commit: string;
  commitMsg: string;
}

export function backendLabel(backend: SecretBackend): string {
  return backend === "agenix" ? "agenix" : "sops-nix";
}

export function recipientKeyLabel(recipient: SecretRecipient): string {
  const keyType =
    recipient.keyType === "pgp"
      ? "PGP"
      : recipient.keyType === "ssh"
        ? "SSH"
        : recipient.keyType === "age"
          ? "age"
          : "key";

  switch (recipient.source) {
    case "sshHostKey":
      return `SSH host identity → ${keyType}`;
    case "sshIdentity":
      return `SSH identity → ${keyType}`;
    case "github":
      return `GitHub SSH key → ${keyType}`;
    case "ageKeyFile":
      return "age key file";
    case "yubikey":
      return `YubiKey → ${keyType}`;
    case "secureEnclave":
      return `Secure Enclave → ${keyType}`;
    default:
      return `${keyType} recipient`;
  }
}

export function secretPathDisplay(secret: SecretEntry): string {
  return secret.backend === "sops" && secret.sopsKey
    ? `${secret.file}  ›  ${secret.sopsKey}`
    : secret.file;
}

export function primaryDecryptionIdentity(vault: SecretsVault): SecretRecipient | null {
  if (!vault.primaryDecryptionIdentityId) return null;
  return vault.recipients.find((r) => r.id === vault.primaryDecryptionIdentityId) ?? null;
}

function canonicalPublicIdentity(value: string): string {
  const trimmed = value.trim();
  const fields = trimmed.split(/\s+/);
  return fields[0]?.startsWith("ssh-") && fields[1]
    ? `${fields[0]} ${fields[1]}`
    : trimmed;
}

/** Whether this public recipient has a corresponding local identity source. */
export function recipientHasLocalIdentity(
  vault: SecretsVault,
  recipient: SecretRecipient,
): boolean {
  const publicIdentity = canonicalPublicIdentity(recipient.publicKey);
  return vault.decryptionIdentities.some((identity) =>
    identity.publicKeys.some((key) => canonicalPublicIdentity(key) === publicIdentity),
  );
}

export function slugifySecretName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "new-secret"
  );
}
