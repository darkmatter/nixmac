"use client";

import {
  Brain,
  Check,
  CheckCircle,
  ChevronDown,
  CircleDot,
  Code,
  FileEdit,
  FileSearch,
  FileText,
  HelpCircle,
  Hammer,
  Loader2,
  MessageSquare,
  PackageSearch,
  Play,
  Repeat,
  Send,
  Square,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { client } from "@/lib/orpc";
import type { EvolveEvent, EvolveEventType } from "@/ipc/types";

// =============================================================================
// Types
// =============================================================================

interface EvolveProgressProps {
  events: EvolveEvent[];
  isGenerating: boolean;
  className?: string;
  onStop?: () => void;
}

interface EventItemProps {
  event: EvolveEvent;
  isLatest: boolean;
}

// =============================================================================
// Timeline Curation
// =============================================================================

// Loop machinery: kept in the store (and mirrored to the Console via `raw`)
// but never shown as timeline rows — they narrate the agent loop, not
// progress toward the user's goal.
const HIDDEN_EVENT_TYPES: ReadonlySet<EvolveEventType> = new Set([
  "iteration",
  "apiRequest",
  "apiResponse",
]);

// Tools whose execution is fast and immediately followed by a more specific
// event narrating the same action (thinking/reading/editing/question), which
// would otherwise appear as a duplicate row. Slow tools (build_check, the
// searches) keep their toolCall row: it is the only in-progress indicator
// while they run.
const TOOLS_WITH_SPECIFIC_EVENT: ReadonlySet<string> = new Set([
  "think",
  "read_file",
  "edit_file",
  "edit_nix_file",
  "ensure_secret",
  "ask_user",
  "done",
]);

// Until the event payload carries structured detail, the tool name is only
// available as the `{tool} | args: ...` prefix of the raw detail.
function toolCallToolName(event: EvolveEvent): string {
  return event.raw.split(" | ")[0] ?? "";
}

export function isVisibleEvent(event: EvolveEvent): boolean {
  if (HIDDEN_EVENT_TYPES.has(event.eventType)) {
    return false;
  }
  if (event.eventType === "toolCall") {
    return !TOOLS_WITH_SPECIFIC_EVENT.has(toolCallToolName(event));
  }
  return true;
}

function parseTokenCount(value: string): number {
  return Number.parseInt(value.replace(/,/g, ""), 10);
}

function getTokenProgress(events: EvolveEvent[]): { total: number; budget: number | null } | null {
  let total = 0;
  let budget: number | null = null;
  let sawTokenEvent = false;

  for (const event of events) {
    if (event.eventType !== "apiResponse") {
      continue;
    }

    const totalMatch = event.raw.match(/total tokens:\s*([\d,]+)\s*\/\s*([\d,]+)/i);
    if (totalMatch) {
      total = parseTokenCount(totalMatch[1]);
      budget = parseTokenCount(totalMatch[2]);
      sawTokenEvent = true;
      continue;
    }

    const tokenMatch = event.raw.match(/tokens used:\s*([\d,]+)/i);
    if (tokenMatch) {
      total += parseTokenCount(tokenMatch[1]);
      sawTokenEvent = true;
    }
  }

  return sawTokenEvent ? { total, budget } : null;
}

function formatTokenProgress(progress: { total: number; budget: number | null }): string {
  const total = progress.total.toLocaleString();
  if (progress.budget === null) {
    return `${total} tokens`;
  }
  return `${total} / ${progress.budget.toLocaleString()} tokens`;
}

// =============================================================================
// Event Icon Mapping
// =============================================================================

function getEventIcon(eventType: EvolveEventType, isLatest: boolean) {
  const iconClassName = cn("h-4 w-4 shrink-0", isLatest && "animate-pulse");

  switch (eventType) {
    case "start":
      return <Play className={iconClassName} />;
    case "iteration":
      return <Repeat className={iconClassName} />;
    case "thinking":
      return <Brain className={iconClassName} />;
    case "reading":
      return <FileSearch className={iconClassName} />;
    case "editing":
      return <FileEdit className={iconClassName} />;
    // buildCheck is declared in the event enum but currently never emitted
    // by the backend (it emits buildPass/buildFail instead).
    case "buildCheck":
      return <Hammer className={iconClassName} />;
    case "searchPackages":
      return <PackageSearch className={iconClassName} />;
    case "buildPass":
      return <CheckCircle className={cn(iconClassName, "text-green-400")} />;
    case "buildFail":
      return <XCircle className={cn(iconClassName, "text-red-400")} />;
    case "toolCall":
      return <Code className={iconClassName} />;
    case "apiRequest":
      return <Send className={iconClassName} />;
    case "apiResponse":
      return <MessageSquare className={iconClassName} />;
    case "complete":
      return <CheckCircle className={cn(iconClassName, "text-green-400")} />;
    case "error":
      return <XCircle className={cn(iconClassName, "text-red-400")} />;
    case "summarizing":
      return <FileText className={iconClassName} />;
    case "question":
      return <HelpCircle className={iconClassName} />;
    default:
      return <CircleDot className={iconClassName} />;
  }
}

function getEventColor(eventType: EvolveEventType): string {
  switch (eventType) {
    case "start":
      return "text-blue-400";
    case "iteration":
      return "text-purple-400";
    case "thinking":
      return "text-yellow-400";
    case "reading":
      return "text-cyan-400";
    case "editing":
      return "text-orange-400";
    case "buildCheck":
      return "text-amber-400";
    case "searchPackages":
      return "text-teal-400";
    case "buildPass":
      return "text-green-400";
    case "buildFail":
      return "text-red-400";
    case "toolCall":
      return "text-indigo-400";
    case "apiRequest":
      return "text-sky-400";
    case "apiResponse":
      return "text-emerald-400";
    case "complete":
      return "text-green-400";
    case "error":
      return "text-red-400";
    case "summarizing":
      return "text-pink-400";
    case "question":
      return "text-violet-400";
    default:
      return "text-muted-foreground";
  }
}

// =============================================================================
// Event Item Component
// =============================================================================

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function EventItem({ event, isLatest }: EventItemProps) {
  const [expanded, setExpanded] = useState(false);
  const hasRawContent = event.raw && event.raw !== event.summary && event.raw.length > 0;

  const content = (
    <>
      <div className="flex items-start gap-2">
        {/* Icon */}
        <div className={cn("mt-0.5", getEventColor(event.eventType))}>
          {isLatest && event.eventType !== "complete" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            getEventIcon(event.eventType, isLatest)
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span
              className={cn(
                "truncate text-sm",
                isLatest ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {event.summary}
            </span>
            <div className="flex items-center gap-1">
              <span className="whitespace-nowrap font-mono text-muted-foreground/60 text-xs">
                {formatTime(event.timestampMs)}
              </span>
              {!!hasRawContent && (
                <ChevronDown
                  className={cn(
                    "h-3 w-3 text-muted-foreground/40 transition-transform",
                    !!expanded && "rotate-180",
                  )}
                />
              )}
            </div>
          </div>

        </div>
      </div>

      {/* Expanded raw content */}
      {!!(expanded && hasRawContent) && (
        <div className="mt-2 rounded border border-border/50 bg-black/30 p-2">
          <pre className="whitespace-pre-wrap font-mono text-[11px] text-muted-foreground/80">
            {event.raw}
          </pre>
        </div>
      )}
    </>
  );

  if (hasRawContent) {
    return (
      <button
        className={cn(
          "group w-full rounded-md border border-transparent px-2 py-1.5 text-left transition-all",
          !!isLatest && "border-primary/30 bg-primary/5",
          "cursor-pointer hover:bg-muted/30",
        )}
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className={cn(
        "group rounded-md border border-transparent px-2 py-1.5 transition-all",
        !!isLatest && "border-primary/30 bg-primary/5",
      )}
    >
      {content}
    </div>
  );
}

// =============================================================================
// Question Prompt Component
// =============================================================================

function parseQuestionChoices(raw: string): string[] | null {
  const jsonMatch = raw.match(/\nChoicesJson: (.+)\nChoices: /);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (Array.isArray(parsed) && parsed.every((choice) => typeof choice === "string")) {
        return parsed;
      }
    } catch {
      // Fall back to the legacy comma-separated format below.
    }
  }

  const match = raw.match(/\nChoices: (.+)$/);
  if (!match) return null;
  return match[1].split(", ").filter(Boolean);
}

function QuestionPrompt({
  event,
  onAnswer,
}: {
  event: EvolveEvent;
  onAnswer: (answer: string) => void;
}) {
  const [input, setInput] = useState("");
  const [answered, setAnswered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const choices = parseQuestionChoices(event.raw);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (value: string) => {
    if (!value.trim() || answered) return;
    setAnswered(true);
    onAnswer(value.trim());
  };

  if (answered) {
    return (
      <div className="mx-2 my-2 rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
        <div className="flex items-start gap-2">
          <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-foreground">{event.summary}</p>
            <p className="mt-1 text-muted-foreground text-xs">Answered: {input}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-2 my-2 rounded-lg border border-violet-500/30 bg-violet-500/5 p-3">
      <div className="flex items-start gap-2">
        <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground text-sm">{event.summary}</p>

          {choices ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {choices.map((choice) => (
                <button
                  className="rounded-md border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-sm text-violet-300 transition-colors hover:bg-violet-500/20"
                  key={choice}
                  onClick={() => {
                    setInput(choice);
                    handleSubmit(choice);
                  }}
                  type="button"
                >
                  {choice}
                </button>
              ))}
            </div>
          ) : (
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                handleSubmit(input);
              }}
            >
              <input
                className="min-w-0 flex-1 rounded-md border border-violet-500/30 bg-black/30 px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-violet-500/50 focus:outline-none"
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type your answer..."
                ref={inputRef}
                type="text"
                value={input}
                data-testid="question-prompt-input"
              />
              <button
                className="rounded-md bg-violet-500/20 px-3 py-1.5 text-sm text-violet-300 transition-colors hover:bg-violet-500/30 disabled:opacity-50"
                disabled={!input.trim()}
                type="submit"
                data-testid="question-prompt-submit"
              >
                Send
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function EvolveProgress({ events, isGenerating, className, onStop }: EvolveProgressProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const prevEventsLengthRef = useRef(events.length);

  const handleQuestionAnswer = (answer: string) => {
    client.darwin.evolveAnswer({ answer }).catch((e) => {
      console.error("Failed to send answer:", e);
    });
  };

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    const hasNewEvents = events.length > prevEventsLengthRef.current;
    prevEventsLengthRef.current = events.length;

    if (autoScroll && hasNewEvents && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [autoScroll, events.length]);

  // Detect manual scroll to disable auto-scroll
  const handleScroll = () => {
    if (!scrollRef.current) {
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  };

  const isAnalyzing = isGenerating && events[events.length - 1]?.eventType === "summarizing";
  const tokenProgress = getTokenProgress(events);
  const visibleEvents = events.filter(isVisibleEvent);

  // Live clock: something must visibly change during long waits (model
  // calls, builds), so the header elapsed time and the working indicator
  // tick every second while generating.
  //
  // The arrival time must live in state set from an effect, not a
  // `useMemo(() => Date.now(), ...)`: the React Compiler does not preserve
  // manual memoization of impure computations and recompiles it to run on
  // every render, which pins `waitingMs` at ~0 and freezes the clock.
  const [lastEventReceivedAt, setLastEventReceivedAt] = useState(() => Date.now());
  useEffect(() => {
    setLastEventReceivedAt(Date.now());
  }, [events.length]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isGenerating) {
      return;
    }
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isGenerating]);

  const lastEvent = events[events.length - 1];
  const waitingMs = Math.max(0, now - lastEventReceivedAt);
  // Run elapsed = the last event's elapsed-since-start stamp, plus the time
  // we've been waiting on the next one.
  const elapsedMs = lastEvent ? lastEvent.timestampMs + (isGenerating ? waitingMs : 0) : null;

  if (events.length === 0 && !isGenerating) {
    return null;
  }

  return (
    <div className={cn("flex flex-col", className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-border/50 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          {isGenerating ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          ) : (
            <Check className="h-4 w-4 text-green-400" />
          )}
          <span className="font-medium text-foreground text-sm">
            {isAnalyzing
              ? "Analyzing changes..."
              : isGenerating
                ? "Evolving..."
                : "Evolution Complete"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {elapsedMs !== null && (
            <span className="font-mono text-muted-foreground text-xs">
              {formatTime(elapsedMs)}
            </span>
          )}
          {tokenProgress && (
            <span className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-muted-foreground text-xs">
              {formatTokenProgress(tokenProgress)}
            </span>
          )}
          {isGenerating && onStop && (
            <button
              className="flex items-center gap-1 rounded-md bg-red-500/20 px-2 py-1 text-red-400 text-xs transition-colors hover:bg-red-500/30"
              onClick={onStop}
              type="button"
            >
              <Square className="h-3 w-3 fill-current" />
              Stop
            </button>
          )}
        </div>
      </div>

      {/* Events List: fills whatever height the parent gives the component
          (the overlay panel stretches it to the card height); without an
          explicit parent height it hugs its content. */}
      <div
        className="min-h-[120px] flex-1 overflow-y-auto p-2"
        onScroll={handleScroll}
        ref={scrollRef}
      >
        <div className="space-y-1">
          {visibleEvents.map((event, index) => {
            if (event.eventType === "question") {
              return (
                <QuestionPrompt
                  event={event}
                  key={`${event.timestampMs}-${index}`}
                  onAnswer={handleQuestionAnswer}
                />
              );
            }
            return (
              <EventItem
                event={event}
                isLatest={!!(isGenerating && index === visibleEvents.length - 1)}
                key={`${event.timestampMs}-${index}`}
              />
            );
          })}

          {/* Working indicator; shows how long the current step has been
              running once the wait is noticeable. */}
          {!!isGenerating && (
            <div className="flex items-center gap-2 px-2 py-1.5 text-muted-foreground/60">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span className="text-xs">
                Working...
                {waitingMs >= 5000 ? ` ${formatTime(waitingMs)}` : ""}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Auto-scroll indicator */}
      {!autoScroll && (
        <button
          className="flex items-center justify-center gap-1 border-border/50 border-t py-1.5 text-muted-foreground text-xs hover:bg-muted/30 hover:text-foreground"
          onClick={() => {
            setAutoScroll(true);
            if (scrollRef.current) {
              scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }
          }}
          type="button"
        >
          <ChevronDown className="h-3 w-3" />
          Jump to latest
        </button>
      )}
    </div>
  );
}
