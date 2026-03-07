"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useState } from "react";

interface CheckConfirmationOffProps {
  onCheckedChange: (checked: boolean) => void;
}

export function CheckConfirmationOff({ onCheckedChange }: CheckConfirmationOffProps) {
  const [checked, setChecked] = useState(false);

  const handleChange = (value: boolean) => {
    setChecked(value);
    onCheckedChange(value);
  };

  return (
    <div className="flex items-center gap-2">
      <Checkbox id="skip-confirmation" checked={checked} onCheckedChange={handleChange} />
      <Label htmlFor="skip-confirmation" className="cursor-pointer text-muted-foreground text-sm">
        Switch this confirmation off in settings.
      </Label>
    </div>
  );
}
