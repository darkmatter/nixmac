import { IconTitleDescriptionCard } from "@/components/icon-title-description-card";
import { IconTitleSub } from "@/components/icon-title-subtitle";
import { Button } from "@/components/ui/button";
import { Info, Shield } from "lucide-react";

export interface BackupNotificationScreenProps {
  onComplete: () => void;
  compact?: boolean;
}

export function BackupNotificationScreen({
  onComplete,
  compact = false,
}: BackupNotificationScreenProps) {
  const headerIcon = <Shield className="size-7 text-primary-foreground" />;
  const infoIcon = <Info className="size-full" />;

  return (
    <div
      className={
        compact
          ? "h-full overflow-auto p-4"
          : "flex min-h-screen items-center justify-center bg-background p-4 md:p-8"
      }
    >
      <div>
        <IconTitleSub
          compact={compact}
          subtitle="Before installing nix-darwin, nixmac will automatically create a backup"
          icon={headerIcon}
          title="Configuration Backup"
        />

          <IconTitleDescriptionCard
            className={compact ? "mb-6 mx-auto max-w-md" : "mb-6 mx-auto max-w-xl"}
            description="nix-darwin modifies system configuration files during installation. A backup ensures you can completely restore your original configuration if you decide to uninstall nixmac."
            icon={infoIcon}
            title="Why is a backup necessary?"
            variant="info"
          />

        <div className="flex items-center justify-center">
          <Button onClick={onComplete} size="lg">
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}
