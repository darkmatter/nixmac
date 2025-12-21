import { Link } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-border/40 border-b bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link className="flex items-center gap-2" to="/">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary">
            <svg
              className="size-5 text-primary-foreground"
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
          <span className="font-semibold text-xl tracking-tight">nixmac</span>
        </Link>
        <nav className="flex items-center gap-6">
          <Link
            className="text-muted-foreground text-sm transition-colors hover:text-foreground"
            hash="features"
            to="/"
          >
            Features
          </Link>
          <Link
            className="text-muted-foreground text-sm transition-colors hover:text-foreground"
            hash="flake-party"
            to="/"
          >
            Flake Party
          </Link>
          <Link
            className="text-muted-foreground text-sm transition-colors hover:text-foreground"
            hash="how-it-works"
            to="/"
          >
            How it Works
          </Link>
          <ModeToggle />
          <UserMenu />
          <Button asChild size="sm">
            <a href="/download">
              <Download className="mr-2 size-4" />
              Download
            </a>
          </Button>
        </nav>
      </div>
    </header>
  );
}
