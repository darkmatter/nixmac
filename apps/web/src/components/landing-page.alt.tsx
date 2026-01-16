import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const featuredPresets = [
  {
    id: "minimal-dev",
    name: "Minimal Dev",
    author: "sarah_dev",
    downloads: "12.4k",
    description:
      "Clean setup for web developers with VS Code, Git, and Node.js",
    tags: ["web", "minimal"],
    icons: ["visual-studio-code", "github", "node-js", "iterm2", "homebrew"],
  },
  {
    id: "creative-suite",
    name: "Creative Suite",
    author: "designhub",
    downloads: "8.2k",
    description: "Full creative workflow with Figma, Adobe CC, and color tools",
    tags: ["design", "creative"],
    icons: [
      "figma",
      "adobe-photoshop",
      "adobe-illustrator",
      "sketch",
      "blender",
    ],
  },
  {
    id: "data-science-pro",
    name: "Data Science Pro",
    author: "mlops_mike",
    downloads: "6.7k",
    description: "Python, Jupyter, and ML tools preconfigured and ready to go",
    tags: ["python", "data"],
    icons: ["python", "jupyter", "anaconda", "docker", "postgresql"],
  },
  {
    id: "ios-developer",
    name: "iOS Developer",
    author: "swiftui_sam",
    downloads: "9.1k",
    description: "Xcode, simulators, and essential iOS development utilities",
    tags: ["ios", "swift"],
    icons: ["xcode", "apple", "testflight", "github", "slack"],
  },
  {
    id: "privacy-first",
    name: "Privacy First",
    author: "securitynerd",
    downloads: "4.3k",
    description:
      "Hardened macOS settings with privacy-focused app alternatives",
    tags: ["security", "privacy"],
    icons: ["bitwarden", "proton-vpn", "firefox", "signal", "tor-browser"],
  },
  {
    id: "streamer-setup",
    name: "Streamer Setup",
    author: "livecoder",
    downloads: "5.8k",
    description:
      "OBS, audio tools, and streaming essentials for content creators",
    tags: ["streaming", "content"],
    icons: ["obs-studio", "discord", "spotify", "twitch", "streamlabs"],
  },
];

const features = [
  {
    id: "one-click",
    icon: "cursor",
    title: "One-Click Presets",
    description:
      "Browse community presets and apply them instantly. No configuration needed.",
  },
  {
    id: "easy-undo",
    icon: "clock",
    title: "Easy Undo",
    description:
      "Made a change you don't like? Revert to your previous setup with one click.",
  },
  {
    id: "copy-setup",
    icon: "copy",
    title: "Copy Your Setup",
    description:
      "Got a new Mac? Apply your exact setup from your old machine in minutes.",
  },
  {
    id: "share",
    icon: "shield",
    title: "Share with Friends",
    description:
      "Send your setup to friends or colleagues so they can use it too.",
  },
  {
    id: "consistent",
    icon: "shield",
    title: "Always Consistent",
    description:
      "Your apps, settings, and preferences stay exactly how you set them up.",
  },
  {
    id: "fast",
    icon: "bolt",
    title: "Super Fast",
    description:
      "Most setups complete in under 10 minutes. Go grab a coffee and come back ready.",
  },
];

const steps = [
  {
    id: "step-1",
    step: "01",
    title: "Pick a preset",
    description:
      "Browse Flake Party and find a setup that matches how you work. Designer? Developer? Student? There is one for you.",
  },
  {
    id: "step-2",
    step: "02",
    title: "Click apply",
    description:
      "Hit the apply button and let nixmac handle everything. Apps install, settings configure, all automatically.",
  },
  {
    id: "step-3",
    step: "03",
    title: "You are done",
    description:
      "That is it. Your Mac is set up and ready to go. Customize further anytime, or share your own preset with others.",
  },
];

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        d="M5 13l4 4L19 7"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
      />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-3"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
      />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        d="M17 8l4 4m0 0l-4 4m4-4H3"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
      />
    </svg>
  );
}

function TerminalIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
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
  );
}

