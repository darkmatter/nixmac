export const ESCAPE_OWNER_PRIORITY = {
  celebration: 300,
  widgetOverlay: 200,
  popover: 100,
} as const;

type EscapeOwner = {
  name: string;
  priority: number;
  handle: () => boolean;
};

const escapeOwners = new Map<symbol, EscapeOwner>();

/**
 * Register an Escape owner with an explicit visual-stack priority.
 *
 * Radix layers are intentionally not registered here: their document-level
 * handlers run before the app's window-level dispatcher and signal ownership
 * with `defaultPrevented`. The remaining app-owned layers are ordered here so
 * their behavior never depends on React effect registration order.
 */
export function registerEscapeOwner(owner: EscapeOwner): () => void {
  const token = Symbol(owner.name);
  escapeOwners.set(token, owner);

  return () => {
    escapeOwners.delete(token);
  };
}

export function routeEscapeToOwner(event: KeyboardEvent): boolean {
  if (
    event.key !== "Escape" ||
    event.defaultPrevented ||
    event.isComposing ||
    event.keyCode === 229
  ) {
    return false;
  }

  const owners = [...escapeOwners.values()].sort(
    (left, right) => right.priority - left.priority || left.name.localeCompare(right.name),
  );

  for (const owner of owners) {
    if (!owner.handle()) continue;
    event.preventDefault();
    return true;
  }

  return false;
}

/** Dispatch the same bubbling Escape used by native-close and Cmd+W bridges. */
export function dispatchSyntheticDocumentEscape(): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    code: "Escape",
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(event);
  return event;
}
