"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useWidgetStore } from "@/stores/widget-store";

interface KeepBranchCheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export function KeepBranchCheckbox({ checked, onCheckedChange }: KeepBranchCheckboxProps) {
  const evolveState = useWidgetStore((s) => s.evolveState);

  if (!evolveState || evolveState.step === "begin") return null;

  return (
    <div className="flex items-center gap-2">
      <Checkbox id="keep-branch" checked={checked} onCheckedChange={onCheckedChange} />
      <Label htmlFor="keep-branch" className="text-sm text-muted-foreground cursor-pointer">
        Keep branch in git
      </Label>
    </div>
  );
}
