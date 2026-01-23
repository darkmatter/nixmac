"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useRef, useState } from "react";

interface HoverAccordionProps {
  items: readonly { value: string; trigger: string; content: string }[];
  hoverDelay?: number;
  className?: string;
  itemClassName?: string;
  triggerClassName?: string;
  contentClassName?: string;
}

export function HoverAccordion({
  items,
  hoverDelay = 100,
  className,
  itemClassName,
  triggerClassName,
  contentClassName,
}: HoverAccordionProps) {
  const [openValue, setOpenValue] = useState<string>("");
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = (value: string) => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }

    hoverTimeoutRef.current = setTimeout(() => {
      setOpenValue(value);
    }, hoverDelay);
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }

    hoverTimeoutRef.current = setTimeout(() => {
      setOpenValue("");
    }, hoverDelay);
  };

  return (
    <Accordion
      className={className}
      type="single"
      value={openValue}
      onValueChange={setOpenValue}
    >
      {items.map((item) => (
        <AccordionItem
          className={itemClassName}
          key={item.value}
          value={item.value}
          onMouseEnter={() => handleMouseEnter(item.value)}
          onMouseLeave={handleMouseLeave}
        >
          <AccordionTrigger className={triggerClassName}>
            {item.trigger}
          </AccordionTrigger>
          <AccordionContent className={contentClassName}>
            {item.content}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}