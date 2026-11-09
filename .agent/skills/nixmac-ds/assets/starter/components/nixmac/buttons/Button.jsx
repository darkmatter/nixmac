import React from "react";

const base = {
  display: "inline-flex",
  flexShrink: 0,
  alignItems: "center",
  justifyContent: "center",
  gap: "0.5rem",
  whiteSpace: "nowrap",
  borderRadius: "var(--radius-md)",
  fontFamily: "var(--font-sans)",
  fontWeight: 500,
  fontSize: "var(--text-sm)",
  lineHeight: 1,
  border: "1px solid transparent",
  outline: "none",
  cursor: "pointer",
  transition: "background-color .15s, color .15s, box-shadow .15s, border-color .15s, transform .05s",
  userSelect: "none",
};

const sizes = {
  sm: { height: 32, padding: "0 12px", gap: "0.375rem", fontSize: "var(--text-sm)" },
  default: { height: 36, padding: "0 16px" },
  lg: { height: 40, padding: "0 24px" },
  icon: { height: 36, width: 36, padding: 0 },
  "icon-sm": { height: 32, width: 32, padding: 0 },
  "icon-lg": { height: 40, width: 40, padding: 0 },
};

const variants = {
  default: { background: "var(--primary)", color: "var(--primary-foreground)" },
  destructive: { background: "var(--destructive)", color: "#fff" },
  outline: {
    background: "color-mix(in oklch, var(--input) 30%, transparent)",
    color: "var(--foreground)",
    borderColor: "var(--input)",
    boxShadow: "var(--shadow-xs)",
  },
  secondary: { background: "var(--secondary)", color: "var(--secondary-foreground)" },
  ghost: { background: "transparent", color: "var(--foreground)" },
  link: { background: "transparent", color: "var(--primary)", textDecoration: "underline", textUnderlineOffset: 4 },
};

const hoverBg = {
  default: "color-mix(in oklch, var(--primary) 90%, transparent)",
  destructive: "color-mix(in oklch, var(--destructive) 90%, transparent)",
  outline: "color-mix(in oklch, var(--input) 50%, transparent)",
  secondary: "color-mix(in oklch, var(--secondary) 80%, transparent)",
  ghost: "color-mix(in oklch, var(--accent) 50%, transparent)",
  link: "transparent",
};

/**
 * The primary action button. Solid `default`, quiet `ghost`/`outline`,
 * `secondary`, `destructive`, and inline `link`. Sizes sm / default / lg
 * plus square `icon`* variants. macOS-native feel: 36px default height,
 * 6px radius, subtle hover tint.
 */
export function Button({
  variant = "default",
  size = "default",
  disabled = false,
  style,
  children,
  ...props
}) {
  const [hover, setHover] = React.useState(false);
  const [active, setActive] = React.useState(false);
  const s = {
    ...base,
    ...sizes[size],
    ...variants[variant],
    ...(hover && !disabled ? { background: hoverBg[variant], ...(variant === "link" ? { textDecoration: "underline" } : {}) } : {}),
    ...(active && !disabled ? { transform: "scale(0.98)" } : {}),
    ...(disabled ? { opacity: 0.5, pointerEvents: "none" } : {}),
    ...style,
  };
  return (
    <button
      type="button"
      style={s}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setActive(false); }}
      onMouseDown={() => setActive(true)}
      onMouseUp={() => setActive(false)}
      {...props}
    >
      {children}
    </button>
  );
}
