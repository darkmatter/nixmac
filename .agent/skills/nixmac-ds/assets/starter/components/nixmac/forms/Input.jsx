import React from "react";

/**
 * Single-line text input — 36px tall, 6px radius, transparent fill with a
 * subtle border that brightens to `--ring` on focus. Used for host names,
 * paths, and settings values.
 */
export function Input({ style, disabled = false, ...props }) {
  const [focus, setFocus] = React.useState(false);
  return (
    <input
      disabled={disabled}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={{
        display: "flex",
        height: 36,
        width: "100%",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--input)",
        background: "transparent",
        padding: "4px 12px",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-sm)",
        color: "var(--foreground)",
        boxShadow: "var(--shadow-xs)",
        outline: "none",
        borderColor: focus ? "var(--ring)" : "var(--input)",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "text",
        boxSizing: "border-box",
        transition: "border-color .15s",
        ...style,
      }}
      {...props}
    />
  );
}
