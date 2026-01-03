import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  Eye,
  Palette,
  RefreshCw,
  Settings,
  Shield,
  Sparkles,
  Undo2,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const changeCategories = [
  {
    icon: Download,
    title: "New Apps",
    count: 3,
    color: "emerald",
    items: [
      "Telegram - Secure messaging",
      "WhatsApp - Stay connected",
      "Linear - Project management",
    ],
  },
  {
    icon: Palette,
    title: "Look & Feel",
    count: 2,
    color: "blue",
    items: ["Centered editor layout", "Improved color theme"],
  },
  {
    icon: Wrench,
    title: "Developer Tools",
    count: 4,
    color: "amber",
    items: [
      "Smarter code completion",
      "Multi-cursor editing",
      "Better commenting",
      "Auto-pairing brackets",
    ],
  },
  {
    icon: Shield,
    title: "Maintenance",
    count: 2,
    color: "slate",
    items: ["Config files organized", "Package list cleaned up"],
  },
];

const steps = [
  { id: 1, name: "What's Changing", description: "See the improvements" },
  { id: 2, name: "Benefits", description: "How this helps you" },
  { id: 3, name: "Apply Changes", description: "Choose how to proceed" },
];

export function StepperWizardStyle() {
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedAction, setSelectedAction] = useState<string | null>(null);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-border border-b px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600">
            <span className="font-bold text-lg text-white">N</span>
          </div>
          <div>
            <h2 className="font-semibold">nixmac</h2>
            <p className="text-muted-foreground text-sm">System Manager</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button className="h-8 w-8" size="icon" variant="ghost">
            <Settings className="h-4 w-4" />
          </Button>
          <Button className="h-8 w-8" size="icon" variant="ghost">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Stepper */}
      <div className="border-border border-b bg-muted/30 px-5 py-4">
        <div className="flex items-center justify-center gap-8">
          {steps.map((step, i) => (
            <div className="flex items-center" key={step.id}>
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full font-medium text-sm transition-colors ${
                    currentStep > step.id
                      ? "bg text-white"
                      : currentStep === step.id
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {currentStep > step.id ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    step.id
                  )}
                </div>
                <div className="hidden sm:block">
                  <p
                    className={`font-medium text-sm ${
                      currentStep >= step.id
                        ? "text-foreground"
                        : "text-muted-foreground"
                    }`}
                  >
                    {step.name}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {step.description}
                  </p>
                </div>
              </div>
              {i < steps.length - 1 && (
                <div
                  className={`mx-4 h-0.5 w-12 ${currentStep > step.id ? "bg-emerald-500" : "bg-border"}`}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step Content */}
      <div className="min-h-[320px] p-5">
        {currentStep === 1 && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-semibold text-lg">What's in This Update</h3>
              <Badge variant="secondary">11 improvements</Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {changeCategories.map((cat) => (
                <div
                  className="rounded-lg border border-border bg-muted/30 p-4"
                  key={cat.title}
                >
                  <div className="mb-3 flex items-center gap-3">
                    <div
                      className={`rounded-lg p-2 ${
                        cat.color === "emerald"
                          ? "bg-emerald-500/10 text-emerald-500"
                          : cat.color === "blue"
                            ? "bg-blue-500/10 text-blue-500"
                            : cat.color === "amber"
                              ? "bg-amber-500/10 text-amber-500"
                              : "bg-slate-500/10 text-slate-500"
                      }`}
                    >
                      <cat.icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-medium">{cat.title}</p>
                      <p className="text-muted-foreground text-xs">
                        {cat.count} changes
                      </p>
                    </div>
                  </div>
                  <ul className="space-y-1">
                    {cat.items.map((item, i) => (
                      <li
                        className="flex items-center gap-2 text-muted-foreground text-sm"
                        key={i}
                      >
                        <Check className="h-3 w-3 text-emerald-500" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

        {currentStep === 2 && (
          <div className="flex h-full flex-col items-center justify-center py-8">
            <div className="mb-6 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 p-4">
              <Sparkles className="h-8 w-8 text-white" />
            </div>
            <h3 className="mb-2 font-semibold text-lg">How This Helps You</h3>
            <p className="mb-6 max-w-md text-center text-muted-foreground">
              Here's what you'll notice after this update:
            </p>
            <div className="w-full max-w-lg space-y-3">
              {[
                {
                  emoji: "💬",
                  text: "Message friends on Telegram and WhatsApp right from your Mac",
                },
                {
                  emoji: "📋",
                  text: "Track your projects and tasks with Linear's clean interface",
                },
                {
                  emoji: "👁️",
                  text: "Enjoy a cleaner, more focused code editing experience",
                },
                {
                  emoji: "⚡",
                  text: "Code faster with smarter suggestions and shortcuts",
                },
              ].map((benefit, i) => (
                <div
                  className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3"
                  key={i}
                >
                  <span className="text-lg">{benefit.emoji}</span>
                  <p className="text-sm">{benefit.text}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {currentStep === 3 && (
          <div className="flex h-full flex-col items-center justify-center py-8">
            <h3 className="mb-2 font-semibold text-lg">Ready to Update?</h3>
            <p className="mb-8 text-center text-muted-foreground">
              Pick how you'd like to proceed:
            </p>
            <div className="grid w-full max-w-lg grid-cols-3 gap-4">
              {[
                {
                  id: "preview",
                  name: "Try First",
                  icon: Eye,
                  desc: "Test before committing",
                  color: "emerald",
                },
                {
                  id: "update",
                  name: "Update Now",
                  icon: RefreshCw,
                  desc: "Apply all changes",
                  color: "blue",
                },
                {
                  id: "rollback",
                  name: "Go Back",
                  icon: Undo2,
                  desc: "Undo recent changes",
                  color: "amber",
                },
              ].map((action) => (
                <button
                  className={`flex flex-col items-center rounded-xl border-2 p-6 transition-all ${
                    selectedAction === action.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-muted-foreground/50"
                  }`}
                  key={action.id}
                  onClick={() => setSelectedAction(action.id)}
                  type="button"
                >
                  <div
                    className={`mb-3 rounded-full p-3 ${
                      action.color === "emerald"
                        ? "bg-emerald-500/10 text-emerald-500"
                        : action.color === "blue"
                          ? "bg-blue-500/10 text-blue-500"
                          : "bg-amber-500/10 text-amber-500"
                    }`}
                  >
                    <action.icon className="h-6 w-6" />
                  </div>
                  <p className="font-medium">{action.name}</p>
                  <p className="mt-1 text-muted-foreground text-xs">
                    {action.desc}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer Navigation */}
      <div className="border-border border-t px-5 py-4">
        <div className="flex items-center justify-between">
          <Button
            disabled={currentStep === 1}
            onClick={() => setCurrentStep(Math.max(1, currentStep - 1))}
            variant="outline"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>

          {currentStep < 3 ? (
            <Button onClick={() => setCurrentStep(currentStep + 1)}>
              Continue
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ) : (
            <Button
              className="bg-teal-600 hover:bg-teal-700"
              disabled={!selectedAction}
            >
              <Zap className="mr-2 h-4 w-4" />
              {selectedAction === "preview" && "Try Changes"}
              {selectedAction === "update" && "Update Now"}
              {selectedAction === "rollback" && "Go Back"}
              {!selectedAction && "Choose an Option"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
