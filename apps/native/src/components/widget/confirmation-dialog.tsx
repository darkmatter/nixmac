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
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface ConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  message: string;
  onConfirm: () => void;
  color?: "white" | "teal" | "blue" | "amber";
  children?: ReactNode;
}

export function ConfirmationDialog({
  open,
  onOpenChange,
  message,
  onConfirm,
  color = "teal",
  children,
}: ConfirmationDialogProps) {
  const handleConfirm = () => {
    onConfirm();
    onOpenChange(false);
  };

  const colorClasses = {
    white: {
      border: "border-white-500/30",
      buttonBg: "bg-white-500 hover:bg-white-600",
      buttonBorder: "border-white-500/30",
    },
    teal: {
      border: "border-teal-300/30",
      buttonBg: "bg-teal-300 hover:bg-teal-400",
      buttonBorder: "border-teal-300/30",
    },
    blue: {
      border: "border-teal-300/30",
      buttonBg: "bg-teal-300 hover:bg-teal-400",
      buttonBorder: "border-teal-300/30",
    },
    amber: {
      border: "border-rose-300/30",
      buttonBg: "bg-rose-300 hover:bg-rose-400",
      buttonBorder: "border-rose-300/30",
    },
  };

  const colors = colorClasses[color];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="confirmation-dialog"
        className={cn("max-w-md gap-6 border-2", colors.border)}
      >
        <DialogHeader>
          <DialogTitle className="sr-only">Confirm Action</DialogTitle>
          <DialogDescription className="text-base leading-relaxed">
            {message}
          </DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter className="gap-3">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border/50 hover:border-border"
            data-testid="confirm-dialog-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            className={cn("border-2", colors.buttonBg, colors.buttonBorder)}
            data-testid="confirm-dialog-confirm"
          >
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
