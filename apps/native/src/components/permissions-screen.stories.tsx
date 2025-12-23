// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)

import { fn } from "@storybook/test";
import type React from "react";
import { useState } from "react";
import preview from "#storybook/preview";
import {
  defaultPermissions,
  type Permission,
  PermissionsScreen,
} from "./permissions-screen";

// =============================================================================
// Meta
// =============================================================================

const meta = preview.meta({
  title: "Onboarding/PermissionsScreen",
  component: PermissionsScreen,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story: React.ComponentType) => (
      // <div className="min-h-screen bg-background">
      <Story />
      // </div>
    ),
  ],
  tags: ["autodocs"],
  argTypes: {
    compact: {
      control: "boolean",
      description:
        "When true, renders a compact version suitable for embedding in a widget",
    },
  },
});

export default meta;

// =============================================================================
// Mock Permission States
// =============================================================================

const allPendingPermissions: Permission[] = defaultPermissions.map((p) => ({
  ...p,
  status: "pending",
}));

const allGrantedPermissions: Permission[] = defaultPermissions.map((p) => ({
  ...p,
  status: "granted",
}));

const requiredGrantedPermissions: Permission[] = defaultPermissions.map(
  (p) => ({
    ...p,
    status: p.required ? "granted" : "pending",
  })
);

const someDeniedPermissions: Permission[] = [
  { ...defaultPermissions[0], status: "granted" },
  { ...defaultPermissions[1], status: "denied" },
  { ...defaultPermissions[2], status: "pending" },
  { ...defaultPermissions[3], status: "pending" },
];

const mixedStatePermissions: Permission[] = [
  { ...defaultPermissions[0], status: "granted" },
  { ...defaultPermissions[1], status: "granted" },
  { ...defaultPermissions[2], status: "denied" },
  { ...defaultPermissions[3], status: "pending" },
];

// =============================================================================
// Interactive Wrapper Component
// =============================================================================

/**
 * Wrapper that tracks onComplete callback and shows completion state
 */
function InteractivePermissionsScreen({
  initialPermissions,
  compact = false,
}: {
  initialPermissions?: Permission[];
  compact?: boolean;
}) {
  const [completed, setCompleted] = useState(false);

  const handleComplete = () => {
    fn()();
    setCompleted(true);
  };

  if (completed) {
    const containerClasses = compact
      ? "flex h-64 items-center justify-center bg-background p-4"
      : "flex min-h-screen items-center justify-center bg-background";

    return (
      <div className={containerClasses}>
        <div className="space-y-4 text-center">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-console-success/10">
            <svg
              className="size-8 text-console-success"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <title>Success checkmark</title>
              <path
                d="M5 13l4 4L19 7"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
              />
            </svg>
          </div>
          <h2
            className={
              compact ? "font-semibold text-lg" : "font-semibold text-2xl"
            }
          >
            Permissions Complete!
          </h2>
          <p
            className={
              compact
                ? "text-muted-foreground text-sm"
                : "text-muted-foreground"
            }
          >
            You would now proceed to the main console.
          </p>
          <button
            className="text-primary text-sm underline"
            onClick={() => setCompleted(false)}
            type="button"
          >
            Reset Story
          </button>
        </div>
      </div>
    );
  }

  return (
    <PermissionsScreen
      compact={compact}
      initialPermissions={initialPermissions}
      onComplete={handleComplete}
    />
  );
}

// =============================================================================
// Compact Decorator for Widget Stories
// =============================================================================

const CompactDecorator = (Story: React.ComponentType) => (
  <div className="bg-background p-8">
    <div className="mx-auto max-w-md rounded-lg border bg-card shadow-sm">
      <Story />
    </div>
  </div>
);

// =============================================================================
// Stories
// =============================================================================

/**
 * Default interactive state - All permissions pending
 *
 * This is the first screen users see during onboarding after selecting
 * their config directory. They must grant all required permissions before
 * proceeding to the main console.
 *
 * Click the "Request" buttons to simulate granting permissions.
 */
export const Default = meta.story({
  render: () => <InteractivePermissionsScreen />,
});

/**
 * All permissions pending - initial state when user first sees the screen
 */
export const AllPending = meta.story({
  args: {
    onComplete: fn(),
    initialPermissions: allPendingPermissions,
  },
});

/**
 * All permissions granted - ready to continue
 */
export const AllGranted = meta.story({
  args: {
    onComplete: fn(),
    initialPermissions: allGrantedPermissions,
  },
});

/**
 * Required permissions granted - optional Full Disk Access still pending
 *
 * The "Continue to Console" button is enabled because all required
 * permissions have been granted.
 */
export const RequiredGranted = meta.story({
  args: {
    onComplete: fn(),
    initialPermissions: requiredGrantedPermissions,
  },
});

/**
 * Some permissions denied - shows retry state
 *
 * When a permission is denied, the button changes to "Retry" to allow
 * the user to request it again.
 */
export const SomeDenied = meta.story({
  args: {
    onComplete: fn(),
    initialPermissions: someDeniedPermissions,
  },
});

/**
 * Mixed permission states - realistic mid-flow scenario
 *
 * Shows a mix of granted, denied, and pending permissions as a user
 * might see while working through the onboarding process.
 */
export const MixedStates = meta.story({
  args: {
    onComplete: fn(),
    initialPermissions: mixedStatePermissions,
  },
});

/**
 * Interactive with pre-granted required permissions
 *
 * User only needs to optionally grant Full Disk Access before continuing.
 */
export const InteractiveReadyToContinue = meta.story({
  render: () => (
    <InteractivePermissionsScreen
      initialPermissions={requiredGrantedPermissions}
    />
  ),
});

// =============================================================================
// Compact Widget Stories
// =============================================================================

/**
 * Compact version suitable for embedding in widgets
 *
 * Shows how the permissions screen renders when embedded in a smaller
 * container like a sidebar widget or modal dialog.
 */
export const Compact = meta.story({
  args: {
    compact: true,
    onComplete: fn(),
    initialPermissions: allPendingPermissions,
  },
  decorators: [CompactDecorator],
});

/**
 * Compact version with required permissions granted
 *
 * User can proceed to the next step even in compact mode.
 */
export const CompactReadyToContinue = meta.story({
  args: {
    compact: true,
    onComplete: fn(),
    initialPermissions: requiredGrantedPermissions,
  },
  decorators: [CompactDecorator],
});

/**
 * Interactive compact version
 *
 * Shows the compact permissions screen with full interactivity.
 * Notice how the success state also adapts to the compact layout.
 */
export const CompactInteractive = meta.story({
  render: () => (
    <InteractivePermissionsScreen
      compact={true}
      initialPermissions={mixedStatePermissions}
    />
  ),
  decorators: [CompactDecorator],
});

/**
 * Compact with mixed states
 *
 * Demonstrates how different permission states look in the compact layout.
 */
export const CompactMixedStates = meta.story({
  args: {
    compact: true,
    onComplete: fn(),
    initialPermissions: mixedStatePermissions,
  },
  decorators: [CompactDecorator],
});
