"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_CONFIG_DIR,
  STARTER_TEMPLATES,
  type StarterTemplateId,
} from "@/components/widget/onboarding/lib/flake-ref";
import { useDarwinConfig } from "@/hooks/use-darwin-config";
import { tauriAPI } from "@/ipc/api";
import { useUiState } from "@nixmac/state";
import { cn } from "@/lib/utils";

interface CreateSourceProps {
  onCreated?: () => void;
}

/**
 * Scaffold a starter configuration: create an empty config dir, then copy the
 * selected bundled template into it for the named host.
 */
export function CreateSource({ onCreated }: CreateSourceProps) {
  const { prepareNewDir, bootstrap } = useDarwinConfig();
  const [templateId, setTemplateId] = useState<StarterTemplateId>("nix-darwin-determinate");
  const [hostName, setHostName] = useState("");
  const [dir, setDir] = useState(DEFAULT_CONFIG_DIR);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Suggest this Mac's hostname as the default config name.
  useEffect(() => {
    let cancelled = false;
    // deprecated(orpc): replace with client/orpc from @/lib/orpc
    tauriAPI.config
      .getThisHostname()
      .then((name) => {
        if (!cancelled && name.trim()) setHostName((current) => current || name.trim());
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const host = (hostName.trim() || "this-mac").replace(/[^\w-]/g, "-");

  async function create() {
    setError(null);
    setCreating(true);
    try {
      // deprecated(orpc): replace with client/orpc from @/lib/orpc
      const normalized = await tauriAPI.path.normalize(dir.trim() || DEFAULT_CONFIG_DIR);
      await prepareNewDir(normalized);
      await bootstrap(host, templateId);
      const storeError = useUiState.getState().error;
      if (storeError) {
        setError(storeError);
        return;
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
          Custom paths are symlinked to <code className="font-mono">/etc/nix-darwin</code>.
        </p>
      </div>

      <Button
        onClick={create}
        disabled={creating}
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
