"use client";

import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ConsoleEntry {
  id: string;
  type: "command" | "output" | "error" | "success" | "warning";
  content: string;
  timestamp: Date;
}

export function Console() {
  const [entries, setEntries] = useState<ConsoleEntry[]>([
    {
      id: "1",
      type: "success",
      content: "nixmac console initialized",
      timestamp: new Date(),
    },
    {
      id: "2",
      type: "output",
      content: 'Type "help" for available commands',
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  const executeCommand = (command: string) => {
    const trimmedCommand = command.trim();
    if (!trimmedCommand) return;

    // Add command to history
    setHistory((prev) => [...prev, trimmedCommand]);
    setHistoryIndex(-1);

    // Add command entry
    const commandEntry: ConsoleEntry = {
      id: Date.now().toString(),
      type: "command",
      content: trimmedCommand,
      timestamp: new Date(),
    };

    setEntries((prev) => [...prev, commandEntry]);

    // Simulate command execution
    setTimeout(() => {
      const response = processCommand(trimmedCommand);
      setEntries((prev) => [...prev, response]);
    }, 100);

    setInput("");
  };

  const processCommand = (command: string): ConsoleEntry => {
    const parts = command.toLowerCase().split(" ");
    const cmd = parts[0];

    switch (cmd) {
      case "help":
        return {
          id: Date.now().toString(),
          type: "output",
          content: `Available commands:
  help           Show this help message
  status         Show system status
  apply          Apply system configuration
  rebuild        Rebuild system configuration
  rollback       Rollback to previous generation
  generations    List system generations
  search <pkg>   Search for packages
  clear          Clear console`,
          timestamp: new Date(),
        };
      case "status":
        return {
          id: Date.now().toString(),
          type: "success",
          content: `System Status:
  Generation: 42
  Configuration: /etc/nixmac/configuration.nix
  Last updated: ${new Date().toLocaleString()}
  Status: ✓ All services running`,
          timestamp: new Date(),
        };
      case "apply":
        return {
          id: Date.now().toString(),
          type: "success",
          content:
            "✓ Configuration applied successfully\nBuilding system generation 43...\nActivating generation 43...\nDone.",
          timestamp: new Date(),
        };
      case "rebuild":
        return {
          id: Date.now().toString(),
          type: "success",
          content: "✓ System rebuilt successfully\nGeneration 43 created",
          timestamp: new Date(),
        };
      case "rollback":
        return {
          id: Date.now().toString(),
          type: "success",
          content: "✓ Rolled back to generation 41",
          timestamp: new Date(),
        };
      case "generations":
        return {
          id: Date.now().toString(),
          type: "output",
          content: `System Generations:
  43 (current) - 2025-01-15 14:23:45
  42           - 2025-01-14 09:15:22
  41           - 2025-01-13 16:42:11
  40           - 2025-01-12 11:08:33`,
          timestamp: new Date(),
        };
      case "search": {
        const query = parts.slice(1).join(" ");
        return {
          id: Date.now().toString(),
          type: "output",
          content: query
            ? `Searching for "${query}"...\n  • ${query}-cli - Command line interface\n  • ${query}-tools - Additional tools\n  • lib${query} - Library package`
            : "Usage: search <package-name>",
          timestamp: new Date(),
        };
      }
      case "clear":
        setEntries([]);
        return {
          id: Date.now().toString(),
          type: "output",
          content: "",
          timestamp: new Date(),
        };
      default:
        return {
          id: Date.now().toString(),
          type: "error",
          content: `Command not found: ${cmd}\nType "help" for available commands`,
          timestamp: new Date(),
        };
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      executeCommand(input);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length > 0) {
        const newIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(newIndex);
        setInput(history[newIndex]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex !== -1) {
        const newIndex = historyIndex + 1;
        if (newIndex >= history.length) {
          setHistoryIndex(-1);
          setInput("");
        } else {
          setHistoryIndex(newIndex);
          setInput(history[newIndex]);
        }
      }
    }
  };

  const clearConsole = () => {
    setEntries([]);
  };

  return (
    <Card className="overflow-hidden border-console-border bg-card">
      <div className="flex items-center justify-between border-console-border border-b bg-secondary/50 px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="size-3 rounded-full bg-destructive/80" />
            <div className="size-3 rounded-full bg-console-warning/80" />
            <div className="size-3 rounded-full bg-console-success/80" />
          </div>
          <span className="ml-2 font-mono text-muted-foreground text-sm">nixmac console</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            className="h-7 font-mono text-xs hover:bg-secondary"
            onClick={clearConsole}
            size="sm"
            variant="ghost"
          >
            Clear
          </Button>
        </div>
      </div>

      <div className="bg-console-bg">
        <ScrollArea className="h-[500px]" ref={scrollRef}>
          <div className="space-y-1 p-4 font-mono text-sm">
            {entries.map((entry) => (
              <ConsoleEntry entry={entry} key={entry.id} />
            ))}

            <div className="flex items-start gap-2 pt-2">
              <span className="select-none text-console-prompt">❯</span>
              <input
                autoFocus
                className="flex-1 bg-transparent text-console-output caret-console-prompt outline-none"
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Enter command..."
                ref={inputRef}
                type="text"
                value={input}
              />
            </div>
          </div>
        </ScrollArea>
      </div>

      <div className="flex items-center justify-between border-console-border border-t bg-secondary/50 px-4 py-2 font-mono text-muted-foreground text-xs">
        <span>Press ↑/↓ for command history</span>
        <span>{entries.length} entries</span>
      </div>
    </Card>
  );
}

function ConsoleEntry({ entry }: { entry: ConsoleEntry }) {
  const getTextColor = () => {
    switch (entry.type) {
      case "command":
        return "text-foreground";
      case "output":
        return "text-console-output";
      case "error":
        return "text-console-error";
      case "success":
        return "text-console-success";
      case "warning":
        return "text-console-warning";
      default:
        return "text-console-output";
    }
  };

  const getPrefix = () => {
    switch (entry.type) {
      case "command":
        return <span className="select-none text-console-prompt">❯</span>;
      case "error":
        return <span className="select-none text-console-error">✗</span>;
      case "success":
        return <span className="select-none text-console-success">✓</span>;
      case "warning":
        return <span className="select-none text-console-warning">⚠</span>;
      default:
        return null;
    }
  };

  return (
    <div className="flex items-start gap-2">
      {getPrefix()}
      <pre className={`${getTextColor()} flex-1 whitespace-pre-wrap break-all`}>
        {entry.content}
      </pre>
    </div>
  );
}
