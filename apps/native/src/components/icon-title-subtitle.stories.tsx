// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)

import {
  CheckCircle,
  Cog,
  Download,
  Lock,
  Shield,
  Terminal,
} from "lucide-react";
import preview from "#storybook/preview";
import { IconTitleSub } from "./icon-title-subtitle";

// =============================================================================
// Meta
// =============================================================================

const meta = preview.meta({
  title: "components/IconTitleSubtitle",
  component: IconTitleSub,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    compact: {
      control: "boolean",
      sub: "Compact layout for smaller spaces",
    },
    showIconInCompact: {
      control: "boolean",
      sub: "Show icon even in compact mode",
    },
    icon: {
      control: false,
      sub: "Icon element to display (optional)",
    },
    title: {
      control: "text",
      sub: "Main title text",
    },
    sub: {
      control: "text",
      sub: "Subtitle below the title",
    },
  },
});

export default meta;

// =============================================================================
// Icons for Examples
// =============================================================================

const ConsoleIcon = (
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

// =============================================================================
// Stories
// =============================================================================

/**
 * Default full-size header with icon
 */
export const Default = meta.story({
  args: {
    icon: ConsoleIcon,
    title: "System Permissions",
    subtitle:
      "To manage your macOS system declaratively, nixmac needs the following permissions",
  },
});

/**
 * Compact version suitable for widgets or smaller spaces
 */
export const Compact = meta.story({
  args: {
    compact: true,
    title: "System Permissions",
    subtitle: "Grant the following permissions to continue",
  },
});

/**
 * Compact with icon shown (override default behavior)
 */
export const CompactWithIcon = meta.story({
  args: {
    compact: true,
    showIconInCompact: true,
    icon: ConsoleIcon,
    title: "System Permissions",
    subtitle: "Grant the following permissions to continue",
  },
});

/**
 * Without icon - text only header
 */
export const TextOnly = meta.story({
  args: {
    title: "Welcome to nixmac",
    subtitle: "Let's get your macOS system configured declaratively",
  },
});

/**
 * Setup completion example
 */
export const SetupComplete = meta.story({
  args: {
    icon: <CheckCircle className="size-7 text-primary-foreground" />,
    title: "Setup Complete!",
    subtitle:
      "Your system is now configured and ready to use. You can start managing your macOS setup declaratively through nixmac.",
  },
});

/**
 * Backup notification example
 */
export const BackupNotification = meta.story({
  args: {
    icon: <Shield className="size-7 text-primary-foreground" />,
    title: "System Backup",
    subtitle:
      "Before making changes to your system configuration, we recommend creating a backup of your current setup.",
  },
});

/**
 * Installation progress example
 */
export const InstallationProgress = meta.story({
  args: {
    icon: <Download className="size-7 text-primary-foreground" />,
    title: "Installing Packages",
    subtitle:
      "nixmac is installing the required system packages and configuring your environment. This may take a few minutes.",
  },
});

/**
 * Configuration management example
 */
export const ConfigManagement = meta.story({
  args: {
    icon: <Cog className="size-7 text-primary-foreground" />,
    title: "Configuration Manager",
    subtitle:
      "Manage your system configuration files, packages, and settings from a single declarative interface.",
  },
});

/**
 * Security settings example
 */
export const SecuritySettings = meta.story({
  args: {
    icon: <Lock className="size-7 text-primary-foreground" />,
    title: "Security & Privacy",
    subtitle:
      "Configure security settings and privacy permissions for your nixmac installation.",
  },
});

/**
 * Terminal access example
 */
export const TerminalAccess = meta.story({
  args: {
    icon: <Terminal className="size-7 text-primary-foreground" />,
    title: "Terminal Integration",
    subtitle:
      "nixmac provides seamless terminal integration for advanced system management and debugging.",
  },
});

/**
 * Long title and subtitle example
 */
export const LongContent = meta.story({
  args: {
    icon: ConsoleIcon,
    title: "Advanced System Configuration and Package Management Interface",
    subtitle:
      "This comprehensive system management tool provides declarative configuration capabilities for macOS through nix-darwin and home-manager integration. Manage packages, services, and system settings through version-controlled configuration files.",
  },
});

/**
 * Multiple headers example - shows stacking behavior
 */
export const MultipleHeaders = meta.story({
  render: () => (
    <div className="max-w-2xl space-y-8">
      <IconTitleSub
        icon={<Shield className="size-7 text-primary-foreground" />}
        subtitle="First step in the onboarding process"
        title="Step 1: Permissions"
      />
      <IconTitleSub
        compact
        subtitle="Compact version for step navigation"
        title="Step 2: Configuration"
      />
      <IconTitleSub
        icon={<CheckCircle className="size-7 text-primary-foreground" />}
        subtitle="Final step with completion icon"
        title="Step 3: Complete"
      />
    </div>
  ),
});

/**
 * Responsive comparison - shows both sizes side by side
 */
export const ResponsiveComparison = meta.story({
  render: () => (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      <div className="rounded-lg border p-6">
        <h3 className="mb-4 font-medium text-sm">Full Size</h3>
        <IconTitleSub
          icon={ConsoleIcon}
          subtitle="To manage your macOS system declaratively, nixmac needs the following permissions"
          title="System Permissions"
        />
      </div>
      <div className="rounded-lg border p-6">
        <h3 className="mb-4 font-medium text-sm">Compact</h3>
        <IconTitleSub
          compact
          subtitle="Grant the following permissions to continue"
          title="System Permissions"
        />
      </div>
    </div>
  ),
});
