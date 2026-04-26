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
  Play,
  Repeat,
  Send,
  Square,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { darwinAPI } from "@/tauri-api";
import type { EvolveEvent, EvolveEventType } from "@/stores/widget-store";

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
// Event Icon Mapping
// =============================================================================

function getEventIcon(eventType: EvolveEventType, isLatest: boolean) {
  const iconClassName = cn(
    "h-4 w-4 flex-shrink-0",
    isLatest && "animate-pulse",
  );

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
    case "buildCheck":
      return <Hammer className={iconClassName} />;
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

function EventItem({ event, isLatest }: EventItemProps) {
  const [expanded, setExpanded] = useState(false);
  const hasRawContent =
    event.raw && event.raw !== event.summary && event.raw.length > 0;

  const formatTime = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

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
                isLatest
                  ? "font-medium text-foreground"
                  : "text-muted-foreground",
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

          {/* Iteration badge */}
          {!!event.iteration && (
            <span className="mt-0.5 inline-block rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              iter {event.iteration}
            </span>
          )}
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

  const handleSubmit = useCallback(
    (value: string) => {
      if (!value.trim() || answered) return;
      setAnswered(true);
      onAnswer(value.trim());
    },
    [answered, onAnswer],
  );

  if (answered) {
    return (
      <div className="mx-2 my-2 rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
        <div className="flex items-start gap-2">
          <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-foreground">{event.summary}</p>
            <p className="mt-1 text-muted-foreground text-xs">
              Answered: {input}
            </p>
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
                data-testid="question-prompt-input"
                type="text"
                value={input}
              />
              <button
                className="rounded-md bg-violet-500/20 px-3 py-1.5 text-sm text-violet-300 transition-colors hover:bg-violet-500/30 disabled:opacity-50"
                disabled={!input.trim()}
                data-testid="question-prompt-submit"
                type="submit"
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

export function EvolveProgress({
  events,
  isGenerating,
  className,
  onStop,
}: EvolveProgressProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const prevEventsLengthRef = useRef(events.length);

  const handleQuestionAnswer = useCallback((answer: string) => {
    darwinAPI.darwin.evolveAnswer(answer).catch((e) => {
      console.error("Failed to send answer:", e);
    });
  }, []);

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
            {isAnalyzing ? "Analyzing changes..." : isGenerating ? "Evolving..." : "Evolution Complete"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">
            {events.length} event{events.length !== 1 ? "s" : ""}
          </span>
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

      {/* Events List */}
      <div
        className="max-h-100 min-h-[120px] flex-1 overflow-y-auto p-2"
        onScroll={handleScroll}
        ref={scrollRef}
      >
        <div className="space-y-1">
          {events.map((event, index) => {
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
                isLatest={!!(isGenerating && index === events.length - 1)}
                key={`${event.timestampMs}-${index}`}
              />
            );
          })}

          {/* Loading indicator for next event */}
          {!!isGenerating && (
            <div className="flex items-center gap-2 px-2 py-1.5 text-muted-foreground/60">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span className="text-xs">Waiting for next event...</span>
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
