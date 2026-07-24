import {
  AtSign,
  Check,
  ClipboardPaste,
  Cpu,
  KeyRound,
  Laptop,
  TriangleAlert,
  Usb,
  X,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { SecretRecipient, SecretsVault } from "./types";

type Method = "paste" | "github" | "ssh" | "local" | "hardware";

const METHODS: { id: Method; label: string; hint: string; icon: typeof AtSign }[] = [
  { id: "paste", label: "Paste an age key", hint: "age1… from anywhere", icon: ClipboardPaste },
  { id: "github", label: "GitHub user", hint: "github.com/<user>.keys", icon: AtSign },
  { id: "ssh", label: "SSH public key", hint: "converted with ssh-to-age", icon: KeyRound },
  { id: "local", label: "This Mac", hint: "sops/age/keys.txt", icon: Laptop },
  { id: "hardware", label: "Hardware key", hint: "YubiKey · Secure Enclave", icon: Usb },
];

/** Bech32-looking mock output — deterministic so story snapshots are stable. */
function mockDerivedKey(seed: string, hrp: string): string {
  const alphabet = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let out = "";
  for (let i = 0; i < 30; i++) {
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
    out += alphabet[(h >>> (i % 24)) & 31];
  }
  return hrp + out;
}

function mockFingerprint(key: string): string {
  return `SHA256:${key.slice(4, 8)} ${key.slice(8, 12)} … ${key.slice(-4)}`;
}

function slugify(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "new-recipient"
  );
}

interface DerivedKey {
  publicKey: string;
  source: string;
  defaultLabel: string;
  device: string;
}

function KeyPreview({ derived }: { derived: DerivedKey }) {
  return (
    <div className="rounded-[9px] border border-success/30 bg-success/10 px-3 py-2.5">
      <div className="flex items-center gap-1.5 font-medium text-success text-xs">
        <Check className="size-3" aria-hidden="true" />
        age recipient
      </div>
      <code className="mt-1 block break-all font-mono text-foreground text-xs">
        {derived.publicKey}
      </code>
      <div className="mt-1 text-[11px] text-muted-foreground">{derived.source}</div>
    </div>
  );
}

/**
 * Modal for registering a new age recipient. Every method converges on the
 * same thing — an age public key — it only differs in where the key comes
 * from. Mock-only: conversions and detection are simulated.
 */
