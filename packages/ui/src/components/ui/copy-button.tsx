"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { CheckIcon, CopyIcon } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

const copyButtonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium text-sm outline-none transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "outline",
      size: "icon",
    },
  },
);

export interface CopyButtonProps
  extends Omit<React.ComponentProps<"button">, "onClick" | "onCopy">,
    VariantProps<typeof copyButtonVariants> {
  /** The text to copy to the clipboard when the button is pressed. */
  value: string;
  /**
   * Called with the copied value after a successful copy.
   * Use this for telemetry or side effects — not for navigation.
   */
  onCopy?: (value: string) => void;
  /** Override the default 2 s "copied" feedback duration (ms). */
  copiedDuration?: number;
  /** Render as a child element instead of a <button> (Radix Slot). */
  asChild?: boolean;
}

function CopyButton({
  className,
  variant,
  size,
  value,
  onCopy,
  copiedDuration = 2000,
  asChild = false,
  disabled,
  children,
  ...props
}: CopyButtonProps) {
  const [copied, setCopied] = React.useReducer((_: boolean, next: boolean) => next, false);
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      onCopy?.(value);
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => setCopied(false), copiedDuration);
    } catch {
      // The clipboard API can be unavailable (insecure context) or rejected
      // by the user. We fail silently — the button stays in its idle state.
    }
  }, [value, onCopy, copiedDuration]);

  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      className={cn(copyButtonVariants({ variant, size, className }))}
      data-slot="copy-button"
      data-copied={copied}
      disabled={disabled}
      onClick={handleCopy}
      {...props}
    >
      {children ?? (copied ? <CheckIcon /> : <CopyIcon />)}
    </Comp>
  );
}

export { CopyButton, copyButtonVariants };
