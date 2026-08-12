import React from "react";

/**
 * Toggle switch — 32×18px track, sliding thumb. On = `--primary`, off =
 * `--input`. For login items, opt-in flags, and settings booleans.
 */
export function Switch({ checked, defaultChecked = false, onCheckedChange, disabled = false, style }) {
  const isControlled = checked !== undefined;
  const [internal, setInternal] = React.useState(defaultChecked);
  const on = isControlled ? checked : internal;
  const toggle = () => {
    if (disabled) return;
    if (!isControlled) setInternal(!on);
    onCheckedChange && onCheckedChange(!on);
  };
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={toggle}
      disabled={disabled}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        height: "1.15rem",
        width: 32,
        flexShrink: 0,
        borderRadius: "var(--radius-full)",
        border: "1px solid transparent",
        background: on ? "var(--primary)" : "color-mix(in oklch, var(--input) 80%, transparent)",
        boxShadow: "var(--shadow-xs)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "background .15s",
        padding: 0,
        ...style,
      }}
    >
      <span
        style={{
          display: "block",
          width: 16,
          height: 16,
          borderRadius: "var(--radius-full)",
          background: on ? "var(--primary-foreground)" : "var(--foreground)",
          transform: on ? "translateX(calc(100% - 2px))" : "translateX(0)",
          transition: "transform .15s",
        }}
      />
    </button>
  );
}
