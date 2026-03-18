"use client";

import { cn } from "@/lib/utils";
import { useCurrentStep, useWidgetStore } from "@/stores/widget-store";
import { Check } from "lucide-react";

const STEPS = [
	{ name: "Describe", description: "What to change" },
	{ name: "Review", description: "Check & test" },
	{ name: "Save", description: "Keep changes" },
] as const;

export function Stepper() {
	const step = useCurrentStep();
	const gitStatus = useWidgetStore((s) => s.gitStatus);
	const isGenerating = useWidgetStore((s) => s.isGenerating);
	const isRebuilding = useWidgetStore((s) => s.rebuild.isRunning);
	const hasChanges = Boolean(gitStatus?.diff);

	if (step === "setup" || step === "permissions" || step === "nix-setup" || step === "history" || isGenerating || isRebuilding) {
		return null;
	}

	// Determine current step index based on widget state
	const currentStepIndex = step === "merge" ? 2 : hasChanges ? 1 : 0;

	const activeStepName = STEPS[currentStepIndex].name;

	return (
		<div className="border-border border-b bg-muted/30 px-3 py-4">
			{/* 5-column grid: step | line | step | line | step */}
			<div
				role="list"
				aria-label={`Progress: step ${currentStepIndex + 1} of ${STEPS.length}, ${activeStepName}`}
				className="grid grid-cols-[2.5fr_1fr_2.5fr_1fr_2.5fr] items-center max-w-2xl mx-auto xs:-translate-x-3 sm:-translate-x-5"
			>
				{STEPS.map((stepInfo, index) => {
					const isCompleted = currentStepIndex > index;
					const isActive = currentStepIndex === index;
					const stepNumber = index + 1;
					const isFirst = index === 0;
					const isMiddle = index === 1;
					const isLast = index === 2;

					return (
						<>
							{/* Step cell */}
							<div
								role="listitem"
								aria-current={isActive ? "step" : undefined}
								className={cn(
									"flex items-center gap-3 xs:gap-2 sm:gap-3",
									isFirst && "justify-end",
									isMiddle && "justify-center",
									isLast && "justify-start",
								)}
								key={stepInfo.name}
							>
								{/* Circle - hidden below xs */}
								<div
									className={cn(
										"hidden xs:flex h-6 min-w-6 sm:min-w-8 sm:h-8 items-center justify-center rounded-full font-medium text-sm transition-colors",
										isCompleted
											? "bg-teal-500 text-white"
											: isActive
												? "bg-primary text-primary-foreground"
												: "bg-muted text-muted-foreground",
									)}
								>
									{isCompleted ? <Check className="h-4 w-4" /> : stepNumber}
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
											{isCompleted ? <Check className="h-3 w-3" /> : stepNumber}
										</div>
									</div>
									<p className="text-muted-foreground text-xs whitespace-nowrap mt-1 xs:mt-[2px]">
										{stepInfo.description}
									</p>
								</div>
							</div>

							{/* Connector line cell (after steps 1 and 2) */}
							{!isLast && (
								<div
									key={`line-${index}`}
									className={cn(
										"h-0.5 w-[70%] xs:w-[50%]",
										index === 0 && "ml-[30%]",
										index === 1 && "mr-[20%]",
										isCompleted ? "bg-teal-500" : "bg-border",
									)}
								/>
							)}
						</>
					);
				})}
			</div>
		</div>
	);
}