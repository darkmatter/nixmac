import React from "react";

/**
 * Contextual message block on a card surface. `default` for neutral notes,
 * `destructive` for errors/warnings. Pass an `icon` node; title + description
 * flow in a two-column grid.
 */
export function Alert({ variant = "default", icon, title, children, style, ...props }) {
  const isDestructive = variant === "destructive";
  const textColor = isDestructive ? "var(--destructive-foreground)" : "var(--card-foreground)";
  const iconColor = isDestructive ? "var(--destructive)" : "var(--card-foreground)";
  return (
    <div
      role="alert"
      style={{
        display: "grid",
        gridTemplateColumns: icon ? "16px 1fr" : "1fr",
        columnGap: 12,
        rowGap: 2,
        width: "100%",
        borderRadius: "var(--radius-lg)",
        border: isDestructive ? "1px solid color-mix(in oklch, var(--destructive) 55%, var(--border))" : "1px solid var(--border)",
        background: isDestructive ? "color-mix(in oklch, var(--destructive) 12%, var(--card))" : "var(--card)",
        padding: "12px 16px",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-sm)",
        color: textColor,
        ...style,
      }}
      {...props}
    >
      {icon ? <span style={{ display: "inline-flex", width: 16, height: 16, transform: "translateY(2px)", color: iconColor }}>{icon}</span> : null}
      {title ? <div style={{ gridColumnStart: icon ? 2 : 1, fontWeight: 500, letterSpacing: "-0.01em", minHeight: 16 }}>{title}</div> : null}
      {children ? (
        <div style={{ gridColumnStart: icon ? 2 : 1, color: isDestructive ? "color-mix(in oklch, var(--destructive-foreground) 82%, transparent)" : "var(--muted-foreground)", lineHeight: 1.5 }}>{children}</div>
      ) : null}
    </div>
  );
}
