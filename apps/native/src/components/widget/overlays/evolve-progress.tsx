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
  ShieldAlert,
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
  // Rendered inside the question card it answers, not as its own row.
  "answered",
  // Streamed build_check output chunks: rendered as the active row's log tail
  // while the check runs, never as timeline rows.
  "buildCheck",
  // Streamed assistant-text slices: rendered as the active row's typewriter
  // tail while the model responds, never as timeline rows.
  "streamDelta",
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

function toolCallToolName(event: EvolveEvent): string {
  if (event.detail?.type === "toolCall") {
    return event.detail.tool;
  }
  // Fallback for events recorded before the structured detail existed.
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

/// Latest budget counters from the structured Progress detail carried by
/// provider responses.
export function getTokenProgress(
  events: EvolveEvent[],
): { total: number; budget: number } | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const detail = events[i].detail;
    if (detail?.type === "progress") {
      return { total: detail.tokens, budget: detail.budget };
    }
  }
  return null;
}

function formatTokenProgress(progress: { total: number; budget: number }): string {
  return `${progress.total.toLocaleString()} / ${progress.budget.toLocaleString()} tokens`;
}

// =============================================================================
// Active-Step Derivation
// =============================================================================

export type FocusMode = "working" | "waiting" | "needsYou";

export interface FocusState {
  mode: FocusMode;
  /** The event whose activity the active row narrates; the pending question
   * in `needsYou` mode, null when nothing has happened yet. */
  event: EvolveEvent | null;
  headline: string;
  /** Current narration/thinking text, shown quietly under the headline while
   * it is the latest activity; collapsed into its history row once
   * superseded. */
  detailText: string | null;
  /** Streamed build_check output tail; non-null while a check is running. */
  buildLog: string[] | null;
}

/// Ring-buffer cap on retained streamed build-log lines.
const BUILD_LOG_MAX_LINES = 500;

/// The streamed output of a build check that is running right now: the
/// buildOutput chunks trailing the event stream, split into lines. Null once
/// any other event follows (the check finished).
export function trailingBuildLog(events: EvolveEvent[]): string[] | null {
  const lines: string[] = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const detail = events[i].detail;
    if (detail?.type !== "buildOutput") break;
    lines.unshift(...detail.chunk.split("\n").filter((line) => line.length > 0));
  }
  if (lines.length === 0) return null;
  return lines.slice(-BUILD_LOG_MAX_LINES);
}

/// Display cap for the streamed-response tail shown in the active row: about
/// four quiet lines; the full text lands as a Narration row (or the terminal
/// summary) when the response completes.
const STREAM_TAIL_MAX_CHARS = 320;

/// The assistant text streaming in right now: the streamDelta chunks
/// trailing the event stream, joined and clipped to a display tail. Null
/// once any other event follows (the response completed).
export function trailingStreamText(events: EvolveEvent[]): string | null {
  const parts: string[] = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const detail = events[i].detail;
    if (detail?.type !== "streamDelta") break;
    parts.unshift(detail.text);
  }
  if (parts.length === 0) return null;
  const text = parts.join("");
  if (text.length <= STREAM_TAIL_MAX_CHARS) return text;
  // Slice by code points so the cut can't land inside a surrogate pair.
  return `…${[...text].slice(-STREAM_TAIL_MAX_CHARS).join("")}`;
}

/// The question the run is currently blocked on: the most recent question
/// event with no answered event after it.
export function getPendingQuestion(events: EvolveEvent[]): EvolveEvent | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.eventType === "answered") return null;
    if (e.eventType === "question") return e;
  }
  return null;
}

/// What the active row should show right now, derived from the event stream.
export function getFocusState(events: EvolveEvent[]): FocusState {
  const question = getPendingQuestion(events);
  if (question) {
    const text = question.detail?.type === "question" ? question.detail.text : question.summary;
    return { mode: "needsYou", event: question, headline: text, detailText: null, buildLog: null };
  }

  const visible = events.filter(isVisibleEvent);
  const current = visible[visible.length - 1] ?? null;

  // A build check streaming output right now: the headline is the visible
  // build_check tool call row, the detail area is the log tail.
  const buildLog = trailingBuildLog(events);
  if (buildLog) {
    return {
      mode: "working",
      event: current,
      headline: current?.summary ?? "Checking the configuration builds...",
      detailText: null,
      buildLog,
    };
  }

  // The model's response streaming in right now: rendered as its own active
  // row after the last completed action (event: null → the placeholder row),
  // with the accumulated tail typing in as quiet detail.
  const streamText = trailingStreamText(events);
  if (streamText) {
    return {
      mode: "working",
      event: null,
      headline: "Thinking...",
      detailText: streamText,
      buildLog: null,
    };
  }

  if (!current) {
    return { mode: "waiting", event: null, headline: "Working...", detailText: null, buildLog: null };
  }

  const detail = current.detail;
  const text =
    detail?.type === "narration" || detail?.type === "thinking" ? detail.text : null;
  // The summary is derived from the text; only show the text when it adds
  // something beyond the headline.
  const detailText = text && text !== current.summary ? text : null;
  return {
    mode: detailText ? "working" : "waiting",
    event: current,
    headline: current.summary,
    detailText,
    buildLog: null,
  };
}


