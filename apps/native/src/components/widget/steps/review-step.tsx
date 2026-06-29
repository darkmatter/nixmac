"use client";

import { DriftReview } from "@/components/widget/drift/drift-review";
import { ExternalBuildDetected } from "@/components/widget/notifications/external-build-detected";

/**
 * Unified "Review" step for both AI evolution (`evolve`) and manual drift
 * (`manualEvolve`). Both render the shared {@link DriftReview} surface. There's
 * no prompt input here: an AI session refines via DriftReview's "Refine with AI"
 * action (which returns to the Describe step and its prompt), and manual drift
 * refines by adopting the changes into a session — keeping this screen compact
 * and single-purpose instead of pushing a prompt box below a tall change list.
 */
export function ReviewStep() {
  return (
    <>
      <ExternalBuildDetected />
      <DriftReview />
    </>
  );
}
