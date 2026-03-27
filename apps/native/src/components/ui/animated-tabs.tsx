"use client";

import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import { createContext, useContext, useId, useState } from "react";
import type React from "react";

interface AnimatedTabsContext {
  activeValue: string;
  setActiveValue: (v: string) => void;
  layoutId: string;
}

const AnimatedTabsContext = createContext<AnimatedTabsContext | null>(null);

interface AnimatedTabsListProps {
  value?: string;
  defaultValue?: string;
  children: React.ReactNode;
  hidden?: boolean;
  className?: string;
}

export function AnimatedTabsList({
  value: controlledValue,
  defaultValue = "",
  children,
  hidden,
  className,
}: AnimatedTabsListProps) {
  const id = useId();
  const [internalValue, setInternalValue] = useState(defaultValue);
  const activeValue = controlledValue ?? internalValue;
  const setActiveValue = controlledValue !== undefined ? () => {} : setInternalValue;

  if (hidden) return null;

  return (
    <AnimatedTabsContext.Provider value={{ activeValue, setActiveValue, layoutId: `tab-highlight-${id}` }}>
      <TabsList className={cn("h-auto p-0.5", className)}>
        {children}
      </TabsList>
    </AnimatedTabsContext.Provider>
  );
}

interface AnimatedTabsTriggerProps {
  value: string;
  children: React.ReactNode;
  className?: string;
}

export function AnimatedTabsTrigger({
  value,
  children,
  className,
}: AnimatedTabsTriggerProps) {
  const ctx = useContext(AnimatedTabsContext);
  const isActive = ctx?.activeValue === value;

  return (
    <TabsTrigger
      value={value}
      onClick={() => ctx?.setActiveValue(value)}
      className={cn(
        "relative px-3 py-1 text-xs data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=inactive]:hover:text-foreground",
        className
      )}
    >
      {isActive && (
        <motion.div
          layoutId={ctx?.layoutId}
          className="absolute inset-0 rounded-sm bg-background shadow-sm"
          transition={{ type: "spring", stiffness: 400, damping: 35 }}
        />
      )}
      <span className="relative z-10">{children}</span>
    </TabsTrigger>
  );
}
