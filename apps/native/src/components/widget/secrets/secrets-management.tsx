import { ArrowRight, Check, KeyRound, Lock, Plus, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AddRecipientDialog } from "./add-recipient-dialog";
import { AddSecretView } from "./add-secret-view";
import { type ApplyPhase, ApplySheet } from "./apply-sheet";
import { KeysView } from "./keys-view";
import { RevealDialog } from "./reveal-dialog";
import { RotateView } from "./rotate-view";
import { SecretDetailView } from "./secret-detail-view";
import type {
  ApplyRequest,
  SecretRecipient,
  SecretsTab,
  SecretsVault,
  SecretsView,
} from "./types";
import { VaultView } from "./vault-view";

const BUILD_SIMULATION_MS = 1600;
const TOAST_MS = 2200;

/** Canned agent response for the prompt bar — mock only. */
function buildPromptRequest(prompt: string): ApplyRequest {
  return {
    origin: "prompt",
    title: "Review changes",
    subtitle: `“${prompt.trim()}”`,
    plan: [
      "Read secrets/secrets.nix",
      "Add work-mac-mini to agenix publicKeys",
      "Re-encrypt 3 .age files",
      "darwin-rebuild check",
    ],
    files: [
      { path: "secrets/secrets.nix", note: "· edited", mark: "~" },
      { path: "secrets/*.age", note: "· 3 re-encrypted", mark: "~" },
    ],
    diffFile: "secrets/secrets.nix",
    diff: [
      { kind: "meta", text: "@@ recipients @@" },
      { kind: "context", text: "  keys.all = [" },
      { kind: "context", text: "    demo-mbp" },
      { kind: "added", text: "+   work-mini" },
      { kind: "context", text: "  ];" },
    ],
    commit: "c9d0e1f",
    commitMsg: "secrets: grant work-mac-mini access",
  };
}

function buildRegisterRequest(recipient: SecretRecipient): ApplyRequest {
  return {
    origin: "register",
    title: "Register key & commit",
    subtitle: `New recipient · ${recipient.label}`,
    files: [
      { path: ".sops.yaml", note: "· updated", mark: "~" },
      { path: "secrets/secrets.nix", note: "· updated", mark: "~" },
    ],
    diffFile: ".sops.yaml",
    diff: [
      { kind: "meta", text: "@@ keys @@" },
      { kind: "context", text: "keys:" },
      { kind: "added", text: `+ - &${recipient.id} ${recipient.publicKey}` },
    ],
    commit: "b4c5d6e",
    commitMsg: `secrets: register ${recipient.id}`,
  };
}

export interface SecretsManagementProps {
  vault: SecretsVault;
  defaultTab?: SecretsTab;
  initialView?: SecretsView;
  showPromptBar?: boolean;
  /** Story-only: open the add-recipient dialog on mount. */
  initialAddRecipientOpen?: boolean;
}

/**
 * The secrets management screen: a vault of agenix/sops-nix secrets, the age
 * recipient keys that can open them, and add/detail/rotate flows that all
 * funnel through the review → darwin-rebuild check → commit sheet.
 *
 * Mock-only for now: all state is local and "apply" is simulated — no IPC.
 */
