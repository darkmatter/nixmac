// Animated nixmac mascot — pure SVG + CSS, no animation runtime.
//
// The rigged SVG is the single source of truth; `?raw` inlines its markup so the
// CSS in nixmac-mascot.css can target the feature ids (#eye-left, #smile, …).
// We inline (rather than <img src=…>) because an <img> renders the SVG in an
// isolated document our stylesheet can't reach.
//
//   <NixmacMascot size={160} />
import type { CSSProperties } from "react";
import rawSvg from "./nixmac-mascot.svg?raw";
import "./nixmac-mascot.css";

interface NixmacMascotProps {
  /** Rendered square size in px. Default 160. */
  size?: number;
  className?: string;
  /** Extra wrapper styles — handy for overriding CSS vars like `--hop-period`. */
  style?: CSSProperties;
}

export function NixmacMascot({ size = 160, className, style }: NixmacMascotProps) {
  return (
    <div
      className={className ? `nixmac-mascot ${className}` : "nixmac-mascot"}
      style={{ width: size, height: size, ...style }}
      role="img"
      aria-label="nixmac mascot"
      // SVG content is a static local asset, not user input — safe to inline.
      dangerouslySetInnerHTML={{ __html: rawSvg }}
    />
  );
}

