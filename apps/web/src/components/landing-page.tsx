import {
  ArrowRight,
  ChevronRight,
  Code2,
  Download,
  GitBranch,
  Monitor,
  Package,
  Shield,
  Sparkles,
  Terminal,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function LandingPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* Subtle gradient background */}
        <div className="absolute inset-0 bg-gradient-to-b from-zinc-900/50 to-zinc-950" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-zinc-800/20 via-transparent to-transparent" />

        <div className="container relative mx-auto px-6 pt-20 pb-12 md:pt-32 md:pb-20">
          <div className="mx-auto max-w-4xl text-center">
            <Badge
              className="mb-6 border border-zinc-700 bg-zinc-800/50 text-zinc-300"
              variant="secondary"
            >
              <Sparkles className="mr-1 size-3" />
              Declarative macOS Management :)
            </Badge>
            <h1 className="mb-6 text-balance font-bold text-4xl tracking-tight sm:text-5xl md:text-6xl lg:text-7xl">
              Your Mac, defined in{" "}
              <span className="bg-gradient-to-r from-zinc-100 to-zinc-400 bg-clip-text text-transparent">
                code
              </span>
            </h1>
            <p className="mx-auto mb-10 max-w-2xl text-pretty text-lg text-zinc-400 md:text-xl">
              nixmac brings the power of Nix to macOS. Declaratively manage
              packages, settings, and configurations. Version control your
              entire system. Reproduce your setup anywhere.
            </p>
            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button
                className="h-12 gap-2 bg-zinc-100 px-8 text-zinc-950 hover:bg-zinc-200"
                size="lg"
              >
                <Download className="size-5" />
                Download for Mac
              </Button>
              <Button
                className="h-12 gap-2 border-zinc-700 bg-transparent px-8 text-zinc-100 hover:bg-zinc-800"
                size="lg"
                variant="outline"
              >
                View on GitHub
                <ArrowRight className="size-4" />
              </Button>
            </div>
            <p className="mt-4 text-sm text-zinc-500">
              Requires macOS 12+ and Nix
            </p>
          </div>

          {/* App Screenshot */}
          <div className="relative mx-auto mt-16 max-w-2xl md:mt-20">
            <div className="-inset-4 absolute rounded-2xl bg-gradient-to-b from-zinc-800/50 to-transparent blur-xl" />
            <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl">
              <picture>
                <img
                  alt="nixmac desktop application showing the system manager interface with configuration options"
                  className="w-full"
                  height={600}
                  src="/images/shot-widget.png"
                  width={800}
                />
              </picture>
            </div>
          </div>
        </div>
      </section>

      {/* Social Proof */}
      <section className="border-zinc-800/50 border-y bg-zinc-900/30 py-8">
        <div className="container mx-auto px-6">
          <p className="text-center text-sm text-zinc-500">
            Trusted by developers who care about reproducible, declarative
            system management
          </p>
        </div>
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-6 py-24" id="features">
        <div className="mx-auto max-w-6xl">
          <div className="mb-16 text-center">
            <Badge
              className="mb-4 border border-zinc-700 bg-zinc-800/50 text-zinc-300"
              variant="secondary"
            >
              Features
            </Badge>
            <h2 className="mb-4 text-balance font-bold text-3xl md:text-4xl">
              Everything you need to manage your Mac
            </h2>
            <p className="mx-auto max-w-2xl text-zinc-400">
              nixmac wraps the complexity of Nix in a beautiful native
              interface, making declarative system management accessible to
              everyone.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card className="group border-zinc-800 bg-zinc-900/50 transition-colors hover:border-zinc-700 hover:bg-zinc-900">
              <CardContent className="p-6">
                <div className="mb-4 flex size-12 items-center justify-center rounded-lg bg-zinc-800 transition-colors group-hover:bg-zinc-700">
                  <Terminal className="size-6 text-zinc-300" />
                </div>
                <h3 className="mb-2 font-semibold text-lg">
                  Declarative Configuration
                </h3>
                <p className="text-sm text-zinc-400 leading-relaxed">
                  Define your entire system in code. No more manual setup or
                  forgotten configurations.
                </p>
              </CardContent>
            </Card>

            <Card className="group border-zinc-800 bg-zinc-900/50 transition-colors hover:border-zinc-700 hover:bg-zinc-900">
              <CardContent className="p-6">
                <div className="mb-4 flex size-12 items-center justify-center rounded-lg bg-zinc-800 transition-colors group-hover:bg-zinc-700">
                  <GitBranch className="size-6 text-zinc-300" />
                </div>
                <h3 className="mb-2 font-semibold text-lg">Version Control</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">
                  Track changes to your system configuration with Git. Roll back
                  mistakes instantly.
                </p>
              </CardContent>
            </Card>

            <Card className="group border-zinc-800 bg-zinc-900/50 transition-colors hover:border-zinc-700 hover:bg-zinc-900">
              <CardContent className="p-6">
                <div className="mb-4 flex size-12 items-center justify-center rounded-lg bg-zinc-800 transition-colors group-hover:bg-zinc-700">
                  <Package className="size-6 text-zinc-300" />
                </div>
                <h3 className="mb-2 font-semibold text-lg">
                  Reproducible Builds
                </h3>
                <p className="text-sm text-zinc-400 leading-relaxed">
                  Set up a new machine in minutes with the exact same
                  configuration every time.
                </p>
              </CardContent>
            </Card>

            <Card className="group border-zinc-800 bg-zinc-900/50 transition-colors hover:border-zinc-700 hover:bg-zinc-900">
              <CardContent className="p-6">
                <div className="mb-4 flex size-12 items-center justify-center rounded-lg bg-zinc-800 transition-colors group-hover:bg-zinc-700">
                  <Shield className="size-6 text-zinc-300" />
                </div>
                <h3 className="mb-2 font-semibold text-lg">Atomic Updates</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">
                  System changes are atomic. If something fails, your system
                  stays in a working state.
                </p>
              </CardContent>
            </Card>

            <Card className="group border-zinc-800 bg-zinc-900/50 transition-colors hover:border-zinc-700 hover:bg-zinc-900">
              <CardContent className="p-6">
                <div className="mb-4 flex size-12 items-center justify-center rounded-lg bg-zinc-800 transition-colors group-hover:bg-zinc-700">
                  <Zap className="size-6 text-zinc-300" />
                </div>
                <h3 className="mb-2 font-semibold text-lg">Multiple Hosts</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">
                  Manage configurations for multiple machines from a single
                  repository with ease.
                </p>
              </CardContent>
            </Card>

            <Card className="group border-zinc-800 bg-zinc-900/50 transition-colors hover:border-zinc-700 hover:bg-zinc-900">
              <CardContent className="p-6">
                <div className="mb-4 flex size-12 items-center justify-center rounded-lg bg-zinc-800 transition-colors group-hover:bg-zinc-700">
                  <Sparkles className="size-6 text-zinc-300" />
                </div>
                <h3 className="mb-2 font-semibold text-lg">Natural Language</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">
                  Describe changes in plain English. nixmac translates your
                  intent into configuration.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section
        className="border-zinc-800/50 border-y bg-zinc-900/20 py-24"
        id="how-it-works"
      >
        <div className="container mx-auto px-6">
          <div className="mx-auto max-w-4xl">
            <div className="mb-16 text-center">
              <Badge
                className="mb-4 border border-zinc-700 bg-zinc-800/50 text-zinc-300"
                variant="secondary"
              >
                How It Works
              </Badge>
              <h2 className="mb-4 text-balance font-bold text-3xl md:text-4xl">
                Simple, yet powerful
              </h2>
              <p className="mx-auto max-w-2xl text-zinc-400">
                Get started in minutes. nixmac handles the complexity so you can
                focus on what matters.
              </p>
            </div>

            <div className="space-y-12">
              <div className="flex flex-col gap-6 md:flex-row md:items-start">
                <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-zinc-800 font-bold text-xl">
                  1
                </div>
                <div className="flex-1">
                  <h3 className="mb-3 font-semibold text-xl">
                    Describe your desired state
                  </h3>
                  <p className="mb-4 text-zinc-400 leading-relaxed">
                    Tell nixmac what you want. Install packages, configure
                    settings, set up keyboard shortcuts - all in plain language
                    or by selecting from curated options.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Badge
                      className="border-zinc-700 text-zinc-400"
                      variant="outline"
                    >
                      Install vim
                    </Badge>
                    <Badge
                      className="border-zinc-700 text-zinc-400"
                      variant="outline"
                    >
                      Add Rectangle app
                    </Badge>
                    <Badge
                      className="border-zinc-700 text-zinc-400"
                      variant="outline"
                    >
                      Configure git
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-6 md:flex-row md:items-start">
                <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-zinc-800 font-bold text-xl">
                  2
                </div>
                <div className="flex-1">
                  <h3 className="mb-3 font-semibold text-xl">
                    Review and evolve
                  </h3>
                  <p className="text-zinc-400 leading-relaxed">
                    nixmac shows you exactly what will change before applying.
                    Click "Evolve" and watch as your system transforms to match
                    your configuration. Every change is tracked and reversible.
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-6 md:flex-row md:items-start">
                <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-zinc-800 font-bold text-xl">
                  3
                </div>
                <div className="flex-1">
                  <h3 className="mb-3 font-semibold text-xl">
                    Share and reproduce
                  </h3>
                  <p className="text-zinc-400 leading-relaxed">
                    Your configuration lives in a Git repository. Share it with
                    your team, sync across machines, or use it to set up a brand
                    new Mac in minutes. Your system is now code.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Code Example */}
      <section className="container mx-auto px-6 py-24">
        <div className="mx-auto max-w-4xl">
          <div className="mb-12 text-center">
            <Badge
              className="mb-4 border border-zinc-700 bg-zinc-800/50 text-zinc-300"
              variant="secondary"
            >
              <Code2 className="mr-1 size-3" />
              Configuration as Code
            </Badge>
            <h2 className="mb-4 text-balance font-bold text-3xl md:text-4xl">
              Your entire Mac in a single file
            </h2>
            <p className="text-zinc-400">
              See exactly what your system looks like. Version control
              everything.
            </p>
          </div>

          <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
            <div className="flex items-center gap-2 border-zinc-800 border-b bg-zinc-900/50 px-4 py-3">
              <div className="size-3 rounded-full bg-zinc-700" />
              <div className="size-3 rounded-full bg-zinc-700" />
              <div className="size-3 rounded-full bg-zinc-700" />
              <span className="ml-2 text-sm text-zinc-500">flake.nix</span>
            </div>
            <pre className="overflow-x-auto p-6 text-sm leading-relaxed">
              <code className="text-zinc-300">
                {`{
  description = "My Mac configuration";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
    darwin.url = "github:lnl7/nix-darwin";
  };

  outputs = { self, nixpkgs, darwin }: {
    darwinConfigurations."macbook" = darwin.lib.darwinSystem {
      system = "aarch64-darwin";
      modules = [{
        environment.systemPackages = with nixpkgs; [
          vim git ripgrep fzf
        ];

        homebrew = {
          enable = true;
          casks = [ "rectangle" "raycast" "arc" ];
        };

        system.defaults.dock.autohide = true;
      }];
    };
  };
}`}
              </code>
            </pre>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-6 py-24" id="download">
        <div className="mx-auto max-w-3xl">
          <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50 p-8 text-center md:p-12">
            <div className="absolute inset-0 bg-gradient-to-br from-zinc-800/20 to-transparent" />
            <div className="relative">
              <div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-2xl bg-zinc-800">
                <Monitor className="size-8 text-zinc-300" />
              </div>
              <h2 className="mb-4 text-balance font-bold text-3xl md:text-4xl">
                Ready to evolve your Mac?
              </h2>
              <p className="mx-auto mb-8 max-w-lg text-zinc-400">
                Join developers who have embraced declarative system management.
                Download nixmac and take control of your configuration.
              </p>
              <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
                <Button
                  className="h-12 gap-2 bg-zinc-100 px-8 text-zinc-950 hover:bg-zinc-200"
                  size="lg"
                >
                  <Download className="size-5" />
                  Download for Mac
                </Button>
                <Button
                  className="h-12 gap-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                  size="lg"
                  variant="ghost"
                >
                  Read the docs
                  <ChevronRight className="size-4" />
                </Button>
              </div>
              <p className="mt-6 text-sm text-zinc-500">
                Free and open source. macOS 12+ required.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-zinc-800/50 border-t py-12">
        <div className="container mx-auto px-6">
          <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
            <div className="flex items-center gap-3">
              <div className="flex size-8 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800">
                <span className="font-bold text-blue-400 text-xs">?</span>
              </div>
              <span className="font-semibold">nixmac</span>
            </div>
            <div className="flex items-center gap-6 text-sm text-zinc-500">
              <a
                className="transition-colors hover:text-zinc-300"
                href="https://github.com"
                rel="noopener noreferrer"
                target="_blank"
              >
                GitHub
              </a>
              <a className="transition-colors hover:text-zinc-300" href="/docs">
                Documentation
              </a>
              <a
                className="transition-colors hover:text-zinc-300"
                href="https://twitter.com"
                rel="noopener noreferrer"
                target="_blank"
              >
                Twitter
              </a>
            </div>
            <p className="text-sm text-zinc-500">Built with Nix and love</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
