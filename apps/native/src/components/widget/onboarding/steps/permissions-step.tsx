"use client";

import { stepEyebrow } from "@/components/widget/onboarding/lib/onboarding";
import { StepShell } from "@/components/widget/onboarding/step-shell";
import { PermissionsPanel } from "@/components/widget/permissions/permissions-panel";

/**
 * Permissions step: the shared permission panel inside the onboarding shell.
 * When every required permission is granted the onboarding machine advances
 * on its own.
 */
export function PermissionsStep() {
  return (
    <StepShell
      eyebrow={stepEyebrow("permissions")}
      title="System Permissions"
      description="nixmac needs a few macOS permissions before it can read your configuration and apply changes. Grant the required ones to continue — we’ll move on automatically."
    >
      <PermissionsPanel />
    </StepShell>
  );
}
