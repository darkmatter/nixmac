// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)

import preview from "#storybook/preview";
import {
  AlertTriangle,
  CheckCircle,
  Info as InfoIcon,
  Shield,
  Sparkles,
  Terminal,
} from "lucide-react";
import type React from "react";
import { IconTitleDescriptionCard } from "./icon-title-description-card";

// =============================================================================
// Meta
// =============================================================================

const meta = preview.meta({
  title: "components/IconTitleDescriptionCard",
  component: IconTitleDescriptionCard,
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story: React.ComponentType) => (
        <Story />
    ),
  ],
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "info", "warning", "success"],
      description: "Visual variant for different use cases",
    },
    icon: {
      control: false,
      description: "Icon element to display",
    },
    title: {
      control: "text",
      description: "Card title",
    },
    description: {
      control: "text",
      description: "Card description/content",
    },
  },
});

export default meta;

// =============================================================================
// Icons for Examples
// =============================================================================

const CustomInfoIcon = (
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

// =============================================================================
// Stories
// =============================================================================

/**
 * Default variant - neutral informational card
 */
export const Default = meta.story({
  args: {
    icon: CustomInfoIcon,
    title: "Why does nixmac need these permissions?",
    description:
      "nixmac manages your macOS system declaratively, similar to NixOS. It needs access to configuration files, the ability to install packages, and permission to modify system settings to provide a complete system management experience.",
  },
});

/**
 * Info variant - highlighted informational content
 */
export const InfoVariant = meta.story({
  args: {
    variant: "info",
    icon: <InfoIcon className="size-full" />,
    title: "Getting Started",
    description:
      "This setup wizard will guide you through configuring nixmac for your system. The process typically takes 2-3 minutes to complete.",
  },
});

/**
 * Warning variant - important notices or cautions
 */
export const Warning = meta.story({
  args: {
    variant: "warning",
    icon: <AlertTriangle className="size-full" />,
    title: "Backup Recommended",
    description:
      "Before making system changes, we recommend creating a backup of your current configuration. This ensures you can restore your system if needed.",
  },
});

/**
 * Success variant - positive feedback or completed states
 */
export const Success = meta.story({
  args: {
    variant: "success",
    icon: <CheckCircle className="size-full" />,
    title: "Setup Complete!",
    description:
      "Your system is now configured and ready to use. You can start managing your macOS setup declaratively through nixmac.",
  },
});

/**
 * Security context example
 */
export const SecurityInfo = meta.story({
  args: {
    variant: "info",
    icon: <Shield className="size-full" />,
    title: "Security & Privacy",
    description:
      "nixmac only accesses the specific directories and resources it needs. All system modifications are transparent and can be reviewed before applying.",
  },
});

/**
 * Technical explanation example
 */
export const TechnicalDetails = meta.story({
  args: {
    icon: <Terminal className="size-full" />,
    title: "How it Works",
    description:
      "nixmac uses nix-darwin and home-manager to provide declarative system configuration. Your entire system state is defined in version-controlled configuration files.",
  },
});

/**
 * Feature highlight example
 */
export const FeatureHighlight = meta.story({
  args: {
    variant: "success",
    icon: <Sparkles className="size-full" />,
    title: "AI-Powered Configuration",
    description:
      "Our AI assistant can help you discover new packages, optimize your setup, and suggest improvements based on your usage patterns.",
  },
});

/**
 * Multiple cards example - shows how they look when stacked
 */
export const MultipleCards = meta.story({
  render: () => (
    <div className="space-y-4">
      <IconTitleDescriptionCard
        description="This is important information you should know before proceeding."
        icon={CustomInfoIcon}
        title="Before You Start"
        variant="info"
      />
      <IconTitleDescriptionCard
        description="Make sure to backup your important files before making system changes."
        icon={<AlertTriangle className="size-full" />}
        title="Backup Warning"
        variant="warning"
      />
      <IconTitleDescriptionCard
        description="Your configuration has been successfully applied to the system."
        icon={<CheckCircle className="size-full" />}
        title="Changes Applied"
        variant="success"
      />
    </div>
  ),
});

/**
 * Long content example - tests text wrapping and layout
 */
export const LongContent = meta.story({
  args: {
    icon: CustomInfoIcon,
    title: "Detailed System Configuration Process",
    description:
      "This comprehensive setup process involves multiple steps including permission verification, system package installation, configuration file generation, service management, and final system validation. Each step is carefully orchestrated to ensure your system remains stable and functional throughout the entire process. The declarative nature of nixmac means that every change is predictable and reproducible across different machines and environments.",
  },
});

/**
 * Compact layout example
 */
export const Compact = meta.story({
  args: {
    icon: CustomInfoIcon,
    title: "Quick Tip",
    description: "Use ⌘+Shift+O to quickly open the nixmac interface.",
  },
  decorators: [
    (Story: React.ComponentType) => (
        <Story />
    ),
  ],
});
