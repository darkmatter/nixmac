import React from "react";

/**
 * Checkbox — 16px, 4px radius. Checked fills with `--primary` and shows a
 * check. For multi-select lists and consent rows.
 */
export function Checkbox({ checked, defaultChecked = false, onCheckedChange, disabled = false, style }) {
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
      role="checkbox"
      aria-checked={on}
      onClick={toggle}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 16,
        height: 16,
        flexShrink: 0,
        borderRadius: 4,
        border: `1px solid ${on ? "var(--primary)" : "var(--input)"}`,
        background: on ? "var(--primary)" : "color-mix(in oklch, var(--input) 30%, transparent)",
        color: "var(--primary-foreground)",
        boxShadow: "var(--shadow-xs)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        padding: 0,
        transition: "background .1s, border-color .1s",
        ...style,
      }}
    >
      {on && (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
      )}
    </button>
  );
}