// =============================================================================
// Event Icon Mapping
// =============================================================================

function getEventIcon(eventType: EvolveEventType) {
  const iconClassName = "h-4 w-4 shrink-0";

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
    // buildCheck events carry streamed output chunks and are hidden from the
    // timeline (they render as the active row's log tail); the icon is kept in
    // case a chunk ever surfaces through the fallback path.
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
    case "narration":
      return <MessageSquare className={iconClassName} />;
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
    case "narration":
      return "text-sky-300";
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

function EventItem({ event }: EventItemProps) {
  const [expanded, setExpanded] = useState(false);
  const hasRawContent = event.raw && event.raw !== event.summary && event.raw.length > 0;

  const content = (
    <>
      <div className="flex items-start gap-2">
        {/* Icon */}
        <div className={cn("mt-0.5", getEventColor(event.eventType))}>
          {getEventIcon(event.eventType)}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-muted-foreground text-sm">{event.summary}</span>
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
        className="group w-full cursor-pointer rounded-md border border-transparent px-2 py-1.5 text-left transition-all hover:bg-muted/30"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        {content}
      </button>
    );
  }

  return (
    <div className="group rounded-md border border-transparent px-2 py-1.5 transition-all">
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

/// The user's answer to `question`, taken from the Answered event that
/// follows it in the stream (before any subsequent question).
export function answeredTextFor(events: EvolveEvent[], question: EvolveEvent): string | null {
  const start = events.indexOf(question);
  if (start === -1) return null;
  for (let i = start + 1; i < events.length; i++) {
    const e = events[i];
    if (e.eventType === "question") return null;
    if (e.eventType === "answered") {
      return e.detail?.type === "answered" ? e.detail.text : e.summary;
    }
  }
  return null;
}

function QuestionPrompt({
  event,
  answeredText,
  onAnswer,
}: {
  event: EvolveEvent;
  answeredText: string | null;
  onAnswer: (answer: string) => void;
}) {
  const [input, setInput] = useState("");
  // Optimistic local state so the input locks immediately on submit; the
  // durable answered record is the Answered event (answeredText).
  const [submitted, setSubmitted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const detail = event.detail?.type === "question" ? event.detail : null;
  const choices = detail ? detail.choices : parseQuestionChoices(event.raw);
  const isCheckpoint = detail?.kind === "checkpoint";
  const questionText = detail?.text ?? event.summary;
  const answered = submitted || answeredText !== null;

  const palette = isCheckpoint
    ? {
        icon: <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />,
        border: "border-amber-500/30",
        borderAnswered: "border-amber-500/20",
        bg: "bg-amber-500/5",
        choice:
          "rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-sm text-amber-300 transition-colors hover:bg-amber-500/20",
        label: "Safety checkpoint",
      }
    : {
        icon: <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" />,
        border: "border-violet-500/30",
        borderAnswered: "border-violet-500/20",
        bg: "bg-violet-500/5",
        choice:
          "rounded-md border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-sm text-violet-300 transition-colors hover:bg-violet-500/20",
        label: null,
      };

  useEffect(() => {
    if (!answered) {
      inputRef.current?.focus();
    }
  }, [answered]);

  const handleSubmit = (value: string) => {
    if (!value.trim() || answered) return;
    setSubmitted(true);
    onAnswer(value.trim());
  };

  if (answered) {
    return (
      <div className={cn("mx-2 my-2 rounded-lg border p-3", palette.borderAnswered, palette.bg)}>
        <div className="flex items-start gap-2">
          {palette.icon}
          <div className="min-w-0 flex-1">
            <p className="text-sm text-foreground">{questionText}</p>
            <p className="mt-1 text-muted-foreground text-xs">
              Answered: {answeredText ?? input}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("mx-2 my-2 rounded-lg border p-3", palette.border, palette.bg)}>
      <div className="flex items-start gap-2">
        {palette.icon}
        <div className="min-w-0 flex-1">
          {!!palette.label && (
            <p className="mb-0.5 font-mono text-[10px] text-amber-400/80 uppercase tracking-wide">
              {palette.label}
            </p>
          )}
          <p className="font-medium text-foreground text-sm">{questionText}</p>

          {choices ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {choices.map((choice) => (
                <button
                  className={palette.choice}
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
// Active Row
// =============================================================================

/**
 * Streamed build-check output, monospace and tail-following: the newest
 * lines stay in view as chunks arrive.
 */
function BuildLogTail({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [lines]);

  return (
    <pre
      className="mt-1.5 ml-6 max-h-36 overflow-y-auto whitespace-pre-wrap break-all rounded border border-border/40 bg-black/30 p-2 font-mono text-[11px] text-muted-foreground/80"
      data-testid="evolve-build-log"
      ref={ref}
    >
      {lines.join("\n")}
    </pre>
  );
}

/**
 * The timeline's last row while the run is live: the current activity as one
 * visually dominant row — spinner, highlight, per-step timer — with the
 * current narration/thinking or streamed build output as quiet expanded
 * detail that collapses into a plain row once the next event supersedes it.
 * The row is sticky at the container's bottom edge, so the current step
 * stays in view even when the user scrolls up through history.
 */
function ActiveRow({
  focus,
  answeredText,
  waitingMs,
  onAnswer,
}: {
  focus: FocusState;
  answeredText: string | null;
  waitingMs: number;
  onAnswer: (answer: string) => void;
}) {
  if (focus.event?.eventType === "question") {
    const pending = focus.mode === "needsYou";
    // While blocked on the user the agent is genuinely idle, so no spinner
    // and the timer relabels so idle time doesn't read as agent slowness.
    // Right after the answer (before the next event) the loop is working
    // again, so the status line flips back.
    return (
      <div
        aria-live={pending ? "assertive" : "polite"}
        className="sticky bottom-0 z-10 rounded-lg bg-background"
        data-testid="evolve-active-row"
      >
        <QuestionPrompt answeredText={answeredText} event={focus.event} onAnswer={onAnswer} />
        <div className="flex items-center gap-2 px-4 pb-2 text-muted-foreground/60">
          {pending ? (
            <HelpCircle className="h-3 w-3 shrink-0" />
          ) : (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
          )}
          <span className="font-mono text-xs">
            {pending ? "Waiting for you..." : "Working..."} {formatTime(waitingMs)}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="sticky bottom-0 z-10 rounded-md border border-primary/30 bg-background px-2 py-1.5"
      data-testid="evolve-active-row"
    >
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
        <span
          aria-live="polite"
          className="min-w-0 flex-1 truncate font-medium text-foreground text-sm"
        >
          {focus.headline}
        </span>
        <span className="whitespace-nowrap font-mono text-muted-foreground/60 text-xs">
          {formatTime(waitingMs)}
        </span>
      </div>
      {!!focus.detailText && (
        <p className="mt-1.5 ml-6 line-clamp-4 whitespace-pre-line border-border/50 border-l-2 pl-2 text-muted-foreground/80 text-xs">
          {focus.detailText}
        </p>
      )}
      {!!focus.buildLog && <BuildLogTail lines={focus.buildLog} />}
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

  // While generating, the latest visible event renders as the sticky active
  // row narrating the current step; once the run ends every row is plain
  // history.
  const focus = isGenerating ? getFocusState(events) : null;
  const needsYou = focus?.mode === "needsYou";

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
          {needsYou ? (
            <HelpCircle className="h-4 w-4 text-violet-400" />
          ) : isGenerating ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          ) : (
            <Check className="h-4 w-4 text-green-400" />
          )}
          <span className="font-medium text-foreground text-sm">
            {needsYou
              ? "Waiting for your input..."
              : isAnalyzing
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

      {/* Timeline: completed actions as compact rows, the current step as
          the sticky active row at the end. Fills whatever height the parent
          gives the component (the overlay panel stretches it to the card
          height); without an explicit parent height it hugs its content. */}
      <div
        className="min-h-[80px] flex-1 overflow-y-auto p-2"
        onScroll={handleScroll}
        ref={scrollRef}
      >
        <div className="space-y-1">
          {visibleEvents.map((event, index) => {
            if (focus && event === focus.event) {
              return (
                <ActiveRow
                  answeredText={
                    event.eventType === "question" ? answeredTextFor(events, event) : null
                  }
                  focus={focus}
                  key={`${event.timestampMs}-${index}`}
                  onAnswer={handleQuestionAnswer}
                  waitingMs={waitingMs}
                />
              );
            }
            if (event.eventType === "question") {
              return (
                <QuestionPrompt
                  answeredText={answeredTextFor(events, event)}
                  event={event}
                  key={`${event.timestampMs}-${index}`}
                  onAnswer={handleQuestionAnswer}
                />
              );
            }
            return <EventItem event={event} key={`${event.timestampMs}-${index}`} />;
          })}

          {/* Placeholder active row before the first visible event. */}
          {!!focus && !focus.event && (
            <ActiveRow
              answeredText={null}
              focus={focus}
              onAnswer={handleQuestionAnswer}
              waitingMs={waitingMs}
            />
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
