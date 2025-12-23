"use client";

import {
  ChevronDown,
  Code2,
  Eye,
  Keyboard,
  MessageSquare,
  Palette,
  RefreshCw,
  Settings,
  Sparkles,
  Terminal,
  Undo2,
  Wrench,
  X,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const systemChanges = [
  {
    title: "Telegram",
    category: "New App",
    icon: MessageSquare,
    color: "emerald",
    impact: "Messaging app for staying connected",
    detail: "Secure messaging with cloud sync",
  },
  {
    title: "WhatsApp",
    category: "New App",
    icon: MessageSquare,
    color: "emerald",
    impact: "Popular messaging platform",
    detail: "Chat, calls, and media sharing",
  },
  {
    title: "Linear",
    category: "New App",
    icon: Wrench,
    color: "emerald",
    impact: "Project management tool",
    detail: "Track issues and plan projects",
  },
  {
    title: "Editor Layout",
    category: "Settings",
    icon: Palette,
    color: "blue",
    impact: "Cleaner coding experience",
    detail: "Centered layout with better spacing",
  },
  {
    title: "Code Assistance",
    category: "Tools",
    icon: Code2,
    color: "amber",
    impact: "Smarter code suggestions",
    detail: "4 new plugins for Neovim",
  },
  {
    title: "Keyboard Shortcuts",
    category: "Settings",
    icon: Keyboard,
    color: "blue",
    impact: "Faster editing workflow",
    detail: "Reformatted keymaps for clarity",
  },
];

export function CardGridStyle() {
  const [hoveredCard, setHoveredCard] = useState<number | null>(null);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-border border-b px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-rose-500 to-orange-500">
            <span className="font-bold text-lg text-white">N</span>
          </div>
          <div>
            <h2 className="font-semibold">nixmac</h2>
            <p className="text-muted-foreground text-sm">System Manager</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="bg-amber-500/10 text-amber-500 hover:bg-amber-500/20">
            6 improvements ready
          </Badge>
          <Button className="h-8 w-8" size="icon" variant="ghost">
            <Settings className="h-4 w-4" />
          </Button>
          <Button className="h-8 w-8" size="icon" variant="ghost">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="p-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {systemChanges.map((change, i) => (
            <Card
              className={`cursor-pointer transition-all duration-200 ${
                hoveredCard === i
                  ? "border-primary bg-primary/5 shadow-lg"
                  : "hover:border-muted-foreground/30"
              }`}
              key={i}
              onMouseEnter={() => setHoveredCard(i)}
              onMouseLeave={() => setHoveredCard(null)}
            >
              <CardContent className="p-4">
                <div className="mb-3 flex items-start justify-between">
                  <div
                    className={`rounded-lg p-2 ${
                      change.color === "emerald"
                        ? "bg-emerald-500/10 text-emerald-500"
                        : change.color === "blue"
                          ? "bg-blue-500/10 text-blue-500"
                          : "bg-amber-500/10 text-amber-500"
                    }`}
                  >
                    <change.icon className="h-4 w-4" />
                  </div>
                  <Badge className="text-[10px]" variant="outline">
                    {change.category}
                  </Badge>
                </div>
                <h3 className="mb-1 font-medium text-sm">{change.title}</h3>
                <p className="text-muted-foreground text-xs">{change.impact}</p>

                {hoveredCard === i && (
                  <div className="mt-3 rounded border border-border bg-muted/50 p-2">
                    <p className="text-muted-foreground text-xs">{change.detail}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* AI Summary */}
      <div className="mx-5 mb-5 rounded-lg border border-border bg-muted/30 p-4">
        <div className="mb-2 flex items-center gap-2">
          <div className="rounded-full bg-gradient-to-r from-rose-500 to-orange-500 p-1.5">
            <Sparkles className="h-3 w-3 text-white" />
          </div>
          <span className="font-medium text-sm">What You're Getting</span>
        </div>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Three new apps for communication and project management, plus improvements to your code
          editor that make it easier to read and navigate your work.
        </p>
      </div>

      {/* Actions */}
      <div className="border-border border-t px-5 py-4">
        <div className="flex gap-3">
          <Button className="flex-1" size="lg">
            <Eye className="mr-2 h-4 w-4" />
            Preview
          </Button>
          <Button size="lg" variant="outline">
            <RefreshCw className="mr-2 h-4 w-4" />
            Update
          </Button>
          <Button size="lg" variant="outline">
            <Undo2 className="mr-2 h-4 w-4" />
            Rollback
          </Button>
        </div>
      </div>

      {/* Console */}
      <div className="border-border border-t">
        <button className="flex w-full items-center justify-between px-5 py-3 text-sm hover:bg-muted/50">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4" />
            <span>Activity Log</span>
          </div>
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
