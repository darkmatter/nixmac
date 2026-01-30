"use client";

import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI, type Permission, type PermissionStatus } from "@/tauri-api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Shield, Check, X, AlertCircle, Loader2 } from "lucide-react";
import { useState, useCallback, useEffect } from "react";

/**
 * Permissions step component - checks and requests macOS permissions
 * required for proper operation of nix-darwin.
 */
export function PermissionsStep() {
  const permissionsState = useWidgetStore((state) => state.permissionsState);
  const setPermissionsState = useWidgetStore((state) => state.setPermissionsState);
  const [isLoading, setIsLoading] = useState<string | null>(null);

  // Refresh permissions when the component mounts
  useEffect(() => {
    const refreshPermissions = async () => {
      try {
        const state = await darwinAPI.permissions.checkAll();
        setPermissionsState(state);
      } catch (error) {
        console.error("Failed to check permissions:", error);
      }
    };
    refreshPermissions();
  }, [setPermissionsState]);

  const handleRequestPermission = useCallback(async (permissionId: string) => {
    setIsLoading(permissionId);
    try {
      const updatedPermission = await darwinAPI.permissions.request(permissionId);
      
      // Update the permission in the state
      if (permissionsState) {
        const updatedPermissions = permissionsState.permissions.map((p) =>
          p.id === permissionId ? updatedPermission : p
        );
        const allRequiredGranted = updatedPermissions
          .filter((p) => p.required)
          .every((p) => p.status === "granted");
        
        setPermissionsState({
          ...permissionsState,
          permissions: updatedPermissions,
          allRequiredGranted,
        });
      }
    } catch (error) {
      console.error("Failed to request permission:", error);
    } finally {
      setIsLoading(null);
    }
  }, [permissionsState, setPermissionsState]);

  const handleRefreshAll = useCallback(async () => {
    setIsLoading("all");
    try {
      const state = await darwinAPI.permissions.checkAll();
      setPermissionsState(state);
    } catch (error) {
      console.error("Failed to refresh permissions:", error);
    } finally {
      setIsLoading(null);
    }
  }, [setPermissionsState]);

  const permissions = permissionsState?.permissions ?? [];
  const allRequiredGranted = permissionsState?.allRequiredGranted ?? false;

  return (
    <div className="flex h-full flex-col items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <h2 className="font-semibold text-foreground text-lg">
            System Permissions
          </h2>
          <p className="mt-1 text-muted-foreground text-sm">
            Grant the following permissions to continue
          </p>
        </div>

        {/* Permissions List */}
        <Card className="mb-4 p-4">
          <div className="space-y-4">
            {permissions.map((permission) => (
              <PermissionCard
                key={permission.id}
                permission={permission}
                isLoading={isLoading === permission.id}
                onRequest={() => handleRequestPermission(permission.id)}
              />
            ))}
          </div>
        </Card>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefreshAll}
            disabled={isLoading === "all"}
          >
            {isLoading === "all" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Refresh
          </Button>
          <p className="text-muted-foreground text-sm">
            {allRequiredGranted
              ? "All required permissions granted!"
              : "Grant all required permissions to continue"}
          </p>
        </div>
      </div>
    </div>
  );
}

interface PermissionCardProps {
  permission: Permission;
  isLoading: boolean;
  onRequest: () => void;
}

function PermissionCard({ permission, isLoading, onRequest }: PermissionCardProps) {
  const actionLabel = getActionLabel(permission.status);
  const isGranted = permission.status === "granted";

  return (
    <div className="flex flex-col gap-2 border-b pb-4 last:border-b-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h3 className="font-medium text-foreground text-sm">
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
            <div className="mt-2 rounded-md border border-border bg-secondary/50 p-2">
              <p className="font-mono text-muted-foreground text-xs">
                {permission.instructions}
              </p>
            </div>
          )}
        </div>
        <div className="flex-shrink-0">
          <Button
            disabled={isGranted || isLoading}
            onClick={onRequest}
            size="sm"
            variant={isGranted ? "secondary" : permission.canRequestProgrammatically ? "default" : "outline"}
          >
            {isLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            {actionLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PermissionStatusBadge({ status }: { status: PermissionStatus }) {
  const styles: Record<PermissionStatus, string> = {
    granted: "bg-console-success/10 text-console-success border-console-success/20",
    denied: "bg-console-error/10 text-console-error border-console-error/20",
    pending: "bg-secondary text-muted-foreground border-border",
    unknown: "bg-secondary text-muted-foreground border-border",
  };

  const icons: Record<PermissionStatus, React.ReactNode> = {
    granted: <Check className="mr-1 h-3 w-3" />,
    denied: <X className="mr-1 h-3 w-3" />,
    pending: <AlertCircle className="mr-1 h-3 w-3" />,
    unknown: <AlertCircle className="mr-1 h-3 w-3" />,
  };

  const labels: Record<PermissionStatus, string> = {
    granted: "Granted",
    denied: "Denied",
    pending: "Pending",
    unknown: "Unknown",
  };

  return (
    <span
      className={`flex items-center rounded-md border px-2 py-0.5 font-medium text-xs ${styles[status]}`}
    >
      {icons[status]} {labels[status]}
    </span>
  );
}

function getActionLabel(status: PermissionStatus): string {
  switch (status) {
    case "granted":
      return "Granted";
    case "denied":
      return "Retry";
    case "pending":
    case "unknown":
    default:
      return "Request";
  }
}
