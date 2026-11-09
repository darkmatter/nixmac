import React from "react";

/** Form field label — 14px medium, muted disabled state. Pair with inputs. */
export function Label({ style, disabled = false, children, ...props }) {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.4rem",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-sm)",
        fontWeight: 500,
        lineHeight: 1,
        color: "var(--foreground)",
        opacity: disabled ? 0.5 : 1,
        userSelect: "none",
        ...style,
      }}
      {...props}
    >
      {children}
    </label>
  );
}
