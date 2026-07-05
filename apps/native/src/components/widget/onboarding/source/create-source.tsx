"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, GitBranch, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RepoRefInput } from "@/components/widget/controls/repo-ref-input";
import {
  DEFAULT_CONFIG_DIR,
  STARTER_TEMPLATES,
  parseFlakeRef,
  type StarterTemplateId,
} from "@/components/widget/onboarding/lib/flake-ref";
import { useDarwinConfig } from "@/hooks/use-darwin-config";
import { useThisHostname } from "@/hooks/use-this-hostname";
import { client } from "@/lib/orpc";
import { useUiState } from "@nixmac/state";
import { cn } from "@/lib/utils";

interface CreateSourceProps {
  onCreated?: () => void;
}

/** The bundled starter templates, or a user-provided template repository. */
type TemplateChoice = StarterTemplateId | "custom";

/**
 * Scaffold a starter configuration for the named host: a bundled template
 * copied into a fresh config dir, or — via "Custom template" — any repository
 * (or subdirectory of one), whose files are copied without inheriting the
 * template's git history.
 */
export function CreateSource({ onCreated }: CreateSourceProps) {
  const { prepareNewDir, bootstrap, createFromTemplate } = useDarwinConfig();
  const [templateId, setTemplateId] = useState<TemplateChoice>("nix-darwin-determinate");
  const [templateRef, setTemplateRef] = useState("");
  const [hostName, setHostName] = useState("");
  const [dir, setDir] = useState(DEFAULT_CONFIG_DIR);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchedHost = useThisHostname();

  // Suggest this Mac's hostname as the default config name.
  useEffect(() => {
    if (fetchedHost) setHostName((current) => current || fetchedHost);
  }, [fetchedHost]);

  const host = (hostName.trim() || "this-mac").replace(/[^\w-]/g, "-");
  const parsedTemplateRef = useMemo(() => parseFlakeRef(templateRef), [templateRef]);
  const customRefReady = parsedTemplateRef.valid && parsedTemplateRef.importable;
  const canCreate = !creating && (templateId !== "custom" || customRefReady);

  async function create() {
    if (!canCreate) return;
    setError(null);
    setCreating(true);
    try {
      const normalized = await client.path.normalize({
        input: dir.trim() || DEFAULT_CONFIG_DIR,
      });
      if (templateId === "custom") {
        // Atomic on the backend: clone + validation happen before the config
        // dir is selected, so failures land here while we're still mounted.
        await createFromTemplate(templateRef.trim(), host, normalized);
      } else {
        await prepareNewDir(normalized);
        await bootstrap(host, templateId);
        const storeError = useUiState.getState().error;
        if (storeError) {
          setError(storeError);
          return;
        }
      }
      onCreated?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Template picker */}
      <fieldset>
        <legend className="mb-2 font-medium text-sm">Pick a starting template</legend>
        <div className="flex flex-col gap-2">
          {STARTER_TEMPLATES.map((t) => {
            const active = templateId === t.id;
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={active}
                onClick={() => setTemplateId(t.id)}
                className={cn(
                  "flex items-start gap-3 rounded-xl border p-3.5 text-left transition-colors",
                  active ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-accent",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
                    active ? "border-primary bg-primary text-primary-foreground" : "border-input",
                  )}
                  aria-hidden="true"
                >
                  {active ? <Check className="size-3.5" /> : null}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-sm">{t.name}</span>
                    {t.recommended ? (
                      <span className="rounded-full bg-success/15 px-1.5 py-0.5 font-semibold text-[10px] text-success">
                        Recommended
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-pretty text-muted-foreground text-sm">
                    {t.description}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {t.includes.map((inc) => (
                      <span
                        key={inc}
                        className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                      >
                        {inc}
                      </span>
                    ))}
                  </div>
                </div>
              </button>
            );
          })}

          {/* Custom remote template */}
          <button
            type="button"
            aria-pressed={templateId === "custom"}
            onClick={() => setTemplateId("custom")}
            data-testid="create-custom-template-card"
            className={cn(
              "flex items-start gap-3 rounded-xl border p-3.5 text-left transition-colors",
              templateId === "custom"
                ? "border-primary bg-primary/5"
                : "border-border bg-card hover:bg-accent",
            )}
          >
            <span
              className={cn(
                "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
                templateId === "custom"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input",
              )}
              aria-hidden="true"
            >
              {templateId === "custom" ? <Check className="size-3.5" /> : null}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <GitBranch className="size-3.5 text-muted-foreground" aria-hidden="true" />
                <span className="font-medium text-sm">Custom template</span>
              </div>
              <p className="mt-0.5 text-pretty text-muted-foreground text-sm">
                Start from any GitHub repository, or a subdirectory of one. Files are copied — the
                template&apos;s git history is not.
              </p>
            </div>
          </button>

          {templateId === "custom" ? (
            <div className="rounded-xl border border-primary/40 bg-card p-3.5">
              <label
                htmlFor="custom-template-ref"
                className="mb-1.5 block font-medium text-sm"
              >
                Template repository
              </label>
              <RepoRefInput
                id="custom-template-ref"
                value={templateRef}
                parsed={parsedTemplateRef}
                onChange={(next) => {
                  setTemplateRef(next);
                  setError(null);
                }}
                onSubmit={() => void create()}
                placeholder="github:owner/repo?dir=templates/mac"
                idleHint={
                  <>
                    e.g. <code className="font-mono">github:owner/repo?dir=templates/mac</code> —
                    supports <code className="font-mono">?ref=</code> and{" "}
                    <code className="font-mono">?dir=</code>.
                  </>
                }
              />
            </div>
          ) : null}
        </div>
      </fieldset>

      {/* Host name */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="new-host" className="font-medium text-sm">
          Name this Mac
        </label>
        <input
          id="new-host"
          value={hostName}
          onChange={(e) => setHostName(e.target.value)}
          placeholder="this-mac"
          className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p className="text-muted-foreground text-xs">
          Becomes <code className="font-mono">darwinConfigurations.{host}</code> in your flake.
        </p>
      </div>

      {/* Destination */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="new-dir" className="font-medium text-sm">
          Where to save it
        </label>
        <input
          id="new-dir"
          value={dir}
          onChange={(e) => setDir(e.target.value)}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p className="text-muted-foreground text-xs">
          We&apos;ll write a <code className="font-mono">flake.nix</code> here and initialize git.
          Any path in your home directory works, <code className="font-mono">~</code> included
          (e.g. <code className="font-mono">~/dev/nix-darwin</code>); missing folders are created.
          Custom paths are symlinked to <code className="font-mono">/etc/nix-darwin</code>.
        </p>
      </div>

      <Button
        onClick={create}
        disabled={!canCreate}
        className="self-start"
        data-testid="create-default-config-button"
      >
        {creating ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Creating configuration…
          </>
        ) : (
          <>
            <Sparkles className="size-4" aria-hidden="true" />
            Create my configuration
          </>
        )}
      </Button>

      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}
