import React from "react";

/**
 * Multi-line text field — the prompt composer's core input. Min 60px tall,
 * same border/focus treatment as Input. Set `mono` for config/diff text.
 */
export function Textarea({ style, mono = false, disabled = false, ...props }) {
  const [focus, setFocus] = React.useState(false);
  return (
    <textarea
      disabled={disabled}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={{
        display: "flex",
        minHeight: 60,
        width: "100%",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--input)",
        background: "transparent",
        padding: "8px 12px",
        fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
        fontSize: "var(--text-sm)",
        lineHeight: 1.5,
        color: "var(--foreground)",
        boxShadow: "var(--shadow-xs)",
        outline: "none",
        borderColor: focus ? "var(--ring)" : "var(--input)",
        opacity: disabled ? 0.5 : 1,
        resize: "vertical",
        boxSizing: "border-box",
        transition: "border-color .15s",
        ...style,
      }}
      {...props}
    />
  );
}