export function AddRecipientDialog({
  vault,
  onSubmit,
  onCancel,
}: {
  vault: SecretsVault;
  onSubmit: (recipient: SecretRecipient) => void;
  onCancel: () => void;
}) {
  const [method, setMethod] = useState<Method>("paste");
  const [label, setLabel] = useState("");
  const [pasted, setPasted] = useState("");
  const [githubUser, setGithubUser] = useState("");
  const [githubFetched, setGithubFetched] = useState(false);
  const [sshKey, setSshKey] = useState("");
  const [hardwareKind, setHardwareKind] = useState<"yubikey" | "se" | null>(null);

  const host = vault.recipients.find((r) => r.id === vault.hostId);

  // Each method resolves to a derived key (or an explanation why not).
  let derived: DerivedKey | null = null;
  let problem: string | null = null;

  if (method === "paste") {
    const trimmed = pasted.trim();
    if (trimmed.startsWith("age1")) {
      derived = {
        publicKey: trimmed,
        source: "Used as-is",
        defaultLabel: "",
        device: "age public key",
      };
    } else if (trimmed.length > 0) {
      problem = "Not an age public key — it should start with age1.";
    }
  } else if (method === "github") {
    if (githubFetched && githubUser.trim()) {
      derived = {
        publicKey: mockDerivedKey(`gh:${githubUser.trim()}`, "age1"),
        source: `ssh-ed25519 key from github.com/${githubUser.trim()}.keys · converted with ssh-to-age`,
        defaultLabel: githubUser.trim(),
        device: `GitHub · ${githubUser.trim()}`,
      };
    }
  } else if (method === "ssh") {
    const trimmed = sshKey.trim();
    if (trimmed.startsWith("ssh-ed25519")) {
      derived = {
        publicKey: mockDerivedKey(trimmed, "age1"),
        source: "Converted with ssh-to-age",
        defaultLabel: "",
        device: "SSH key · ssh-to-age",
      };
    } else if (trimmed.startsWith("ssh-")) {
      problem = "ssh-to-age only supports ssh-ed25519 keys — RSA and ECDSA can't be converted.";
    } else if (trimmed.length > 0) {
      problem = "Paste an OpenSSH public key line (ssh-ed25519 AAAA…).";
    }
  } else if (method === "local" && host) {
    derived = {
      publicKey: host.publicKey,
      source: "Derived with age-keygen -y from the private key",
      defaultLabel: host.label,
      device: "This Mac",
    };
  } else if (method === "hardware" && hardwareKind) {
    derived =
      hardwareKind === "yubikey"
        ? {
            publicKey: mockDerivedKey("yubikey-5c", "age1yubikey1"),
            source: "age-plugin-yubikey · PIV slot 9a on YubiKey 5C",
            defaultLabel: "yubikey-5c",
            device: "FIDO2 · age-plugin-yubikey",
          }
        : {
            publicKey: mockDerivedKey("secure-enclave", "age1se1"),
            source: "age-plugin-se · key generated in this Mac's Secure Enclave",
            defaultLabel: "secure-enclave",
            device: "Secure Enclave · age-plugin-se",
          };
  }

  const alreadyRegistered =
    derived && vault.recipients.find((r) => r.publicKey === derived.publicKey);
  const effectiveLabel = label.trim() || derived?.defaultLabel || "";
  const canSubmit = !!derived && !alreadyRegistered && effectiveLabel.length > 0;

  const submit = () => {
    if (!derived || !canSubmit) return;
    onSubmit({
      id: slugify(effectiveLabel),
      label: effectiveLabel,
      kind: method === "local" ? "host" : "user",
      device: derived.device,
      publicKey: derived.publicKey,
      fingerprint: mockFingerprint(derived.publicKey),
      inRepo: true,
    });
  };

  return (
    /* backdrop click-to-dismiss mirrors the app's overlay pattern */
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/55 duration-150 animate-in fade-in"
      onClick={onCancel}
    >
      {/* click here must not dismiss the backdrop */}
      <div
        role="dialog"
        aria-label="Add recipient key"
        className="flex max-h-[85%] w-[620px] flex-col overflow-hidden rounded-[14px] border border-border bg-popover shadow-2xl duration-200 animate-in slide-in-from-bottom-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-border border-b px-5 py-4">
          <div>
            <h3 className="font-semibold text-[15px]">Add recipient key</h3>
            <p className="mt-0.5 text-muted-foreground text-xs">
              Every recipient is an age public key — pick where this one comes from.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onCancel}
            className="inline-flex cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="flex w-[190px] flex-shrink-0 flex-col gap-1 border-border border-r p-2.5">
            {METHODS.map(({ id, label: methodLabel, hint, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setMethod(id)}
                className={cn(
                  "cursor-pointer rounded-lg px-2.5 py-2 text-left transition-colors",
                  method === id ? "bg-muted" : "hover:bg-muted/50",
                )}
              >
                <span className="flex items-center gap-2 font-medium text-xs">
                  <Icon
                    className={cn(
                      "size-3.5",
                      method === id ? "text-foreground" : "text-muted-foreground",
                    )}
                    aria-hidden="true"
                  />
                  {methodLabel}
                </span>
                <span className="mt-0.5 block pl-5.5 font-mono text-[10px] text-muted-foreground">
                  {hint}
                </span>
              </button>
            ))}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            {method === "paste" && (
              <div>
                <label htmlFor="recipient-paste" className="mb-1.5 block font-medium text-xs">
                  age public key
                </label>
                <Textarea
                  id="recipient-paste"
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  rows={2}
                  placeholder="age1…"
                  className="font-mono"
                />
              </div>
            )}

            {method === "github" && (
              <div>
                <label htmlFor="recipient-github" className="mb-1.5 block font-medium text-xs">
                  GitHub username
                </label>
                <div className="flex gap-2">
                  <Input
                    id="recipient-github"
                    value={githubUser}
                    onChange={(e) => {
                      setGithubUser(e.target.value);
                      setGithubFetched(false);
                    }}
                    placeholder="e.g. octocat"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9"
                    disabled={!githubUser.trim()}
                    onClick={() => setGithubFetched(true)}
                  >
                    Fetch keys
                  </Button>
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Reads{" "}
                  <code className="font-mono text-foreground">
                    github.com/{githubUser.trim() || "<user>"}.keys
                  </code>{" "}
                  and converts each ssh-ed25519 key with ssh-to-age.
                </p>
                {githubFetched && (
                  <div className="mt-2 flex items-center gap-2 rounded-[9px] border border-border bg-muted/15 px-3 py-2 text-[11px] text-muted-foreground">
                    <TriangleAlert className="size-3.5 flex-shrink-0 text-warning" aria-hidden="true" />
                    1 of 2 keys skipped — ssh-rsa can't be converted by ssh-to-age.
                  </div>
                )}
              </div>
            )}

            {method === "ssh" && (
              <div>
                <label htmlFor="recipient-ssh" className="mb-1.5 block font-medium text-xs">
                  OpenSSH public key
                </label>
                <Textarea
                  id="recipient-ssh"
                  value={sshKey}
                  onChange={(e) => setSshKey(e.target.value)}
                  rows={3}
                  placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5… user@host"
                  className="font-mono"
                />
              </div>
            )}

            {method === "local" && (
              <div className="flex flex-col gap-2">
                <div className="rounded-[9px] border border-border bg-muted/15 px-3 py-2.5">
                  <div className="flex items-center gap-1.5 font-medium text-xs">
                    <Check className="size-3 text-success" aria-hidden="true" />
                    Key file found
                  </div>
                  <code className="mt-1 block font-mono text-muted-foreground text-xs">
                    ~/.config/sops/age/keys.txt
                  </code>
                  <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
                    Checked <code className="font-mono">$XDG_CONFIG_HOME/sops/age/keys.txt</code>,
                    then <code className="font-mono">SOPS_AGE_KEY_FILE</code> — 1 identity found.
                  </p>
                </div>
              </div>
            )}

            {method === "hardware" && (
              <div className="flex flex-col gap-2">
                {(
                  [
                    {
                      kind: "yubikey" as const,
                      icon: Usb,
                      title: "YubiKey",
                      desc: "age-plugin-yubikey — detect a plugged-in key",
                    },
                    {
                      kind: "se" as const,
                      icon: Cpu,
                      title: "Secure Enclave",
                      desc: "age-plugin-se — generate a key in this Mac's Secure Enclave",
                    },
                  ]
                ).map(({ kind, icon: Icon, title, desc }) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setHardwareKind(kind)}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-[9px] border px-3 py-2.5 text-left",
                      hardwareKind === kind ? "border-primary bg-primary/5" : "border-border",
                    )}
                  >
                    <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                    <span>
                      <span className="block font-medium text-[13px]">{title}</span>
                      <span className="block text-[11px] text-muted-foreground">{desc}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}

            {problem && (
              <div className="flex items-center gap-2 rounded-[9px] border border-warning/30 bg-warning/10 px-3 py-2 text-warning text-xs">
                <TriangleAlert className="size-3.5 flex-shrink-0" aria-hidden="true" />
                {problem}
              </div>
            )}

            {derived && <KeyPreview derived={derived} />}

            {alreadyRegistered && (
              <div className="flex items-center gap-2 rounded-[9px] border border-border bg-muted/15 px-3 py-2 text-muted-foreground text-xs">
                <Check className="size-3.5 flex-shrink-0 text-success" aria-hidden="true" />
                Already registered as{" "}
                <span className="font-medium font-mono text-foreground">
                  {alreadyRegistered.label}
                </span>
                — nothing to add.
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2.5 border-border border-t px-5 py-3.5">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={derived?.defaultLabel ? `Label — ${derived.defaultLabel}` : "Label, e.g. work-laptop"}
            className="h-8 max-w-[240px] text-[13px]"
            aria-label="Recipient label"
          />
          <span className="flex-1" />
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" disabled={!canSubmit} onClick={submit}>
            <KeyRound aria-hidden="true" />
            Register &amp; review
          </Button>
        </div>
      </div>
    </div>
  );
}
