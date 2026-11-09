import React from "react";

let injected = false;
function useGlowKeyframes() {
  React.useEffect(() => {
    if (injected) return;
    injected = true;
    const el = document.createElement("style");
    el.textContent =
      "@keyframes nixmac-glow-spin{to{transform:rotate(360deg)}}";
    document.head.appendChild(el);
  }, []);
}

/**
 * The signature teal "Build & Test" pill — a dark capsule inside an animated
 * rotating glow border. When `active`, the ring spins teal and the label
 * pulses; when inactive it desaturates to grey. Reuse for any high-signal
 * agent action (e.g. "Scan this Mac") by passing children.
 */
export function ButtonGlow({ active = true, children, style, ...props }) {
  useGlowKeyframes();
  const [hover, setHover] = React.useState(false);
  const ring = active ? "var(--glow-teal)" : "var(--muted-foreground)";
  return (
    <span
      style={{
        position: "relative",
        display: "inline-flex",
        borderRadius: "var(--radius-full)",
        padding: 1.5,
        overflow: "hidden",
        opacity: active ? 1 : 0.7,
        filter: active ? "none" : "saturate(0.5)",
        transition: "opacity .3s",
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          inset: "-150%",
          background: `conic-gradient(from 0deg, transparent 0deg, ${ring} 60deg, transparent 120deg)`,
          animation: `nixmac-glow-spin ${active ? 5 : 8}s linear infinite`,
        }}
      />
      <button
        type="button"
        disabled={!active}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          gap: "0.4rem",
          height: 32,
          padding: "0 14px",
          borderRadius: "var(--radius-full)",
          border: "none",
          background: active
            ? hover
              ? "oklch(0.24 0 0)"
              : "oklch(0.20 0 0)"
            : "oklch(0.24 0 0 / 0.8)",
          color: active ? "oklch(0.82 0 0)" : "var(--muted-foreground)",
          fontFamily: "var(--font-sans)",
          fontSize: "var(--text-sm)",
          fontWeight: 500,
          cursor: active ? "pointer" : "not-allowed",
          whiteSpace: "nowrap",
          transition: "background .1s, transform .1s",
          ...style,
        }}
        {...props}
      >
        {children ?? (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={active ? { animation: "nixmac-glow-spin 1s linear infinite" } : undefined}>
              {active ? <path d="M21 12a9 9 0 1 1-6.219-8.56" /> : <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />}
            </svg>
            Build &amp; Test
          </>
        )}
      </button>
    </span>
  );
}
