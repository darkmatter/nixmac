"use client";

import { Button } from "@/components/ui/button";
import { CheckConfirmationOff } from "@/components/widget/check-confirmation-off";
import { ConfirmationDialog } from "@/components/widget/confirmation-dialog";
import { usePrefs } from "@/hooks/use-prefs";
import { useWidgetStore, type ConfirmPrefKey } from "@/stores/widget-store";
import type { ComponentProps } from "react";
import { useState } from "react";

interface ConfirmButtonProps extends ComponentProps<typeof Button> {
  confirmPrefKey: ConfirmPrefKey;
  onConfirm: () => void;
  message: string;
  color?: "white" | "teal" | "blue" | "amber";
}

export function ConfirmButton({
  confirmPrefKey,
  onConfirm,
  message,
  color,
  children,
  ...buttonProps
}: ConfirmButtonProps) {
  const confirm = useWidgetStore((s) => s[confirmPrefKey]);
  const { setPref } = usePrefs();

  const [open, setOpen] = useState(false);
  const [disable, setDisable] = useState(false);

  const handleClick = () => {
    if (confirm) {
      setDisable(false);
      setOpen(true);
    } else {
      onConfirm();
    }
  };

  const handleConfirm = () => {
    if (disable) setPref(confirmPrefKey, false);
    onConfirm();
  };

  return (
    <>
      <Button {...buttonProps} onClick={handleClick}>
        {children}
      </Button>
      <ConfirmationDialog
        open={open}
        onOpenChange={setOpen}
        message={message}
        onConfirm={handleConfirm}
        color={color}
      >
        <CheckConfirmationOff onCheckedChange={setDisable} />
      </ConfirmationDialog>
    </>
  );
}