function FeatureIcon({ type }: { type: string }) {
  const paths: Record<string, string> = {
    cursor:
      "M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122",
    clock: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
    copy: "M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z",
    shield:
      "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
    bolt: "M13 10V3L4 14h7v7l9-11h-7z",
  };

  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        d={paths[type] || paths.cursor}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
      />
    </svg>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section - Rewritten for non-technical users */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-grid-pattern opacity-5" />
        <div className="mx-auto max-w-7xl px-6 py-24 sm:py-32">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-border bg-secondary/50 px-3 py-1 text-sm">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              <span className="text-muted-foreground">Now in beta</span>
            </div>
            <h1 className="mb-6 text-balance font-bold text-5xl tracking-tight sm:text-6xl">
              Set up your Mac
              <br />
              <span className="text-muted-foreground">
                exactly how you like it.
              </span>
            </h1>
            <p className="mb-8 text-pretty text-muted-foreground text-xl leading-relaxed">
              Stop spending hours configuring your Mac. Pick a preset from our
              community, click apply, and you are done. No terminal commands. No
              hunting for settings. Just your perfect setup, instantly.
            </p>
            <div className="flex items-center justify-center gap-4">
              <Button asChild size="lg">
                <Link hash="flake-party" to="/">
                  Browse Presets
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/dashboard">Launch App</Link>
              </Button>
            </div>
            <div className="mt-8 flex items-center justify-center gap-8 text-muted-foreground text-sm">
              <div className="flex items-center gap-2">
                <CheckIcon />
                <span>No coding required</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckIcon />
                <span>One-click setup</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckIcon />
                <span>Free forever</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        className="border-border border-y bg-secondary/20"
        id="flake-party"
      >
        <div className="mx-auto max-w-7xl px-6 py-24">
          <div className="mb-12 text-center">
            <div className="mb-4 inline-flex items-center gap-2">
              <span className="text-4xl">🎉</span>
              <h2 className="font-bold text-4xl tracking-tight">Flake Party</h2>
            </div>
            <p className="mx-auto max-w-2xl text-balance text-muted-foreground text-xl">
              Discover community-created presets for every workflow. Find your
              perfect setup and apply it with one click.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {featuredPresets.map((preset) => (
              <Card
                className="group cursor-pointer border-border/40 transition-all hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5"
                key={preset.id}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-lg transition-colors group-hover:text-primary">
                      {preset.name}
                    </CardTitle>
                    <div className="flex items-center gap-1 text-muted-foreground text-xs">
                      <DownloadIcon />
                      {preset.downloads}
                    </div>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    by @{preset.author}
                  </p>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="mb-3 flex items-center gap-1.5">
                    {preset.icons.map((icon) => (
                      <div
                        className="flex size-7 items-center justify-center rounded-md bg-secondary/80 p-1"
                        key={icon}
                        title={icon.replace(/-/g, " ")}
                      >
                        <picture>
                          <img
                            alt={`${icon.replace(/-/g, " ")} icon`}
                            className="size-5 object-contain"
                            height={20}
                            src={`https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/${icon}.png`}
                            width={20}
                          />
                        </picture>
                      </div>
                    ))}
                  </div>
                  <p className="mb-3 text-muted-foreground text-sm leading-relaxed">
                    {preset.description}
                  </p>
                  <div className="flex gap-2">
                    {preset.tags.map((tag) => (
                      <Badge className="text-xs" key={tag} variant="secondary">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="mt-10 text-center">
            <Button asChild size="lg" variant="outline">
              <a className="inline-flex items-center gap-2" href="/flake-party">
                Explore all presets
                <ArrowRightIcon />
              </a>
            </Button>
          </div>
        </div>
      </section>

      {/* Features Grid - Rewritten for non-technical users */}
      <section className="mx-auto max-w-7xl px-6 py-24" id="features">
        <div className="mb-16 text-center">
          <h2 className="mb-4 font-bold text-4xl tracking-tight">
            Why nixmac?
          </h2>
          <p className="mx-auto max-w-2xl text-balance text-muted-foreground text-xl">
            Setting up a new Mac should take minutes, not hours. Here is how
            nixmac makes it happen.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <Card
              className="border-border/40 transition-colors hover:border-border"
              key={feature.id}
            >
              <CardHeader>
                <div className="mb-4 flex size-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <div className="size-6">
                    <FeatureIcon type={feature.icon} />
                  </div>
                </div>
                <CardTitle className="text-lg">{feature.title}</CardTitle>
                <CardDescription className="leading-relaxed">
                  {feature.description}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      {/* How It Works Section - Simplified for non-technical users */}
      <section
        className="border-border border-t bg-secondary/20"
        id="how-it-works"
      >
        <div className="mx-auto max-w-7xl px-6 py-24">
          <div className="mb-16 text-center">
            <h2 className="mb-4 font-bold text-4xl tracking-tight">
              How it works
            </h2>
            <p className="mx-auto max-w-2xl text-balance text-muted-foreground text-xl">
              Get your perfect Mac setup in three simple steps
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            {steps.map((item) => (
              <div className="relative" key={item.id}>
                <div className="mb-4 font-bold text-7xl text-primary/10">
                  {item.step}
                </div>
                <h3 className="mb-3 font-semibold text-2xl">{item.title}</h3>
                <p className="text-muted-foreground leading-relaxed">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="border-border border-t">
        <div className="mx-auto max-w-4xl px-6 py-24 text-center">
          <h2 className="mb-4 font-bold text-4xl tracking-tight">
            Ready to set up your Mac?
          </h2>
          <p className="mb-8 text-balance text-muted-foreground text-xl">
            Join thousands of users who have already simplified their Mac setup
            with nixmac
          </p>
          <div className="flex items-center justify-center gap-4">
            <Button asChild size="lg">
              <Link hash="flake-party" to="/">
                Browse Presets
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/dashboard">Launch App</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Footer - Updated with Flake Party links */}
      <footer className="border-border border-t bg-secondary/20">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <div className="grid gap-8 md:grid-cols-4">
            <div>
              <div className="mb-4 flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-md bg-primary">
                  <TerminalIcon className="size-5 text-primary-foreground" />
                </div>
                <span className="font-semibold text-lg">nixmac</span>
              </div>
              <p className="text-muted-foreground text-sm">
                The easiest way to set up your Mac
              </p>
            </div>
            <div>
              <h4 className="mb-3 font-semibold">Product</h4>
              <ul className="space-y-2 text-muted-foreground text-sm">
                <li>
                  <Link
                    className="transition-colors hover:text-foreground"
                    hash="features"
                    to="/"
                  >
                    Features
                  </Link>
                </li>
                <li>
                  <Link
                    className="transition-colors hover:text-foreground"
                    hash="flake-party"
                    to="/"
                  >
                    Flake Party
                  </Link>
                </li>
                <li>
                  <Link
                    className="transition-colors hover:text-foreground"
                    to="/dashboard"
                  >
                    App
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="mb-3 font-semibold">Resources</h4>
              <ul className="space-y-2 text-muted-foreground text-sm">
                <li>
                  <Link
                    className="transition-colors hover:text-foreground"
                    hash="how-it-works"
                    to="/"
                  >
                    Getting Started
                  </Link>
                </li>
                <li>
                  <Link
                    className="transition-colors hover:text-foreground"
                    hash="flake-party"
                    to="/"
                  >
                    Popular Presets
                  </Link>
                </li>
                <li>
                  <a
                    className="transition-colors hover:text-foreground"
                    href="https://github.com"
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    Community
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="mb-3 font-semibold">Connect</h4>
              <ul className="space-y-2 text-muted-foreground text-sm">
                <li>
                  <a
                    className="transition-colors hover:text-foreground"
                    href="https://github.com"
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    GitHub
                  </a>
                </li>
                <li>
                  <a
                    className="transition-colors hover:text-foreground"
                    href="https://twitter.com"
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    Twitter
                  </a>
                </li>
              </ul>
            </div>
          </div>
          <div className="mt-12 flex items-center justify-between border-border border-t pt-8 text-muted-foreground text-sm">
            <p>© 2025 nixmac. All rights reserved.</p>
            <div className="flex items-center gap-6">
              <a
                className="transition-colors hover:text-foreground"
                href="/privacy"
              >
                Privacy
              </a>
              <a
                className="transition-colors hover:text-foreground"
                href="/terms"
              >
                Terms
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
