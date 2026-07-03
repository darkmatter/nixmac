import { OnboardingStepper } from "@/components/widget/onboarding/stepper";
import type { StepId } from "@/components/widget/onboarding/lib/onboarding";

interface OnboardingSidebarProps {
  activeStep: StepId;
  furthestStep: StepId;
  progress: number;
  onStepSelect: (stepId: StepId) => void;
}

export function OnboardingSidebar({
  activeStep,
  furthestStep,
  progress,
  onStepSelect,
}: OnboardingSidebarProps) {
  return (
    <aside className="md:sticky md:top-0 md:self-start md:border-border md:border-r md:pr-6">
      <div className="mb-4 md:hidden">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
      <div className="hidden md:block">
        <OnboardingStepper
          activeStep={activeStep}
          furthestStep={furthestStep}
          onStepSelect={onStepSelect}
        />
      </div>
    </aside>
  );
}
