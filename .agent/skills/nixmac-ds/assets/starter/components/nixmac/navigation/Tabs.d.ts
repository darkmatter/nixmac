import type * as React from "react";

/**
 * Segmented tabs on a muted pill track. Compose with the sub-parts below.
 */
export interface TabsProps extends React.ComponentProps<"div"> {
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
}
export function Tabs(props: TabsProps): React.JSX.Element;
export function TabsList(props: React.ComponentProps<"div">): React.JSX.Element;
export interface TabsTriggerProps extends React.ComponentProps<"button"> { value: string; }
export function TabsTrigger(props: TabsTriggerProps): React.JSX.Element;
export interface TabsContentProps extends React.ComponentProps<"div"> { value: string; }
export function TabsContent(props: TabsContentProps): React.JSX.Element;
