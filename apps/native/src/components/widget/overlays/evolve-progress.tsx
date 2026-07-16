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
import { Fragment, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
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
// Focus / History Derivation
// =============================================================================

export type FocusMode = "working" | "waiting" | "needsYou";

export interface FocusState {
  mode: FocusMode;
  /** The event whose activity the focus zone narrates; the pending question
   * in `needsYou` mode, null when nothing has happened yet. */
  event: EvolveEvent | null;
  headline: string;
  /** Current narration/thinking text, shown quietly under the headline while
   * it is the latest activity; collapsed into its history row once
   * superseded. */
  detailText: string | null;
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

/// What the focus zone should show right now, derived from the event stream.
export function getFocusState(events: EvolveEvent[]): FocusState {
  const question = getPendingQuestion(events);
  if (question) {
    const text = question.detail?.type === "question" ? question.detail.text : question.summary;
    return { mode: "needsYou", event: question, headline: text, detailText: null };
  }

  const visible = events.filter(isVisibleEvent);
  const current = visible[visible.length - 1] ?? null;
  if (!current) {
    return { mode: "waiting", event: null, headline: "Working...", detailText: null };
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
  };
}

export interface AttemptGroup {
  /** Build attempt number for groups closed by a failed build; null for the
   * trailing (current) group. */
  attempt: number | null;
  /** The failed build's summary; null for the trailing group. */
  failure: string | null;
  events: EvolveEvent[];
}

/// Split history rows into build attempts: each failed build closes a group
/// (rendered collapsed under an "Attempt N failed" header), and whatever
/// follows the last failure is the current attempt.
export function groupByAttempt(events: EvolveEvent[]): AttemptGroup[] {
  const groups: AttemptGroup[] = [];
  let bucket: EvolveEvent[] = [];
  for (const e of events) {
    bucket.push(e);
    if (e.eventType === "buildFail") {
      const attempt =
        e.detail?.type === "build" ? e.detail.attempt : groups.length + 1;
      groups.push({ attempt, failure: e.summary, events: bucket });
      bucket = [];
    }
  }
  groups.push({ attempt: null, failure: null, events: bucket });
  return groups;
}

/// Header copy for a failed attempt group; strips the summary's redundant
/// "Build check failed" prefix since the header already says "failed".
export function attemptFailureReason(failure: string): string {
  return failure.replace(/^Build check failed[:,]?\s*/, "") || "build check failed";
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
// Attempt Group
// =============================================================================

/**
 * A failed build attempt in the history zone: collapsed to a single header
 * row by default (§7 decision — group history by build attempt), expandable
 * to the steps that led to the failure.
 */
function AttemptGroupSection({
  group,
  children,
}: {
  group: AttemptGroup;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <button
        className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/30"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <ChevronDown
          className={cn(
            "h-3 w-3 shrink-0 text-muted-foreground/40 transition-transform",
            !expanded && "-rotate-90",
          )}
        />
        <XCircle className="h-4 w-4 shrink-0 text-red-400" />
        <span className="min-w-0 flex-1 truncate text-muted-foreground text-sm">
          Attempt {group.attempt} failed: {group.failure ? attemptFailureReason(group.failure) : ""}
        </span>
        <span className="whitespace-nowrap text-muted-foreground/50 text-xs">
          {group.events.length} {group.events.length === 1 ? "step" : "steps"}
        </span>
      </button>
      {!!expanded && (
        <div className="ml-3 space-y-1 border-border/40 border-l pl-1">{children}</div>
      )}
    </div>
  );
}

// =============================================================================
// Focus Zone
// =============================================================================

/**
 * The visually dominant bottom zone narrating the current activity:
 * a headline plus quiet narration detail while working, timer-only while
 * waiting on the provider, and the question card when the run blocks on the
 * user (design §4.1).
 */
function FocusZone({
  focus,
  waitingMs,
  onAnswer,
}: {
  focus: FocusState;
  waitingMs: number;
  onAnswer: (answer: string) => void;
}) {
  if (focus.mode === "needsYou" && focus.event) {
    // The agent is genuinely idle while blocked on the user, so no spinner;
    // the timer relabels so idle time doesn't read as agent slowness.
    return (
      <div
        aria-live="assertive"
        className="border-border/50 border-t bg-muted/10"
        data-testid="evolve-focus-zone"
      >
        <QuestionPrompt answeredText={null} event={focus.event} onAnswer={onAnswer} />
        <div className="flex items-center gap-2 px-4 pb-2 text-muted-foreground/60">
          <HelpCircle className="h-3 w-3 shrink-0" />
          <span className="font-mono text-xs">Waiting for you... {formatTime(waitingMs)}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="border-border/50 border-t bg-muted/10 px-3 py-2.5"
      data-testid="evolve-focus-zone"
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
        <p className="mt-1.5 ml-6 line-clamp-4 border-border/50 border-l-2 pl-2 text-muted-foreground/80 text-xs">
          {focus.detailText}
        </p>
      )}
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

  // While generating, the latest activity lives in the focus zone and the
  // history zone holds only completed actions; once the run ends everything
  // is history.
  const focus = isGenerating ? getFocusState(events) : null;
  const historyEvents = focus?.event
    ? visibleEvents.filter((e) => e !== focus.event)
    : visibleEvents;
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

      {/* History zone: compact completed actions. Fills whatever height the
          parent gives the component (the overlay panel stretches it to the
          card height); without an explicit parent height it hugs its
          content. */}
      <div
        className="min-h-[80px] flex-1 overflow-y-auto p-2"
        onScroll={handleScroll}
        ref={scrollRef}
      >
        <div className="space-y-1">
          {groupByAttempt(historyEvents).map((group, groupIndex) => {
            const rows = group.events.map((event, index) => {
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
            });
            // The trailing group is the current attempt: rendered flat,
            // never collapsed. Failed attempts collapse under a header.
            if (group.failure === null) {
              return <Fragment key={`attempt-${groupIndex}`}>{rows}</Fragment>;
            }
            return (
              <AttemptGroupSection group={group} key={`attempt-${groupIndex}`}>
                {rows}
              </AttemptGroupSection>
            );
          })}
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

      {/* Focus zone: the current activity, pinned below the history. */}
      {!!focus && (
        <FocusZone focus={focus} onAnswer={handleQuestionAnswer} waitingMs={waitingMs} />
      )}
    </div>
  );
}
