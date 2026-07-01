import { tauriAPI } from "@/ipc/api";
import type { ConfigurableSchema, JsonValue } from "@/ipc/types";
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
  const [schemas, setSchemas] = useState<ConfigurableSchema[]>([]);
  const [values, setValues] = useState<Record<string, JsonValue>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextSchemas, nextValues] = await Promise.all([
        // deprecated(orpc): replace with client/orpc from @/lib/orpc
        tauriAPI.devConfigs.schemas(),
        // deprecated(orpc): replace with client/orpc from @/lib/orpc
        tauriAPI.devConfigs.values(),
      ]);
      // In environments where the Tauri command isn't registered (Storybook,
      // tests), invoke can resolve with null.
      setSchemas(Array.isArray(nextSchemas) ? nextSchemas : []);
      setValues(nextValues ?? {});
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
        {schemas.map((schema) => (
          <SchemaSection
            key={schema.name}
            schema={schema}
            structValues={readStructValues(values, schema.name)}
            showHeader={schemas.length > 1}
            onCommit={async (key, value) => {
              const next = await commitField(values, schema.name, key, value);
              setValues(next);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function SchemaSection({
  schema,
  structValues,
  showHeader,
  onCommit,
}: {
  schema: ConfigurableSchema;
  structValues: Record<string, JsonValue>;
  showHeader: boolean;
  onCommit: (key: string, value: unknown) => Promise<void>;
}) {
  return (
    <section className="space-y-3">
      {showHeader && (
        <div>
          <h3 className="font-medium text-xs">{schema.displayName}</h3>
          {schema.description && (
            <p className="text-muted-foreground text-[10px]">{schema.description}</p>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        {schema.fields.map((field) => (
          <AutoConfigField
            key={field.key}
            structName={schema.name}
            field={field}
            current={structValues[field.key] ?? null}
            onCommit={onCommit}
          />
        ))}
      </div>
    </section>
  );
}

function readStructValues(
  values: Record<string, JsonValue>,
  structName: string,
): Record<string, JsonValue> {
  const v = values[structName];
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, JsonValue>) : {};
}

/**
 * Builds the whole-struct payload by overlaying the new value on the struct's
 * existing values, POSTs it via `devConfigs.set`, and returns the next values
 * map so the parent can keep its state in sync.
 *
 * The backend (Serde) clobbers any concurrent backend-side edits to other
 * fields — that's fine for a single-user dev settings panel.
 */
async function commitField(
  values: Record<string, JsonValue>,
  structName: string,
  key: string,
  value: unknown,
): Promise<Record<string, JsonValue>> {
  const currentStruct = readStructValues(values, structName);
  const nextStruct = { ...currentStruct, [key]: value as JsonValue };
  // deprecated(orpc): replace with client/orpc from @/lib/orpc
  await tauriAPI.devConfigs.set(structName, nextStruct);
  return { ...values, [structName]: nextStruct };
}
