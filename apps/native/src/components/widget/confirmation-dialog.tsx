"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface ConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  message: string;
  onConfirm: () => void;
  onDontAskAgain?: () => void;
  color?: "white" | "teal" | "blue" | "amber";
  showDontAskAgain?: boolean;
}

export function ConfirmationDialog({
  open,
  onOpenChange,
  message,
  onConfirm,
  onDontAskAgain,
  color = "teal",
  showDontAskAgain = false,
}: ConfirmationDialogProps) {
  const [dontAskAgain, setDontAskAgain] = useState(false);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setDontAskAgain(false);
    }
    onOpenChange(nextOpen);
  };

  const handleConfirm = () => {
    if (dontAskAgain && onDontAskAgain) {
      onDontAskAgain();
    }
    onConfirm();
    handleOpenChange(false);
  };

  const colorClasses = {
    white: {
      border: "border-white-500/30",
      text: "text-white-500",
      buttonBg: "bg-white-500 hover:bg-white-600",
      buttonBorder: "border-white-500/30",
    },
    teal: {
      border: "border-teal-300/30",
      text: "text-teal-300",
      buttonBg: "bg-teal-300 hover:bg-teal-400",
      buttonBorder: "border-teal-300/30",
    },
    blue: {
      border: "border-teal-300/30",
      text: "text-teal-300",
      buttonBg: "bg-teal-300 hover:bg-teal-400",
      buttonBorder: "border-teal-300/30",
    },
    amber: {
      border: "border-rose-300/30",
      text: "text-rose-300",
      buttonBg: "bg-rose-300 hover:bg-rose-400",
      buttonBorder: "border-rose-300/30",
    },
  };

  const colors = colorClasses[color];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={cn("max-w-md gap-6 border-2", colors.border)}>
        <DialogHeader>
          <DialogTitle className="sr-only">Confirm Action</DialogTitle>
          <DialogDescription className="text-base leading-relaxed">
            {message}
          </DialogDescription>
        </DialogHeader>
        {showDontAskAgain && (
          <div className="flex items-center gap-2">
            <Checkbox
              id="dont-ask-again"
              checked={dontAskAgain}
              onCheckedChange={(checked) => setDontAskAgain(checked === true)}
            />
            <label
              htmlFor="dont-ask-again"
              className="cursor-pointer text-muted-foreground text-sm"
            >
              Don't ask again
            </label>
          </div>
        )}
        <DialogFooter className="gap-3">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="border-border/50 hover:border-border"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            className={cn("border-2", colors.buttonBg, colors.buttonBorder)}
          >
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
