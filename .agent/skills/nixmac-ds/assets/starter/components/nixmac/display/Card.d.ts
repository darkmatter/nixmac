import type * as React from "react";

/**
 * Surface container. Rounded 12px, bordered, subtle shadow on `--card`.
 * Compose with the sub-parts below.
 *
 * @startingPoint section="Layout" subtitle="Card surface with header/content/footer" viewport="700x260"
 */
export interface CardProps extends React.ComponentProps<"div"> {}
export function Card(props: CardProps): React.JSX.Element;
export function CardHeader(props: React.ComponentProps<"div">): React.JSX.Element;
export function CardTitle(props: React.ComponentProps<"div">): React.JSX.Element;
export function CardDescription(props: React.ComponentProps<"div">): React.JSX.Element;
export function CardContent(props: React.ComponentProps<"div">): React.JSX.Element;
export function CardFooter(props: React.ComponentProps<"div">): React.JSX.Element;
