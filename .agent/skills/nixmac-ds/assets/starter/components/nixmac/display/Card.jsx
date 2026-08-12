import React from "react";

/**
 * Surface container — rounded 12px card with border + subtle shadow on
 * `--card`. Compose with CardHeader / CardTitle / CardDescription /
 * CardContent / CardFooter. The app's review panels, settings groups, and
 * proof tiles are all Cards.
 */
export function Card({ style, children, ...props }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 24,
        borderRadius: "var(--radius-xl)",
        border: "1px solid var(--border)",
        background: "var(--card)",
        color: "var(--card-foreground)",
        padding: "24px 0",
        boxShadow: "var(--shadow-sm)",
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ style, children, ...props }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "0 24px", ...style }} {...props}>{children}</div>;
}
export function CardTitle({ style, children, ...props }) {
  return <div style={{ fontWeight: 600, fontSize: "var(--text-base)", lineHeight: 1.1, ...style }} {...props}>{children}</div>;
}
export function CardDescription({ style, children, ...props }) {
  return <div style={{ color: "var(--muted-foreground)", fontSize: "var(--text-sm)", lineHeight: 1.4, ...style }} {...props}>{children}</div>;
}
export function CardContent({ style, children, ...props }) {
  return <div style={{ padding: "0 24px", fontSize: "var(--text-sm)", ...style }} {...props}>{children}</div>;
}
export function CardFooter({ style, children, ...props }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 24px", ...style }} {...props}>{children}</div>;
}
