export type SecretBackend = "sops" | "agenix";

export type RecipientKind = "host" | "user";

/** An age public key that can be granted access to secrets in the repo. */
export interface SecretRecipient {
  id: string;
  label: string;
  kind: RecipientKind;
  device: string;
  publicKey: string;
  fingerprint: string;
  /** A recipient must be committed to the repo before it can decrypt anything. */
  inRepo: boolean;
  isThisHost?: boolean;
}

/** One encrypted secret tracked in the nix config repo. */
export interface SecretEntry {
  id: string;
  name: string;
  backend: SecretBackend;
  file: string;
  /** sops only — the key inside the encrypted YAML file. */
  sopsKey?: string;
  recipientIds: string[];
  /** Mock plaintext, shown behind the reveal confirmation. */
  value: string;
  updated: string;
  encryptedSize: string;
}

export interface SecretsVault {
  hostId: string;
  recipients: SecretRecipient[];
  secrets: SecretEntry[];
}

export type SecretsTab = "vault" | "keys";

export type SecretsView =
  | { kind: "browse" }
  | { kind: "add" }
  | { kind: "detail"; secretId: string }
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
  origin: "add" | "rotate" | "prompt" | "register";
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

export function secretPathDisplay(secret: SecretEntry): string {
  return secret.backend === "sops" && secret.sopsKey
    ? `${secret.file}  ›  ${secret.sopsKey}`
    : secret.file;
}

export function canHostDecrypt(secret: SecretEntry, hostId: string): boolean {
  return secret.recipientIds.includes(hostId);
}

export function hostRecipient(vault: SecretsVault): SecretRecipient {
  const host = vault.recipients.find((r) => r.id === vault.hostId);
  if (!host) throw new Error(`secrets vault has no recipient for host "${vault.hostId}"`);
  return host;
}

export function slugifySecretName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "new-secret"
  );
}
