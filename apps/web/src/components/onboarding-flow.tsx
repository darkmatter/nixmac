import { Check, ChevronLeft, ChevronRight, FolderOpen } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConfigurationStep } from "./onboarding/configuration-step";
import { SetupWizardStep } from "./onboarding/setup-wizard-step";
import { WelcomeStep } from "./onboarding/welcome-step";

const STEPS = [
  { id: "welcome", title: "Welcome", component: WelcomeStep },
  { id: "configuration", title: "Configuration", component: ConfigurationStep },
  { id: "setup", title: "Setup Wizard", component: SetupWizardStep },
] as const;

export function OnboardingFlow() {
  const [currentStep, setCurrentStep] = useState(0);
  const [config, setConfig] = useState({
    repoDirectory: "~/.config/nixmac",
    selectedHost: "",
    hosts: [] as string[],
    backgrounds: [] as string[],
    shortcuts: [] as string[],
    apps: [] as string[],
  });

  const CurrentStepComponent = STEPS[currentStep].component;

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      // Complete onboarding
      console.log("Onboarding complete", config);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const isLastStep = currentStep === STEPS.length - 1;

  return (
    <div className="w-full max-w-4xl p-6">
      {/* Progress indicator */}
      <div className="mb-8 flex items-center justify-center gap-2">
        {STEPS.map((step, index) => (
          <div className="flex items-center gap-2" key={step.id}>
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full border-2 font-medium text-sm ${
                index < currentStep
                  ? "border-primary bg-primary text-primary-foreground"
                  : index === currentStep
                    ? "border-primary text-primary"
                    : "border-muted text-muted-foreground"
              }`}
            >
              {index < currentStep ? <Check className="h-4 w-4" /> : index + 1}
            </div>
            {index < STEPS.length - 1 && (
              <div
                className={`h-0.5 w-12 ${index < currentStep ? "bg-primary" : "bg-muted"}`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <Card className="border-2">
        <CardHeader>
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
              <FolderOpen className="h-6 w-6 text-primary" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-2xl">
                {STEPS[currentStep].title}
              </CardTitle>
              <CardDescription className="text-base">
                {currentStep === 0 && "Get started with nixmac"}
                {currentStep === 1 && "Configure your nixmac installation"}
                {currentStep === 2 && "Customize your Mac experience"}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <CurrentStepComponent config={config} setConfig={setConfig} />

          {/* Navigation buttons */}
          <div className="flex items-center justify-between border-t pt-4">
            <Button
              disabled={currentStep === 0}
              onClick={handleBack}
              variant="outline"
            >
              <ChevronLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <div className="text-muted-foreground text-sm">
              Step {currentStep + 1} of {STEPS.length}
            </div>
            <Button onClick={handleNext}>
              {isLastStep ? "Complete Setup" : "Next"}
              {!isLastStep && <ChevronRight className="ml-2 h-4 w-4" />}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
