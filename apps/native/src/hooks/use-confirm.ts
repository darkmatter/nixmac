import { usePrefs } from "@/hooks/use-prefs";
import type { ConfirmPrefKey } from "@/types/preferences";
import { useViewModel } from "@nixmac/state";
import { useState } from "react";

interface UseConfirmArgs {
  confirmPrefKey: ConfirmPrefKey;
  onConfirm: () => void;
}

/**
 * Confirmation state for a destructive action gated by a `confirm*` preference.
 *
 * Split out from `ConfirmButton` so the trigger and the `ConfirmationDialog`
 * can live in different parts of the tree. That matters inside a
 * `DropdownMenu`: selecting a menu item unmounts the menu content (a portal),
 * which would take a dialog rendered inside it down with it. Owning the state
 * here lets callers render the dialog as a sibling of the menu instead.
 */
export function useConfirm({ confirmPrefKey, onConfirm }: UseConfirmArgs) {
  const confirm = useViewModel((s) => s.preferences?.[confirmPrefKey] ?? true);
  const { setPref } = usePrefs();

  const [open, setOpen] = useState(false);
  const [disable, setDisable] = useState(false);

  // Open the dialog when confirmation is required; otherwise act immediately.
  const request = () => {
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

  return { open, setOpen, setDisable, request, handleConfirm };
}