export function SecretsManagement({
  vault,
  defaultTab = "vault",
  initialView = { kind: "browse" },
  showPromptBar = true,
  initialAddRecipientOpen = false,
}: SecretsManagementProps) {
  const [tab, setTab] = useState<SecretsTab>(defaultTab);
  const [view, setView] = useState<SecretsView>(initialView);
  const [addRecipientOpen, setAddRecipientOpen] = useState(initialAddRecipientOpen);
  const [pendingRecipient, setPendingRecipient] = useState<SecretRecipient | null>(null);
  const [extraRecipients, setExtraRecipients] = useState<SecretRecipient[]>([]);
  const [revealedIds, setRevealedIds] = useState<Record<string, boolean>>({});
  const [revealTargetId, setRevealTargetId] = useState<string | null>(null);
  const [apply, setApply] = useState<ApplyRequest | null>(null);
  const [applyPhase, setApplyPhase] = useState<ApplyPhase>("review");
  const [prompt, setPrompt] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const buildTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(toastTimer.current);
      clearTimeout(buildTimer.current);
    },
    [],
  );

  const flash = (message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  };

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    flash("Copied to clipboard");
  };

  const notImplemented = () => flash("Demo — not wired up");

  const openApply = (request: ApplyRequest) => {
    setApply(request);
    setApplyPhase("review");
  };

  const runApply = () => {
    setApplyPhase("building");
    clearTimeout(buildTimer.current);
    buildTimer.current = setTimeout(() => setApplyPhase("done"), BUILD_SIMULATION_MS);
  };

  const finishApply = () => {
    const registered = apply?.origin === "register" ? pendingRecipient : null;
    if (registered) {
      setExtraRecipients((rs) => [...rs, registered]);
      setPendingRecipient(null);
    }
    setApply(null);
    setView({ kind: "browse" });
    setTab(registered ? "keys" : "vault");
    setPrompt("");
    flash("Committed to your config");
  };

  const browse = () => setView({ kind: "browse" });
  const effectiveVault: SecretsVault = {
    ...vault,
    recipients: [...vault.recipients, ...extraRecipients],
  };
  const selectedSecret =
    view.kind === "detail" ? vault.secrets.find((s) => s.id === view.secretId) : undefined;
  const revealTarget = vault.secrets.find((s) => s.id === revealTargetId);

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background font-sans text-foreground">
      <div className="flex flex-shrink-0 items-center justify-between border-border border-b bg-muted/20 px-3.5 py-2.5">
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value as SecretsTab);
            browse();
          }}
        >
          <TabsList>
            <TabsTrigger value="vault">
              <Lock className="size-3.5" aria-hidden="true" />
              Vault
            </TabsTrigger>
            <TabsTrigger value="keys">
              <KeyRound className="size-3.5" aria-hidden="true" />
              Keys &amp; recipients
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Button size="sm" onClick={() => setView({ kind: "add" })}>
          <Plus aria-hidden="true" />
          Add secret
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5.5 py-5">
        {view.kind === "browse" && tab === "vault" && (
          <VaultView
            vault={effectiveVault}
            onOpenSecret={(secretId) => setView({ kind: "detail", secretId })}
            onCopy={copy}
          />
        )}
        {view.kind === "browse" && tab === "keys" && (
          <KeysView
            vault={effectiveVault}
            onCopy={copy}
            onAddRecipient={() => setAddRecipientOpen(true)}
          />
        )}
        {view.kind === "add" && (
          <AddSecretView vault={effectiveVault} onSubmit={openApply} onBack={browse} />
        )}
        {view.kind === "detail" && selectedSecret && (
          <SecretDetailView
            vault={effectiveVault}
            secret={selectedSecret}
            revealed={!!revealedIds[selectedSecret.id]}
            onAskReveal={() => setRevealTargetId(selectedSecret.id)}
            onHide={() => setRevealedIds((ids) => ({ ...ids, [selectedSecret.id]: false }))}
            onCopyValue={() => copy(selectedSecret.value)}
            onRotate={() => setView({ kind: "rotate" })}
            onNotImplemented={notImplemented}
            onBack={browse}
          />
        )}
        {view.kind === "rotate" && (
          <RotateView vault={effectiveVault} onSubmit={openApply} onBack={browse} />
        )}
      </div>

      {showPromptBar && (
        <div className="flex flex-shrink-0 items-center gap-2 border-border border-t px-3.5 py-2">
          <Sparkles className="size-3.5 text-muted-foreground/70" aria-hidden="true" />
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Or describe a change in plain English…"
            className="h-7 flex-1 bg-transparent font-sans text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground"
          />
          {prompt.trim() && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-muted-foreground text-xs hover:text-foreground"
              onClick={() => openApply(buildPromptRequest(prompt))}
            >
              Evolve
              <ArrowRight aria-hidden="true" />
            </Button>
          )}
        </div>
      )}

      {toast && (
        <div className="absolute bottom-[78px] left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-md border border-border bg-popover px-3.5 py-2 text-[13px] shadow-2xl duration-200 animate-in slide-in-from-bottom-2">
          <Check className="size-3.5 text-success" aria-hidden="true" />
          {toast}
        </div>
      )}

      {addRecipientOpen && (
        <AddRecipientDialog
          vault={effectiveVault}
          onSubmit={(recipient) => {
            setPendingRecipient(recipient);
            setAddRecipientOpen(false);
            openApply(buildRegisterRequest(recipient));
          }}
          onCancel={() => setAddRecipientOpen(false)}
        />
      )}

      {revealTarget && (
        <RevealDialog
          secretName={revealTarget.name}
          onConfirm={() => {
            setRevealedIds((ids) => ({ ...ids, [revealTarget.id]: true }));
            setRevealTargetId(null);
          }}
          onCancel={() => setRevealTargetId(null)}
        />
      )}

      {apply && (
        <ApplySheet
          request={apply}
          phase={applyPhase}
          onCancel={() => setApply(null)}
          onApply={runApply}
          onDone={finishApply}
        />
      )}
    </div>
  );
}
