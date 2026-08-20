import React from "react";

const TabsCtx = React.createContext(null);

/**
 * Segmented tabs — a muted pill track holding triggers; the active trigger
 * lifts onto `--background` with a soft shadow. Compose Tabs > TabsList >
 * TabsTrigger and TabsContent. Used for the review vs. diff and settings
 * section switches.
 */
export function Tabs({ defaultValue, value, onValueChange, style, children, ...props }) {
  const isControlled = value !== undefined;
  const [internal, setInternal] = React.useState(defaultValue);
  const active = isControlled ? value : internal;
  const set = (v) => { if (!isControlled) setInternal(v); onValueChange && onValueChange(v); };
  return (
    <TabsCtx.Provider value={{ active, set }}>
      <div style={{ ...style }} {...props}>{children}</div>
    </TabsCtx.Provider>
  );
}

export function TabsList({ style, children, ...props }) {
  return (
    <div
      role="tablist"
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 36,
        padding: 4,
        gap: 2,
        borderRadius: "var(--radius-lg)",
        background: "var(--muted)",
        color: "var(--muted-foreground)",
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({ value, style, children, ...props }) {
  const ctx = React.useContext(TabsCtx);
  const on = ctx.active === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      onClick={() => ctx.set(value)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        whiteSpace: "nowrap",
        height: 28,
        padding: "0 12px",
        border: "none",
        borderRadius: "var(--radius-md)",
        background: on ? "var(--background)" : "transparent",
        color: on ? "var(--foreground)" : "var(--muted-foreground)",
        boxShadow: on ? "var(--shadow-sm)" : "none",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-sm)",
        fontWeight: 500,
        cursor: "pointer",
        transition: "background .15s, color .15s",
        ...style,
      }}
      {...props}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, style, children, ...props }) {
  const ctx = React.useContext(TabsCtx);
  if (ctx.active !== value) return null;
  return <div role="tabpanel" style={{ marginTop: 8, ...style }} {...props}>{children}</div>;
}
