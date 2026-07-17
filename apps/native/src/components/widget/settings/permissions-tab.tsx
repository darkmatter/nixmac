import { PermissionsPanel } from "@/components/widget/permissions/permissions-panel";

/**
 * Settings → Permissions: the same panel shown during onboarding, so revoked
 * or pending macOS permissions can be reviewed and re-granted after setup.
 * The panel re-probes on mount and each grant action re-triggers the system
 * dialogs / deep-links the relevant System Settings pane.
 */
export function PermissionsTab() {
  return (
    <div>
      <h2 className="mb-1 font-semibold text-base">Permissions</h2>
      <p className="mb-4 text-muted-foreground text-sm">
        macOS permissions nixmac needs to read your configuration and apply changes. If a
        permission was revoked in System Settings, grant it again from here.
      </p>
      <PermissionsPanel />
    </div>
  );
}
