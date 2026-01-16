"use client";
import { ImageIcon, Keyboard, Package } from "lucide-react";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface SetupWizardStepProps {
  config: {
    backgrounds: string[];
    shortcuts: string[];
    apps: string[];
  };
  setConfig: (config: any) => void;
}

const WALLPAPERS = [
  { id: "macos-sonoma", name: "macOS Sonoma", category: "Apple" },
  { id: "macos-ventura", name: "macOS Ventura", category: "Apple" },
  { id: "abstract-waves", name: "Abstract Waves", category: "Abstract" },
  { id: "mountain-sunset", name: "Mountain Sunset", category: "Nature" },
  { id: "minimal-dark", name: "Minimal Dark", category: "Minimal" },
];

const SHORTCUTS = [
  { id: "spotlight", name: "Spotlight Search", keys: "⌘ Space" },
  { id: "screenshot", name: "Screenshot Selection", keys: "⌘⇧ 4" },
  { id: "terminal", name: "Quick Terminal", keys: "⌘⌥ T" },
  { id: "window-left", name: "Window Snap Left", keys: "⌘⌥ ←" },
  { id: "window-right", name: "Window Snap Right", keys: "⌘⌥ →" },
  { id: "mission-control", name: "Mission Control", keys: "⌃ ↑" },
];

const APPS = [
  { id: "homebrew", name: "Homebrew", category: "Package Manager" },
  { id: "git", name: "Git", category: "Development" },
  { id: "vscode", name: "Visual Studio Code", category: "Development" },
  { id: "vim", name: "Vim", category: "Development" },
  { id: "firefox", name: "Firefox", category: "Browser" },
  { id: "rectangle", name: "Rectangle", category: "Productivity" },
  { id: "iterm2", name: "iTerm2", category: "Terminal" },
  { id: "alacritty", name: "Alacritty", category: "Terminal" },
];

export function SetupWizardStep({ config, setConfig }: SetupWizardStepProps) {
  const handleToggleItem = (
    type: "backgrounds" | "shortcuts" | "apps",
    id: string
  ) => {
    const current = config[type];
    const updated = current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id];
    setConfig({ ...config, [type]: updated });
  };

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Customize your Mac with popular configurations. You can skip this step
        and configure these later.
      </p>

      <Tabs className="w-full" defaultValue="apps">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="apps">
            <Package className="mr-2 h-4 w-4" />
            Apps
          </TabsTrigger>
          <TabsTrigger value="shortcuts">
            <Keyboard className="mr-2 h-4 w-4" />
            Shortcuts
          </TabsTrigger>
          <TabsTrigger value="wallpapers">
            <ImageIcon className="mr-2 h-4 w-4" />
            Wallpapers
          </TabsTrigger>
        </TabsList>

        <TabsContent className="mt-4" value="apps">
          <ScrollArea className="h-[400px] rounded-lg border p-4">
            <div className="space-y-1">
              {APPS.map((app) => (
                <div
                  className="flex items-center justify-between rounded-md p-3 hover:bg-accent"
                  key={app.id}
                >
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={config.apps.includes(app.id)}
                      id={app.id}
                      onCheckedChange={() => handleToggleItem("apps", app.id)}
                    />
                    <Label
                      className="flex cursor-pointer flex-col gap-0.5"
                      htmlFor={app.id}
                    >
                      <span className="font-medium">{app.name}</span>
                      <span className="text-muted-foreground text-xs">
                        {app.category}
                      </span>
                    </Label>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
          <p className="mt-2 text-muted-foreground text-xs">
            Selected {config.apps.length} of {APPS.length} apps
          </p>
        </TabsContent>

        <TabsContent className="mt-4" value="shortcuts">
          <ScrollArea className="h-[400px] rounded-lg border p-4">
            <div className="space-y-1">
              {SHORTCUTS.map((shortcut) => (
                <div
                  className="flex items-center justify-between rounded-md p-3 hover:bg-accent"
                  key={shortcut.id}
                >
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={config.shortcuts.includes(shortcut.id)}
                      id={shortcut.id}
                      onCheckedChange={() =>
                        handleToggleItem("shortcuts", shortcut.id)
                      }
                    />
                    <Label
                      className="cursor-pointer font-medium"
                      htmlFor={shortcut.id}
                    >
                      {shortcut.name}
                    </Label>
                  </div>
                  <span className="font-mono text-muted-foreground text-sm">
                    {shortcut.keys}
                  </span>
                </div>
              ))}
            </div>
          </ScrollArea>
          <p className="mt-2 text-muted-foreground text-xs">
            Selected {config.shortcuts.length} of {SHORTCUTS.length} shortcuts
          </p>
        </TabsContent>

        <TabsContent className="mt-4" value="wallpapers">
          <ScrollArea className="h-[400px] rounded-lg border p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {WALLPAPERS.map((wallpaper) => (
                <Card
                  className={`cursor-pointer transition-colors ${
                    config.backgrounds.includes(wallpaper.id)
                      ? "border-primary bg-primary/5"
                      : "hover:border-muted-foreground/50"
                  }`}
                  key={wallpaper.id}
                  onClick={() => handleToggleItem("backgrounds", wallpaper.id)}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-sm">
                          {wallpaper.name}
                        </CardTitle>
                        <CardDescription className="text-xs">
                          {wallpaper.category}
                        </CardDescription>
                      </div>
                      <Checkbox
                        checked={config.backgrounds.includes(wallpaper.id)}
                        onCheckedChange={() =>
                          handleToggleItem("backgrounds", wallpaper.id)
                        }
                      />
                    </div>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </ScrollArea>
          <p className="mt-2 text-muted-foreground text-xs">
            Selected {config.backgrounds.length} of {WALLPAPERS.length}{" "}
            wallpapers
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
