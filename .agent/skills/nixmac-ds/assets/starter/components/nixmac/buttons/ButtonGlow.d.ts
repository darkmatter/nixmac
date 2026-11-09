import type * as React from "react";

/**
 * The teal animated glow pill (nixmac's "Build & Test" action). A dark capsule
 * ringed by a rotating teal conic-gradient border. Desaturates to grey when
 * inactive.
 */
export interface ButtonGlowProps extends React.ComponentProps<"button"> {
  /** Whether the glow is live (teal, spinning) vs idle (grey). @default true */
  active?: boolean;
  /** Custom label; defaults to a spinner/wrench + "Build & Test". */
  children?: React.ReactNode;
}

export function ButtonGlow(props: ButtonGlowProps): React.JSX.Element;
