import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ESCAPE_OWNER_PRIORITY,
  registerEscapeOwner,
  routeEscapeToOwner,
} from "@/lib/escape-owner";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CelebrationOverlay } from "./celebration-overlay";

vi.mock("lottie-react", () => ({
  default: () => null,
}));

function EscapeDispatcher({ onPopover }: { onPopover: () => void }) {
  useEffect(() => {
    const unregisterPopover = registerEscapeOwner({
      name: "test-popover",
      priority: ESCAPE_OWNER_PRIORITY.popover,
      handle: () => {
        onPopover();
        return true;
      },
    });
    const dispatch = (event: KeyboardEvent) => routeEscapeToOwner(event);
    window.addEventListener("keydown", dispatch);

    return () => {
      window.removeEventListener("keydown", dispatch);
      unregisterPopover();
    };
  }, [onPopover]);

  return null;
}

function dispatchEscape(init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
    ...init,
  });
  fireEvent(document, event);
  return event;
}

describe("CelebrationOverlay", () => {
  beforeEach(() => {
    const json = vi.fn<() => Promise<unknown>>().mockResolvedValue({});
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue({ json } as unknown as Response),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("orders Radix, celebration, then popover across consecutive Escapes", async () => {
    const onCelebrationDismiss = vi.fn<() => void>();
    const onPopoverDismiss = vi.fn<() => void>();

    function EscapeStack() {
      const [dialogOpen, setDialogOpen] = useState(true);
      const [celebrating, setCelebrating] = useState(true);

      return (
        <>
          <EscapeDispatcher onPopover={onPopoverDismiss} />
          {celebrating ? (
            <CelebrationOverlay
              host="Test-Mac"
              onDismiss={() => {
                onCelebrationDismiss();
                setCelebrating(false);
              }}
            />
          ) : null}
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogContent>
              <DialogTitle>Blocking confirmation</DialogTitle>
              <DialogDescription>Resolve this before closing the celebration.</DialogDescription>
            </DialogContent>
          </Dialog>
        </>
      );
    }

    render(<EscapeStack />);

    dispatchEscape();
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Blocking confirmation" })).toBeNull(),
    );
    expect(onCelebrationDismiss).not.toHaveBeenCalled();
    expect(onPopoverDismiss).not.toHaveBeenCalled();

    const celebrationEscape = dispatchEscape();
    expect(celebrationEscape.defaultPrevented).toBe(true);
    await waitFor(() => expect(onCelebrationDismiss).toHaveBeenCalledOnce());
    expect(onPopoverDismiss).not.toHaveBeenCalled();

    const popoverEscape = dispatchEscape();
    expect(popoverEscape.defaultPrevented).toBe(true);
    expect(onPopoverDismiss).toHaveBeenCalledOnce();
  });

  it("leaves default-prevented and IME Escape untouched", () => {
    const onDismiss = vi.fn<() => void>();
    const onPopoverDismiss = vi.fn<() => void>();
    render(
      <>
        <EscapeDispatcher onPopover={onPopoverDismiss} />
        <CelebrationOverlay host="Test-Mac" onDismiss={onDismiss} />
      </>,
    );

    const defaultPrevented = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    defaultPrevented.preventDefault();
    fireEvent(document, defaultPrevented);

    dispatchEscape({ isComposing: true });

    expect(onDismiss).not.toHaveBeenCalled();
    expect(onPopoverDismiss).not.toHaveBeenCalled();
  });
});
