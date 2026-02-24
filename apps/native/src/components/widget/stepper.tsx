"use client";

import { cn } from "@/lib/utils";
import { useCurrentStep, useWidgetStore } from "@/stores/widget-store";
import { Check } from "lucide-react";

const STEPS = [
	{ name: "Begin", description: "Make a change" },
	{ name: "Evolve", description: "Review & edit" },
	{ name: "Commit", description: "Save to git" },
] as const;

export function Stepper() {
	const step = useCurrentStep();
	const gitStatus = useWidgetStore((s) => s.gitStatus);
	const isGenerating = useWidgetStore((s) => s.isGenerating);
	const isRebuilding = useWidgetStore((s) => s.rebuild.isRunning);
	const hasChanges = Boolean(gitStatus?.diff);

	if (step === "setup" || step === "permissions" || step === "nix-setup" || isGenerating || isRebuilding) {
		return null;
	}

	// Determine current step index based on widget state
	const currentStepIndex = step === "merge" ? 2 : hasChanges ? 1 : 0;

	return (
		<div className="border-border border-b bg-muted/30 px-5 py-4">
			<div className="flex items-center justify-center gap-6 xs:gap-8 sm:gap-12">
				{STEPS.map((stepInfo, index) => {
					const isCompleted = currentStepIndex > index;
					const isActive = currentStepIndex === index;
					const stepNumber = index + 1;

					return (
						<div className="flex items-center" key={stepInfo.name}>
							<div className="flex items-center gap-3">
								{/* Circle - hidden below xs */}
								<div
									className={cn(
										"hidden xs:flex h-8 min-w-8 items-center justify-center rounded-full font-medium text-sm transition-colors",
										isCompleted
											? "bg-teal-500 text-white"
											: isActive
											? "bg-primary text-primary-foreground"
											: "bg-muted text-muted-foreground",
									)}
								>
									{isCompleted ? (
										<Check className="h-4 w-4" />
									) : (
										stepNumber
									)}
								</div>
								<div>
									<div className="flex items-center justify-center gap-2">
										<p
											className={cn(
												"font-medium text-sm",
												currentStepIndex >= index
													? "text-foreground"
													: "text-muted-foreground",
											)}
										>
											{stepInfo.name}
										</p>
										{/* Small circle - visible only below xs */}
										<div
											className={cn(
												"flex xs:hidden h-[18px] w-[18px] items-center justify-center rounded-full text-xs font-medium transition-colors",
												isCompleted
													? "bg-teal-500 text-white"
													: isActive
													? "bg-primary text-primary-foreground"
													: "bg-muted text-muted-foreground",
											)}
										>
											{isCompleted ? (
												<Check className="h-3 w-3" />
											) : (
												stepNumber
											)}
										</div>
									</div>
									<p className="text-muted-foreground text-xs whitespace-nowrap mt-1 xs:mt-[2px]">
										{stepInfo.description}
									</p>
								</div>
							</div>
							{index < STEPS.length - 1 && (
								<div
									className={cn(
										"relative left-2.5 xs:left-3 sm:left-4 h-0.5 w-10 sm:w-12",
										isCompleted ? "bg-teal-500" : "bg-border",
									)}
								/>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
