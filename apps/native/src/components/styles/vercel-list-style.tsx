import {
  Check,
  ChevronDown,
  Download,
  Eye,
  Palette,
  RefreshCw,
  Settings,
  Shield,
  Sparkles,
  Terminal,
  Undo2,
  Wrench,
  X,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const systemChanges = [
  {
    category: "New Apps",
    icon: Download,
    color: "emerald",
    description: "3 apps will be installed",
    items: ["Telegram", "WhatsApp", "Linear"],
  },
  {
    category: "Editor Settings",
    icon: Palette,
    color: "blue",
    description: "Visual preferences updated",
    items: ["Centered layout in Zed", "New color theme applied"],
  },
  {
    category: "Developer Tools",
    icon: Wrench,
    color: "amber",
    description: "Code tools enhanced",
    items: ["4 new Neovim plugins", "Additional language support"],
  },
  {
    category: "System Config",
    icon: Shield,
    color: "slate",
    description: "Background optimizations",
    items: ["Package list reorganized", "Config formatting improved"],
  },
];

function getCategoryColorClasses(color: string) {
  switch (color) {
    case "emerald":
      return "bg-emerald-500/10 text-emerald-500";
    case "blue":
      return "bg-blue-500/10 text-blue-500";
    case "amber":
      return "bg-amber-500/10 text-amber-500";
    default:
      return "bg-slate-500/10 text-slate-500";
  }
}

export function VercelListStyle() {
  const [selectedAction, setSelectedAction] = useState<string>("preview");
  const [expandedCategory, setExpandedCategory] = useState<string | null>("New Apps");

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-border border-b px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600">
            <span className="font-bold text-lg text-white">N</span>
          </div>
          <div>
            <h2 className="font-semibold">nixmac</h2>
            <p className="text-muted-foreground text-sm">System Manager</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button className="h-8 w-8" size="icon" variant="ghost">
            <Settings className="h-4 w-4" />
          </Button>
          <Button className="h-8 w-8" size="icon" variant="ghost">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between border-border border-b bg-muted/30 px-5 py-3">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-amber-500" />
          <span className="font-medium text-sm">Ready to Update</span>
        </div>
        <Badge className="text-xs" variant="secondary">
          4 types of changes
        </Badge>
      </div>

      <div className="divide-y divide-border">
        {systemChanges.map((change) => (
          <div key={change.category}>
            <button
              className="group flex w-full items-center justify-between px-5 py-4 transition-colors hover:bg-muted/50"
              onClick={() =>
                setExpandedCategory(expandedCategory === change.category ? null : change.category)
              }
              type="button"
            >
              <div className="flex items-center gap-3">
                <div className={`rounded-lg p-2 ${getCategoryColorClasses(change.color)}`}>
                  <change.icon className="h-4 w-4" />
                </div>
                <div className="text-left">
                  <p className="font-medium">{change.category}</p>
                  <p className="text-muted-foreground text-sm">{change.description}</p>
                </div>
              </div>
              <ChevronDown
                className={`h-4 w-4 text-muted-foreground transition-transform ${
                  expandedCategory === change.category ? "rotate-180" : ""
                }`}
              />
            </button>
            {expandedCategory === change.category && (
              <div className="border-border border-t bg-muted/20 px-5 py-3">
                <ul className="space-y-2">
                  {change.items.map((item) => (
                    <li
                      className="flex items-center gap-2 text-muted-foreground text-sm"
                      key={item}
                    >
                      <Check className="h-3 w-3 text-emerald-500" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* AI Summary */}
      <div className="border-border border-t bg-muted/20 px-5 py-4">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-500" />
          <span className="font-medium text-sm">What's Changing</span>
        </div>
        <p className="text-muted-foreground text-sm leading-relaxed">
          This update adds 3 communication apps to your system, improves your code editor layout,
          and enhances your developer tools with better language support.
        </p>
      </div>

      {/* Action Buttons */}
      <div className="border-border border-t px-5 py-4">
        <div className="mb-4 flex gap-2">
          {[
            { id: "preview", label: "Preview", icon: Eye },
            { id: "update", label: "Update", icon: RefreshCw },
            { id: "rollback", label: "Rollback", icon: Undo2 },
          ].map((action) => (
            <Button
              className="flex-1"
              key={action.id}
              onClick={() => setSelectedAction(action.id)}
              size="sm"
              variant={selectedAction === action.id ? "default" : "outline"}
            >
              <action.icon className="mr-2 h-4 w-4" />
              {action.label}
            </Button>
          ))}
        </div>

        <div className="mb-4 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-4 py-3">
          <div className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 text-cyan-500" />
            <div>
              <p className="font-medium text-cyan-500 text-sm">Safe to try</p>
              <p className="text-cyan-500/70 text-xs">
                Preview lets you test changes before making them permanent.
              </p>
            </div>
          </div>
        </div>

        <Button className="w-full" size="lg">
          <Eye className="mr-2 h-4 w-4" />
          Preview Changes
        </Button>
      </div>

      {/* Console */}
      <div className="border-border border-t">
        <button
          className="flex w-full items-center justify-between px-5 py-3 text-sm hover:bg-muted/50"
          type="button"
        >
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4" />
            <span>Activity Log</span>
          </div>
          <ChevronDown className="h-4 w-4" />
        </button>
        <div className="border-border border-t bg-black/50 px-5 py-3">
          <code className="font-mono text-emerald-400 text-xs">Waiting for action...</code>
        </div>
      </div>
    </div>
  );
}
