import React from "react";

/** Keyboard-key cap — small muted chip for shortcuts (⌘K, Esc, ↵). */
export function Kbd({ style, children, ...props }) {
  return (
    <kbd
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        height: 20,
        minWidth: 20,
        padding: "0 4px",
        borderRadius: "var(--radius-sm)",
        background: "var(--muted)",
        color: "var(--muted-foreground)",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-xs)",
        fontWeight: 500,
        userSelect: "none",
        ...style,
      }}
      {...props}
    >
      {children}
    </kbd>
  );
}
