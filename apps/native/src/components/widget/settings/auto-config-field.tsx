import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { tauriAPI } from "@/ipc/api";
import type { ConfigFieldSchema, JsonValue } from "@/ipc/types";
import { Info } from "lucide-react";
import { useState } from "react";

interface Props {
  /** Stable identifier of the Configurable struct this field belongs to. */
  structName: string;
  /** Static field metadata sourced from the backend schema. */
  field: ConfigFieldSchema;
  /** Current value loaded from the managed observable, looked up by key
   *  from the snapshot's `values` array. */
  current: JsonValue;
  /** Called after a successful save with the new value so the parent can
   *  refresh the schema or surface a status message. Optional. */
  onSaved?: (key: string, value: unknown) => void;
}

/**
 * Renders the appropriate control for a `ConfigFieldSchema` based on
 * `field.ty.kind` and writes changes back through `tauriAPI.devConfigs.set`.
 * Local optimistic state keeps the input snappy while the backend persists.
 * On error, reverts and surfaces the message inline.
 */
export function AutoConfigField({ structName, field, current, onSaved }: Props) {
  const [value, setValue] = useState<unknown>(current);
  const [error, setError] = useState<string | null>(null);

  const commit = async (next: unknown) => {
    const previous = value;
    setValue(next);
    setError(null);
    try {
      await tauriAPI.devConfigs.set(structName, field.key, next);
      onSaved?.(field.key, next);
    } catch (e) {
      setValue(previous);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const labelRow = (
    <div className="flex items-center gap-2">
      <label className="text-xs font-medium text-muted-foreground" htmlFor={inputId(structName, field.key)}>
        {field.label}
      </label>
      {field.help && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground/70"
              aria-label={`${field.label} info`}
            >
              <Info className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-xs text-xs">
            {field.help}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );

  const errorRow = error && <p className="mt-1 text-destructive text-xs">{error}</p>;

  switch (field.ty.kind) {
    case "number": {
      const numericValue = typeof value === "number" ? value : Number(value ?? 0);
      return (
        <div className="space-y-2">
          {labelRow}
          <Input
            id={inputId(structName, field.key)}
            type="number"
            min={field.ty.min ?? undefined}
            max={field.ty.max ?? undefined}
            step={field.ty.step ?? undefined}
            value={Number.isFinite(numericValue) ? numericValue : ""}
            onChange={(e) => {
              // Update local state immediately for responsiveness; commit on blur.
              const next = Number.parseFloat(e.target.value);
              setValue(Number.isFinite(next) ? next : e.target.value);
            }}
            onBlur={() => {
              const next = Number.parseFloat(String(value));
              if (Number.isFinite(next)) commit(next);
            }}
          />
          {errorRow}
        </div>
      );
    }
    case "boolean": {
      const checked = Boolean(value);
      return (
        <div className="flex items-center justify-between">
          {labelRow}
          <Switch
            id={inputId(structName, field.key)}
            checked={checked}
            onCheckedChange={(next) => commit(next)}
          />
          {errorRow}
        </div>
      );
    }
    case "string": {
      const stringValue = typeof value === "string" ? value : "";
      if (field.ty.multiline) {
        return (
          <div className="space-y-2">
            {labelRow}
            <Textarea
              id={inputId(structName, field.key)}
              value={stringValue}
              onChange={(e) => setValue(e.target.value)}
              onBlur={() => commit(value)}
            />
            {errorRow}
          </div>
        );
      }
      return (
        <div className="space-y-2">
          {labelRow}
          <Input
            id={inputId(structName, field.key)}
            type="text"
            value={stringValue}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => commit(value)}
          />
          {errorRow}
        </div>
      );
    }
    case "enum": {
      const selectedValue = typeof value === "string" ? value : "";
      return (
        <div className="space-y-2">
          {labelRow}
          <Select value={selectedValue} onValueChange={(next) => commit(next)}>
            <SelectTrigger id={inputId(structName, field.key)}>
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              {field.ty.variants.map((v) => (
                <SelectItem key={v.value} value={v.value}>
                  {v.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errorRow}
        </div>
      );
    }
  }
}

function inputId(structName: string, key: string): string {
  return `auto-${structName}-${key}`;
}
