import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface Permission {
  id: string;
  name: string;
  description: string;
  required: boolean;
  canRequestProgrammatically: boolean;
  status: "granted" | "denied" | "pending";
  instructions?: string;
}

export function PermissionsScreen({ onComplete }: { onComplete: () => void }) {
  const [permissions, setPermissions] = useState<Permission[]>([
    {
      id: "desktop",
      name: "Desktop Folder Access",
      description:
        "Required to manage and sync desktop files and configurations",
      required: true,
      canRequestProgrammatically: true,
      status: "pending",
    },
    {
      id: "documents",
      name: "Documents Folder Access",
      description:
        "Required to access and manage configuration files stored in Documents",
      required: true,
      canRequestProgrammatically: true,
      status: "pending",
    },
    {
      id: "admin",
      name: "Administrator Privileges",
      description:
        "Required to install system packages and modify system configurations",
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
  ]);

  const handleRequestPermission = (permissionId: string) => {
    setPermissions((prev) =>
      prev.map((p) =>
        p.id === permissionId
          ? { ...p, status: Math.random() > 0.3 ? "granted" : "denied" }
          : p
      )
    );
  };

  const allRequiredGranted = permissions
    .filter((p) => p.required)
    .every((p) => p.status === "granted");

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 md:p-8">
      <div className="w-full max-w-3xl">
        <div className="mb-8 text-center">
          <div className="mb-4 flex items-center justify-center gap-2">
            <div className="flex size-12 items-center justify-center rounded-lg bg-primary">
              <svg
                className="size-7 text-primary-foreground"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                />
              </svg>
            </div>
          </div>
          <h1 className="mb-2 font-semibold text-3xl tracking-tight">
            Welcome to nixmac
          </h1>
          <p className="text-muted-foreground">
            To manage your macOS system declaratively, nixmac needs the
            following permissions
          </p>
        </div>

        <Card className="mb-6 p-6">
          <div className="space-y-6">
            {permissions.map((permission) => (
              <div
                className="flex flex-col gap-3 border-b pb-6 last:border-b-0 last:pb-0"
                key={permission.id}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <h3 className="font-medium text-foreground">
                        {permission.name}
                      </h3>
                      {permission.required && (
                        <span className="rounded-md bg-primary/10 px-2 py-0.5 font-medium text-primary text-xs">
                          Required
                        </span>
                      )}
                      <PermissionStatusBadge status={permission.status} />
                    </div>
                    <p className="text-muted-foreground text-sm">
                      {permission.description}
                    </p>
                    {permission.instructions && (
                      <div className="mt-2 rounded-md border border-border bg-secondary/50 p-3">
                        <p className="font-mono text-muted-foreground text-xs">
                          {permission.instructions}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="flex-shrink-0">
                    {permission.canRequestProgrammatically ? (
                      <Button
                        disabled={permission.status === "granted"}
                        onClick={() => handleRequestPermission(permission.id)}
                        size="sm"
                        variant={
                          permission.status === "granted"
                            ? "secondary"
                            : "default"
                        }
                      >
                        {permission.status === "granted"
                          ? "Granted"
                          : permission.status === "denied"
                            ? "Retry"
                            : "Request"}
                      </Button>
                    ) : (
                      <Button
                        disabled={permission.status === "granted"}
                        onClick={() => handleRequestPermission(permission.id)}
                        size="sm"
                        variant="outline"
                      >
                        {permission.status === "granted"
                          ? "Granted"
                          : "Mark as Done"}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
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

        <div className="mt-6 rounded-lg border border-border bg-secondary/30 p-4">
          <div className="flex gap-3">
            <svg
              className="mt-0.5 size-5 flex-shrink-0 text-primary"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
              />
            </svg>
            <div className="flex-1">
              <h4 className="mb-1 font-medium text-sm">
                Why does nixmac need these permissions?
              </h4>
              <p className="text-muted-foreground text-xs leading-relaxed">
                nixmac manages your macOS system declaratively, similar to
                NixOS. It needs access to configuration files, the ability to
                install packages, and permission to modify system settings to
                provide a complete system management experience.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PermissionStatusBadge({
  status,
}: {
  status: "granted" | "denied" | "pending";
}) {
  const styles = {
    granted:
      "bg-console-success/10 text-console-success border-console-success/20",
    denied: "bg-console-error/10 text-console-error border-console-error/20",
    pending: "bg-secondary text-muted-foreground border-border",
  };

  const icons = {
    granted: "✓",
    denied: "✗",
    pending: "○",
  };

  return (
    <span
      className={`rounded-md border px-2 py-0.5 font-medium text-xs ${styles[status]}`}
    >
      {icons[status]} {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
