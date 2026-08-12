import React from "react";

const variants = {
  default: { background: "var(--primary)", color: "var(--primary-foreground)", border: "1px solid transparent" },
  secondary: { background: "var(--secondary)", color: "var(--secondary-foreground)", border: "1px solid transparent" },
  destructive: { background: "var(--destructive)", color: "#fff", border: "1px solid transparent" },
  outline: { background: "transparent", color: "var(--foreground)", border: "1px solid var(--border)" },
  success: { background: "color-mix(in oklch, var(--success) 18%, transparent)", color: "var(--success)", border: "1px solid color-mix(in oklch, var(--success) 30%, transparent)" },
  warning: { background: "color-mix(in oklch, var(--warning) 18%, transparent)", color: "var(--warning)", border: "1px solid color-mix(in oklch, var(--warning) 30%, transparent)" },
  brand: { background: "transparent", color: "var(--brand)", border: "1px solid color-mix(in oklch, var(--brand) 40%, transparent)" },
};

/**
 * Small status/label pill. Solid `default`/`secondary`/`destructive`, quiet
 * `outline`, and semantic `success`/`warning`/`brand` tints. Used for change
 * counts, states ("active", "3 changes"), and file kinds.
 */
export function Badge({ variant = "default", style, children, ...props }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        width: "fit-content",
        borderRadius: "var(--radius-md)",
        padding: "2px 8px",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-xs)",
        fontWeight: 500,
        lineHeight: 1.35,
        whiteSpace: "nowrap",
        ...variants[variant],
        ...style,
      }}
      {...props}
    >
      {children}
    </span>
  );
}
