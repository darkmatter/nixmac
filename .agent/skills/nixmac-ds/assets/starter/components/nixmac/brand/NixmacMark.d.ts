import type * as React from "react";

/**
 * The nixmac brand mark — rounded app tile with the robot-face glyph, or the
 * face-only glyph. Recolorable tile/face; the real shipping icon.
 *
 * @startingPoint section="Brand" subtitle="nixmac app mark / logo glyph" viewport="700x220"
 */
export interface NixmacMarkProps extends React.ComponentProps<"svg"> {
  /** Rendered size in px (square). @default 48 */
  size?: number;
  /** "tile" = rounded app icon, "glyph" = transparent face only. @default "tile" */
  variant?: "tile" | "glyph";
  /** Tile fill (tile variant only). @default "#262626" */
  tile?: string;
  /** Face / glyph fill. @default "#DBDBDB" */
  face?: string;
}
export function NixmacMark(props: NixmacMarkProps): React.JSX.Element;
