import type { SecretsVault } from "@/ipc/orpc-bindings";

/**
 * Demo fixture for Storybook — mirrors the reference design's data. No value
 * here is a real credential.
 */
export const MOCK_VAULT: SecretsVault = {
	hostId: "demo-mbp",
	recipients: [
		{
			id: "demo-mbp",
			label: "Demo-MacBook-Pro",
			kind: "host",
			device: "This Mac",
			publicKey: "age1qy8x0v4k2n7pq3wl9d0m5s8t1r6c4h2j",
			fingerprint: "SHA256:0f2a b7e4 … 9c1d",
			inUse: true,
			isThisHost: true,
		},
		{
			id: "work-mini",
			label: "work-mac-mini",
			kind: "host",
			device: "Mac mini · office",
			publicKey: "age1ld0k2r7m4s9pqx3v6n8t1w5c2h4j7q0",
			fingerprint: "SHA256:77b1 3ac9 … 4e02",
			inUse: true,
			isThisHost: false,
		},
		{
			id: "yubikey",
			label: "yubikey-personal",
			kind: "user",
			device: "FIDO2 · age-plugin-yubikey",
			publicKey: "age1yubikey1qw8x3v0k2m7n4p9s6t1r5c2",
			fingerprint: "SHA256:a3c9 12ff … 1f88",
			inUse: true,
			isThisHost: false,
		},
		{
			id: "framework",
			label: "framework-13",
			kind: "host",
			device: "NixOS · staged, not committed",
			publicKey: "age1f3w9d2z0k8rql5m7n4p6s1t3v2c9h0j",
			fingerprint: "SHA256:b8e0 44ad … 9a15",
			inUse: false,
			isThisHost: false,
		},
	],
	entries: [
		{
			id: "github-token",
			name: "github-token",
			backend: "agenix",
			file: "secrets/github-token.age",
			recipientIds: ["demo-mbp", "work-mini"],
			sopsKey: null,
		},
		{
			id: "tailscale-authkey",
			name: "tailscale-authkey",
			backend: "agenix",
			file: "secrets/tailscale.age",
			recipientIds: ["demo-mbp"],
			sopsKey: null,
		},
		{
			id: "anthropic-api-key",
			name: "anthropic-api-key",
			backend: "agenix",
			file: "secrets/anthropic.age",
			recipientIds: ["demo-mbp", "yubikey"],
			sopsKey: null,
		},
		{
			id: "wifi-password",
			name: "wifi_password",
			backend: "sops",
			file: "secrets/network.yaml",
			sopsKey: "wifi_password",
			recipientIds: ["demo-mbp", "work-mini"],
		},
		{
			id: "cachix-signing-key",
			name: "cachix_signing_key",
			backend: "sops",
			file: "secrets/cachix.yaml",
			sopsKey: "signing_key",
			recipientIds: ["work-mini"],
		},
	],
};
