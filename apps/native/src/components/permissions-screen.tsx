import { useState } from "react";
import { IconTitleDescriptionCard } from "@/components/icon-title-description-card";
import { IconTitleSub as IconTitleSubtitle } from "@/components/icon-title-subtitle";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export interface Permission {
  id: string;
  name: string;
  description: string;
  required: boolean;
  canRequestProgrammatically: boolean;
  status: "granted" | "denied" | "pending";
  instructions?: string;
}

export const defaultPermissions: Permission[] = [
  {
    id: "desktop",
    name: "Desktop Folder Access",
    description: "Required to manage and sync desktop files and configurations",
    required: true,
    canRequestProgrammatically: true,
    status: "pending",
  },
  {
    id: "documents",
    name: "Documents Folder Access",
    description: "Required to access and manage configuration files stored in Documents",
    required: true,
    canRequestProgrammatically: true,
    status: "pending",
  },
  {
    id: "admin",
    name: "Administrator Privileges",
    description: "Required to install system packages and modify system configurations",
    required: true,
    canRequestProgrammatically: false,
    status: "pending",
    instructions: "You will be prompted for your password when needed",
  },
  {
    id: "full-disk",
    name: "Full Disk Access",
    description: "Recommended for complete system management capabilities",
    required: false,
    canRequestProgrammatically: false,
    status: "pending",
    instructions:
      "Go to System Settings → Privacy & Security → Full Disk Access, then add nixmac to the list",
  },
];

export interface PermissionsScreenProps {
  onComplete: () => void;
  initialPermissions?: Permission[];
  /** When true, renders a compact version suitable for embedding in a widget */
  compact?: boolean;
}

function PermissionCard({
  compact,
  permission,
  onRequestPermission,
}: {
  compact: boolean;
  permission: Permission;
  onRequestPermission: (permissionId: string) => void;
}) {
  const permissionActionLabel = (status: Permission["status"]) => {
    switch (status) {
      case "granted":
        return "Granted";
      case "denied":
        return "Retry";
      case "pending":
        return "Request";
      default:
        return "Request";
    }
  };

  return (
    <div
      className={
        compact
          ? "flex flex-col gap-2 border-b pb-4 last:border-b-0 last:pb-0"
          : "flex flex-col gap-3 border-b pb-6 last:border-b-0 last:pb-0"
      }
      key={permission.id}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h3
              className={
                compact ? "font-medium text-foreground text-sm" : "font-medium text-foreground"
              }
            >
              {permission.name}
            </h3>
            {permission.required ? (
              <span className="rounded-md bg-primary/10 px-2 py-0.5 font-medium text-primary text-xs">
                Required
              </span>
            ) : null}
            <PermissionStatusBadge status={permission.status} />
          </div>
          <p className="text-muted-foreground text-sm">{permission.description}</p>
          {permission.instructions ? (
            <div className="mt-2 rounded-md border border-border bg-secondary/50 p-3">
              <p className="font-mono text-muted-foreground text-xs">{permission.instructions}</p>
            </div>
          ) : null}
        </div>
        <div className="flex-shrink-0">
          {permission.canRequestProgrammatically ? (
            <Button
              disabled={permission.status === "granted"}
              onClick={() => onRequestPermission(permission.id)}
              size="sm"
              variant={permission.status === "granted" ? "secondary" : "default"}
            >
              {permissionActionLabel(permission.status)}
            </Button>
          ) : (
            <Button
              disabled={permission.status === "granted"}
              onClick={() => onRequestPermission(permission.id)}
              size="sm"
              variant="outline"
            >
              {permission.status === "granted" ? "Granted" : "Mark as Done"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function PermissionsScreen({
  onComplete,
  initialPermissions = defaultPermissions,
  compact = false,
}: PermissionsScreenProps) {
  const [permissions, setPermissions] = useState<Permission[]>(initialPermissions);

  const handleRequestPermission = (permissionId: string) => {
    setPermissions((prev) =>
      prev.map((p) =>
        p.id === permissionId ? { ...p, status: Math.random() > 0.3 ? "granted" : "denied" } : p,
      ),
    );
  };

  const allRequiredGranted = permissions
    .filter((p) => p.required)
    .every((p) => p.status === "granted");

  const headerIcon = (
    <svg
      aria-label="Console icon"
      className="size-7 text-primary-foreground"
      fill="none"
      role="img"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <title>Console icon</title>
      <path
        d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
      />
    </svg>
  );

  const infoIcon = (
    <svg
      aria-label="Information"
      className="size-full"
      fill="none"
      role="img"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <title>Information</title>
      <path
        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
      />
    </svg>
  );

  return (
    <div
      className={
        compact
          ? "h-full overflow-auto p-4"
          : "flex min-h-screen items-center justify-center bg-background p-4 md:p-8"
      }
    >
      <div className={compact ? "w-full" : "w-full max-w-3xl"}>
        <IconTitleSubtitle
          compact={compact}
          icon={headerIcon}
          subtitle={
            compact
              ? "Grant the following permissions to continue"
              : "To manage your macOS system declaratively, nixmac needs the following permissions"
          }
          title="System Permissions"
        />

        <Card className={compact ? "mb-4 p-4" : "mb-6 p-6"}>
          <div className={compact ? "space-y-4" : "space-y-6"}>
            {permissions.map((permission) => (
              <PermissionCard
                compact={compact}
                key={permission.id}
                onRequestPermission={handleRequestPermission}
                permission={permission}
              />
            ))}
          </div>
        </Card>

        <div className="flex items-center justify-between">
          <p className="text-muted-foreground text-sm">
            {allRequiredGranted
              ? "All required permissions granted!"
              : "Grant all required permissions to continue"}
          </p>
          <Button disabled={!allRequiredGranted} onClick={onComplete} size="lg">
            Continue to Console
          </Button>
        </div>

        {!compact && (
          <IconTitleDescriptionCard
            className="mt-6"
            description="nixmac manages your macOS system declaratively, similar to NixOS. It needs access to configuration files, the ability to install packages, and permission to modify system settings to provide a complete system management experience."
            icon={infoIcon}
            title="Why does nixmac need these permissions?"
            variant="default"
          />
        )}
      </div>
    </div>
  );
}

function PermissionStatusBadge({ status }: { status: "granted" | "denied" | "pending" }) {
  const styles = {
    granted: "bg-console-success/10 text-console-success border-console-success/20",
    denied: "bg-console-error/10 text-console-error border-console-error/20",
    pending: "bg-secondary text-muted-foreground border-border",
  };

  const icons = {
    granted: "✓",
    denied: "✗",
    pending: "○",
  };

  return (
    <span className={`rounded-md border px-2 py-0.5 font-medium text-xs ${styles[status]}`}>
      {icons[status]} {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
