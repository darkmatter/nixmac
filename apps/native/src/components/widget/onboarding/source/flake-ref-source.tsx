"use client";

import { useMemo, useState } from "react";
import { Check, FileArchive, Link2, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EXAMPLE_REFS, parseFlakeRef } from "@/components/widget/onboarding/lib/flake-ref";
import { useDarwinConfig } from "@/hooks/use-darwin-config";
import { client } from "@/lib/orpc";
import { cn } from "@/lib/utils";

interface FlakeRefSourceProps {
  onImported?: () => void;
}

/**
 * Advanced import: accepts a GitHub ref (`github:owner/repo[/branch]`) or a
 * local path, plus a `.zip` archive picker. Other flakeref kinds are
 * recognized but gated until the backend wires them up.
 */
export function FlakeRefSource({ onImported }: FlakeRefSourceProps) {
  const { setDir, importGithub, pickZip, importZip } = useDarwinConfig();
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [zipLoading, setZipLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseFlakeRef(value), [value]);
  const touched = value.trim().length > 0;
  const canUse = parsed.valid && parsed.importable;

  async function use() {
    if (!canUse) return;
    setError(null);
    setLoading(true);
    try {
      if (parsed.type === "github") {
        // github:owner/repo[/branch] -> owner/repo[#branch] for config.importGithub
        const rest = value.trim().replace(/^github:/i, "");
        const [owner, repo, ...refParts] = rest.split("/");
        const branch = refParts.join("/");
        const repoRef = branch ? `${owner}/${repo}#${branch}` : `${owner}/${repo}`;
        await importGithub(repoRef, ".darwin");
      } else {
        const normalized = await client.path.normalize({
          input: value.trim().replace(/^path:/i, ""),
        });
        await setDir(normalized);
      }
      onImported?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function importArchive() {
    setError(null);
    const path = await pickZip();
    if (!path) return;
    setZipLoading(true);
    try {
      await importZip(path, ".darwin");
      onImported?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setZipLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label htmlFor="flake-ref" className="mb-1.5 block font-medium text-sm">
          Flake reference or local path
        </label>
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg border bg-background px-3 py-2 transition-colors focus-within:ring-2 focus-within:ring-ring",
            touched && !parsed.valid ? "border-destructive" : "border-input",
          )}
        >
          <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            id="flake-ref"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void use();
            }}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            placeholder="github:owner/repo  ·  ~/Documents/nix-darwin"
            className="w-full bg-transparent font-mono text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div className="mt-2 min-h-5 text-xs" aria-live="polite">
          {touched && parsed.valid ? (
            <span
              className={cn(
                "flex items-center gap-1.5",
                parsed.importable ? "text-success" : "text-warning",
              )}
            >
              {parsed.importable ? (
                <Check className="size-3.5" aria-hidden="true" />
              ) : (
                <TriangleAlert className="size-3.5" aria-hidden="true" />
              )}
              <span className="font-medium">{parsed.label}</span>
              <span className="text-muted-foreground">— {parsed.hint}</span>
            </span>
          ) : touched && !parsed.valid ? (
            <span className="flex items-center gap-1.5 text-destructive">
              <TriangleAlert className="size-3.5" aria-hidden="true" />
              {parsed.hint}
            </span>
          ) : (
            <span className="text-muted-foreground">
              Supports <code className="font-mono">github:owner/repo</code> and local paths today.
            </span>
          )}
        </div>
      </div>

      <div>
        <p className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Examples
        </p>
        <div className="flex flex-wrap gap-2">
          {EXAMPLE_REFS.map((ex) => (
            <button
              key={ex.ref}
              type="button"
              onClick={() => setValue(ex.ref)}
              className="group flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-left transition-colors hover:border-primary/50"
            >
              <code className="font-mono text-foreground text-xs">{ex.ref}</code>
              <span className="text-[11px] text-muted-foreground">{ex.note}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={use} disabled={!canUse || loading} className="flex-1">
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Importing…
            </>
          ) : (
            "Use this reference"
          )}
        </Button>
        <Button variant="secondary" onClick={importArchive} disabled={zipLoading}>
          {zipLoading ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Importing…
            </>
          ) : (
            <>
              <FileArchive className="size-4" aria-hidden="true" />
              Import a .zip
            </>
          )}
        </Button>
      </div>

      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}
