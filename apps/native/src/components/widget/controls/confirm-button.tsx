"use client";

import { Button } from "@/components/ui/button";
import { CheckConfirmationOff } from "@/components/widget/controls/check-confirmation-off";
import { ConfirmationDialog } from "@/components/widget/controls/confirmation-dialog";
import { useConfirm } from "@/hooks/use-confirm";
import type { ConfirmPrefKey } from "@/types/preferences";
import type { ComponentProps } from "react";

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
  const { open, setOpen, setDisable, request, handleConfirm } = useConfirm({
    confirmPrefKey,
    onConfirm,
  });

  return (
    <>
      <Button {...buttonProps} onClick={request}>
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
