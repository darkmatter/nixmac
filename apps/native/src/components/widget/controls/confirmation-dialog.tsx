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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-color={color} className={cn("max-w-md gap-6 shadow-[0_0_0_3px_#000000_inset] bg-transparent border border-black dark:border-white/20 dark:text-white text-black rounded-lg font-bold transform hover:-translate-y-1 transition duration-400")}>
        <DialogHeader>
          <DialogTitle className="sr-only">Confirm Action</DialogTitle>
          <DialogDescription className="text-base leading-relaxed">{message}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter className="gap-3">
          <Button
            variant="link"
            onClick={() => onOpenChange(false)}
            className="bg-transparent border-none px-6 py-2  text-white rounded-lg font-bold transform hover:-translate-y-1 transition duration-400"
            data-testid="confirm-dialog-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            className="shadow-[0_0_0_3px_#000000_inset] px-6 py-2 bg-transparent border border-black dark:border-white dark:text-white text-black rounded-lg font-bold transform hover:-translate-y-1 transition duration-400"
            data-testid="confirm-dialog-confirm"
          >
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
