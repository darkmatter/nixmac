import React from "react";

/**
 * Mono file/path chip — a monospace `<code>` pill for file paths, store paths,
 * commands, and hashes. Optional leading icon.
 */
export function FileBadge({ icon, style, children, ...props }) {
  return (
    <code
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        borderRadius: "var(--radius-sm)",
        background: "var(--muted)",
        color: "var(--foreground)",
        padding: "2px 6px",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--text-xs)",
        ...style,
      }}
      {...props}
    >
      {icon ? <span style={{ display: "inline-flex", width: 12, height: 12 }}>{icon}</span> : null}
      {children}
    </code>
  );
}
