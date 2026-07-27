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
	if (!host)
		throw new Error(
			`secrets vault has no recipient for host "${vault.hostId}"`,
		);
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
