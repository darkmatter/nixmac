import { tauriAPI } from "@/ipc/api";
import type { ConfigurableSnapshot, JsonValue } from "@/ipc/types";
import { SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AutoConfigField } from "@/components/widget/settings/auto-config-field";
import { BackupRestoreSection } from "@/components/widget/settings/backup-restore-section";

/**
 * Tuning settings — knobs that control how the evolution loop behaves.
 *
 * Renders every `#[derive(Configurable)]` struct registered with the backend
 * inventory as auto-generated form fields. Adding a new struct in Rust creates
 * a new sub-section here automatically, with no frontend changes needed.
 *
 * Also includes Backup & Restore for settings export/import.
 */
export function TuningTab() {
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
    <div className="space-y-6">
      <div>
        <h2 className="mb-1 font-semibold text-base">Tuning</h2>
        <p className="text-muted-foreground text-xs">
          Knobs that control how the evolution loop behaves. Changes take effect on the next run.
        </p>
      </div>

      {/* Auto-generated configurable sections */}
      <div className="rounded-lg border border-border p-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Evolution settings
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Saved to <code className="rounded bg-muted px-1 font-mono">.nixmac/settings.json</code> in
          your config repo so they sync across machines.
        </p>

        {loadError && (
          <p className="text-destructive text-xs">Failed to load settings schema: {loadError}</p>
        )}

        <div className="space-y-5">
          {snapshots.map((snapshot) => (
            <SnapshotSection
              key={snapshot.schema.name}
              snapshot={snapshot}
              showHeader={snapshots.length > 1}
            />
          ))}
        </div>
      </div>

      {/* Backup & Restore */}
      <BackupRestoreSection />
    </div>
  );
}

function SnapshotSection({
  snapshot,
  showHeader,
}: {
  snapshot: ConfigurableSnapshot;
  showHeader: boolean;
}) {
  const valuesByKey = useMemo(() => {
    const map = new Map<string, JsonValue>();
    for (const value of snapshot.values) {
      map.set(value.key, value.current);
    }
    return map;
  }, [snapshot.values]);

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
        {snapshot.schema.fields.map((field) => (
          <AutoConfigField
            key={field.key}
            structName={snapshot.schema.name}
            field={field}
            current={valuesByKey.get(field.key) ?? null}
          />
        ))}
      </div>
    </section>
  );
}
