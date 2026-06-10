import { tauriAPI } from "@/ipc/api";
import type { ConfigurableSnapshot, JsonValue } from "@/ipc/types";
import { SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AutoConfigField } from "@/components/widget/settings/auto-config-field";

/**
 * Single section that renders every `#[derive(Configurable)]` struct
 * registered with the backend inventory. Each struct becomes a sub-section
 * with auto-generated form fields. Adding a new struct in Rust = new
 * sub-section here automatically, no frontend changes needed.
 */
export function AutoTuningSection() {
  const [snapshots, setSnapshots] = useState<ConfigurableSnapshot[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await tauriAPI.devConfigs.list();
      // In environments where the Tauri command isn't registered (Storybook,
      // tests), invoke can resolve with null instead of an array.
      setSnapshots(Array.isArray(next) ? next : []);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Tuning
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Knobs that control how the evolution loop behaves. Changes take effect on the next run.
        Saved to <code className="rounded bg-muted px-1 font-mono">.nixmac/settings.json</code> in
        your config repo so they sync across machines.
      </p>

      {loadError && (
        <p className="text-destructive text-xs">Failed to load settings schema: {loadError}</p>
      )}

      <div className="space-y-5">
        {snapshots.map((snapshot, index) => (
          <SnapshotSection
            key={snapshot.schema.name}
            snapshot={snapshot}
            showHeader={snapshots.length > 1}
            onCommit={async (key, value) => {
              const next = await commitField(snapshot, key, value);
              // Mutate the local snapshot in place so the next field commit
              // reads back the freshly persisted value. React doesn't re-render
              // anything because AutoConfigField owns its own field-level
              // optimistic state; the snapshot is only consulted on the next
              // commit's payload construction.
              setSnapshots((prev) => {
                const copy = prev.slice();
                copy[index] = next;
                return copy;
              });
            }}
          />
        ))}
      </div>
    </div>
  );
}

function SnapshotSection({
  snapshot,
  showHeader,
  onCommit,
}: {
  snapshot: ConfigurableSnapshot;
  showHeader: boolean;
  onCommit: (key: string, value: unknown) => Promise<void>;
}) {
  return (
    <section className="space-y-3">
      {showHeader && (
        <div>
          <h3 className="font-medium text-xs">{snapshot.schema.displayName}</h3>
          {snapshot.schema.description && (
            <p className="text-muted-foreground text-[10px]">{snapshot.schema.description}</p>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        {snapshot.schema.fields.map((field) => {
          const current = snapshot.values.find((v) => v.key === field.key)?.current ?? null;
          return (
            <AutoConfigField
              key={field.key}
              structName={snapshot.schema.name}
              field={field}
              current={current}
              onCommit={onCommit}
            />
          );
        })}
      </div>
    </section>
  );
}

/**
 * Builds the whole-struct payload by overlaying the new value on the snapshot's
 * existing values, POSTs it via `devConfigs.set`, and returns the next snapshot
 * so the parent can keep its state in sync.
 *
 * The backend (Serde) clobbers any concurrent backend-side edits to other
 * fields — that's fine for a single-user dev settings panel.
 */
async function commitField(
  snapshot: ConfigurableSnapshot,
  key: string,
  value: unknown,
): Promise<ConfigurableSnapshot> {
  const nextValues = snapshot.values.map((v) =>
    v.key === key ? { ...v, current: value as JsonValue } : v,
  );
  const payload: Record<string, unknown> = {};
  for (const v of nextValues) {
    payload[v.key] = v.current;
  }
  await tauriAPI.devConfigs.set(snapshot.schema.name, payload);
  return { ...snapshot, values: nextValues };
}
