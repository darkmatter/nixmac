// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { Clock, Folder, Settings } from "lucide-react";
import type { ReactNode } from "react";

import { MOCK_VAULT } from "./mock-data";
import { SecretsManagement, type SecretsManagementProps } from "./secrets-management";

const meta = preview.meta({
  title: "Widget/Secrets/SecretsManagement",
  component: SecretsManagement,
  parameters: { layout: "centered" },
});

export default meta;

/** The 980×720 macOS window frame from the reference design. */
function AppWindow({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex h-[720px] w-[980px] flex-col overflow-hidden rounded-[14px] border border-white/10 bg-background shadow-2xl">
      <div className="relative flex flex-shrink-0 items-center justify-center border-border border-b bg-card/50 px-3 py-2.5">
        <div className="absolute left-3 flex gap-2">
          <span className="size-3 rounded-full bg-[#ff5f57]" />
          <span className="size-3 rounded-full bg-[#febc2e]" />
          <span className="size-3 rounded-full bg-[#28c840]" />
        </div>
        <h3 className="font-medium text-muted-foreground text-xs">nixmac — secrets</h3>
        <div className="absolute right-3 flex gap-0.5 text-muted-foreground">
          <span className="inline-flex p-1.5">
            <Folder className="size-3.5" aria-hidden="true" />
          </span>
          <span className="inline-flex p-1.5">
            <Clock className="size-3.5" aria-hidden="true" />
          </span>
          <span className="inline-flex p-1.5">
            <Settings className="size-3.5" aria-hidden="true" />
          </span>
        </div>
      </div>
      {children}
    </div>
  );
}

function framed(props: Partial<SecretsManagementProps> = {}) {
  return (
    <AppWindow>
      <SecretsManagement vault={MOCK_VAULT} {...props} />
    </AppWindow>
  );
}

/**
 * The vault: host identity (which key is this host, is it registered, what
 * can it open) above the full secrets table. Rows open the detail view; "Add
 * secret" and the prompt bar both end in the review → commit sheet.
 */
export const Vault = meta.story({
  render: () => framed(),
});

/**
 * Keys & recipients: every age public key the repo knows, who it is, how many
 * secrets it opens, and whether it is committed — including a staged key that
 * is not committed yet.
 */
export const KeysAndRecipients = meta.story({
  render: () => framed({ defaultTab: "keys" }),
});

/**
 * The add-secret form: compact backend toggle (sops-nix default, agenix),
 * masked value entry, runtime-path preview, and the recipient checklist with
 * every committed host preselected (this host locked on).
 */
export const AddSecret = meta.story({
  render: () => framed({ initialView: { kind: "add" } }),
});

/**
 * The add-recipient modal: one age public key, five sources — paste,
 * GitHub .keys (ssh-to-age), raw SSH key, this Mac's sops age key file,
 * and hardware plugins (age-plugin-yubikey / age-plugin-se). Registering
 * funnels through the same review → commit sheet.
 */
export const AddRecipient = meta.story({
  render: () => framed({ defaultTab: "keys", initialAddRecipientOpen: true }),
});

/**
 * Secret detail for a secret this host can decrypt: metadata, the
 * reveal-gated value (confirmation dialog → plaintext), and per-recipient
 * decrypt status.
 */
export const SecretDetail = meta.story({
  render: () => framed({ initialView: { kind: "detail", secretId: "github-token" } }),
});

/**
 * Secret detail when this host is not a recipient: no reveal affordance, an
 * amber explainer instead of the value, and Rotate & re-key as the way in.
 */
export const SecretDetailNoAccess = meta.story({
  render: () => framed({ initialView: { kind: "detail", secretId: "cachix-signing-key" } }),
});

/**
 * Rotate & re-key: choose which secrets to re-seal to their current
 * recipients, optionally regenerating the underlying value, then review the
 * re-encryption as a commit.
 */
export const RotateAndRekey = meta.story({
  render: () => framed({ initialView: { kind: "rotate" } }),
});

/**
 * The screen without the plain-English prompt bar, for embedding contexts
 * that already have a composer.
 */
export const WithoutPromptBar = meta.story({
  render: () => framed({ showPromptBar: false }),
});
