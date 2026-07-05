"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ReactNode } from "react";

interface ConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Short bolded question, e.g. "Restart setup from the beginning?". */
  title?: string;
  /** Normal-weight explanation of what confirming will do. */
  message: string;
  onConfirm: () => void;
  color?: "white" | "teal" | "blue" | "amber";
  children?: ReactNode;
}

export function ConfirmationDialog({
  open,
  onOpenChange,
  title,
  message,
  onConfirm,
  color = "teal",
  children,
}: ConfirmationDialogProps) {
  const handleConfirm = () => {
    onConfirm();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-color={color} className="max-w-md gap-6">
        <DialogHeader>
          <DialogTitle className={title ? undefined : "sr-only"}>
            {title ?? "Confirm Action"}
          </DialogTitle>
          <DialogDescription className="text-base leading-relaxed">{message}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter className="gap-3">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            data-testid="confirm-dialog-cancel"
          >
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={handleConfirm}
            data-testid="confirm-dialog-confirm"
          >
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
