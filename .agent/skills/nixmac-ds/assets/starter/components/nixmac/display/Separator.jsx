import React from "react";

/** Hairline divider. Horizontal by default; set `orientation="vertical"`. */
export function Separator({ orientation = "horizontal", style, ...props }) {
  const isV = orientation === "vertical";
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      style={{
        flexShrink: 0,
        background: "var(--border)",
        width: isV ? 1 : "100%",
        height: isV ? "100%" : 1,
        ...style,
      }}
      {...props}
    />
  );
}
