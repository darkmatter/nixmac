import React from "react";

/**
 * A small pill "chip button" — a bordered, rounded-full ghost button used for
 * prompt suggestions, filters, and inline actions in the prompt bar. Optional
 * leading icon; three quiet border treatments.
 */
export function BadgeButton({
  badgeVariant = "default",
  icon,
  children,
  style,
  disabled = false,
  ...props
}) {
  const [hover, setHover] = React.useState(false);
  const treatments = {
    default: { borderColor: "var(--border)", color: "var(--muted-foreground)", hoverBg: "var(--muted)" },
    muted: { borderColor: "color-mix(in oklch, var(--border) 50%, transparent)", color: "var(--muted-foreground)", background: "var(--background)", hoverBg: "color-mix(in oklch, var(--muted) 50%, transparent)" },
    teal: { borderColor: "color-mix(in oklch, var(--glow-teal) 20%, transparent)", color: "var(--muted-foreground)", hoverBg: "color-mix(in oklch, var(--glow-teal) 10%, transparent)" },
  };
  const t = treatments[badgeVariant];
  return (
    <button
      type="button"
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.35rem",
        height: "auto",
        padding: "4px 8px",
        borderRadius: "var(--radius-full)",
        border: `1px solid ${t.borderColor}`,
        background: hover && !disabled ? t.hoverBg : (t.background || "transparent"),
        color: hover && !disabled ? "var(--foreground)" : t.color,
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-xs)",
        fontWeight: 500,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "background .15s, color .15s",
        whiteSpace: "nowrap",
        ...style,
      }}
      {...props}
    >
      {icon ? <span style={{ display: "inline-flex", width: 12, height: 12 }}>{icon}</span> : null}
      {children}
    </button>
  );
}
