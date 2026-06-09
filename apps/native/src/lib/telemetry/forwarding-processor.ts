import type { Context } from "@opentelemetry/api";
import type {
  ReadableSpan,
  Span,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-web";
import { invoke } from "@tauri-apps/api/core";

interface SerializedSpan {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  startTimeUnixNano: number;
  endTimeUnixNano: number;
  attributes: Record<string, unknown>;
  statusCode?: number;
  statusMessage?: string;
}

// ReadableSpan.startTime/endTime are HrTime — a [seconds, nanoseconds] tuple.
const hrTimeToUnixNano = (time: [number, number]): number =>
  time[0] * 1e9 + time[1];

function serializeSpan(span: ReadableSpan): SerializedSpan {
  return {
    name: span.name,
    traceId: span.spanContext().traceId,
    spanId: span.spanContext().spanId,
    parentSpanId: span.parentSpanContext?.spanId,
    startTimeUnixNano: hrTimeToUnixNano(span.startTime),
    endTimeUnixNano: hrTimeToUnixNano(span.endTime),
    attributes: span.attributes,
    statusCode: span.status.code,
    statusMessage: span.status.message,
  };
}

/**
 * SpanProcessor that forwards completed spans to the Rust backend over Tauri
 * IPC. The Rust bridge currently scrubs and logs forwarded spans; full
 * reconstruction into the Rust-owned OTEL exporter is a follow-up.
 *
 * Forwarding is fire-and-forget: IPC failures must never throw inside the span
 * processor, so onEnd swallows rejections with a warning.
 */
export class ForwardingSpanProcessor implements SpanProcessor {
  onStart(_span: Span, _parentContext: Context): void {}

  onEnd(span: ReadableSpan): void {
    const serialized = serializeSpan(span);
    invoke("otel_forward_span", { span: serialized }).catch((error) => {
      // Fire-and-forget: IPC failures must not throw in the span processor.
      console.warn("Failed to forward span to Rust backend:", error);
    });
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
