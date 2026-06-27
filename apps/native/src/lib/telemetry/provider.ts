import { SpanStatusCode, type Tracer } from "@opentelemetry/api";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import posthog from "posthog-js";
import { ForwardingSpanProcessor } from "./forwarding-processor";
import { sanitizeProps, sanitizeTelemetryAttributes } from "./sanitize";
import type { TelemetryEvent, TelemetryProvider } from "./types";

export interface TelemetryConfig {
  key: string;
  host: string;
  release: string;
  environment: string;
}

const SERVICE_NAME = "nixmac";

// OTEL span attributes accept primitives only; coerce everything else to a
// JSON string after sanitization so structured props survive the boundary.
const toAttributeValue = (value: unknown): string | number | boolean | undefined => {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value === null || value === undefined) {
    return undefined;
  }
  return JSON.stringify(value);
};

const toSpanAttributes = (
  record: Record<string, unknown>,
): Record<string, string | number | boolean> => {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(record)) {
    const coerced = toAttributeValue(v);
    if (coerced !== undefined) {
      out[k] = coerced;
    }
  }
  return out;
};

/**
 * Create the unified telemetry provider.
 *
 * Pipeline:
 * - PostHog (direct): product events, opt-in/out honoured at SDK + flag level.
 * - OTEL (WebTracerProvider → ForwardingSpanProcessor → Rust IPC): every event
 *   is mirrored as a span, and errors are recorded as ERROR-status spans with
 *   recordException(). The Rust backend exports these (e.g. to Sentry).
 *
 * Sanitization runs at the boundary for defense in depth, layered on top of the
 * constrained event taxonomy.
 */
export function createTelemetryProvider(
  config: TelemetryConfig,
  initiallyEnabled: boolean,
): TelemetryProvider {
  let enabled = initiallyEnabled;
  let posthogStarted = false;

  const tracerProvider = new WebTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: SERVICE_NAME,
      [ATTR_SERVICE_VERSION]: config.release,
      "deployment.environment": config.environment,
    }),
    spanProcessors: [new ForwardingSpanProcessor()],
  });

  const tracer: Tracer = tracerProvider.getTracer(SERVICE_NAME, config.release);

  posthog.init(config.key, {
    api_host: config.host,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
    persistence: "localStorage",
    opt_out_capturing_by_default: !enabled,
    sanitize_properties: (props) => sanitizeProps(props),
    loaded: (ph) => {
      if (!enabled) ph.opt_out_capturing();
    },
  });
  posthogStarted = true;

  return {
    get enabled() {
      return enabled;
    },

    captureEvent(event: TelemetryEvent) {
      if (!enabled) return;
      const rawProps = "props" in event && event.props ? event.props : {};
      const props = sanitizeProps(rawProps);

      // PostHog (direct).
      posthog.capture(event.name, props);

      // OTEL span mirror.
      const span = tracer.startSpan(event.name);
      span.setAttributes(toSpanAttributes(props));
      span.end();
    },

    captureError(error: Error, context?: Record<string, unknown>) {
      if (!enabled) return;
      const span = tracer.startSpan(`error.${error.name || "Error"}`);
      if (context) {
        const sanitized = sanitizeTelemetryAttributes(context);
        if (sanitized && typeof sanitized === "object") {
          span.setAttributes(toSpanAttributes(sanitized as Record<string, unknown>));
        }
      }
      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });
      span.end();
    },

    setEnabled(next: boolean) {
      enabled = next;
      if (!posthogStarted) return;
      if (next) {
        posthog.opt_in_capturing();
      } else {
        posthog.opt_out_capturing();
        posthog.reset();
      }
    },

    reset() {
      if (posthogStarted) posthog.reset();
    },
  };
}
