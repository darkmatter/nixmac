import { trpcServer } from "@hono/trpc-server";
import { createContext } from "@nixmac/api/context";
import { appRouter } from "@nixmac/api/routers/index";
import { auth } from "@nixmac/auth";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { insertFeedback } from "./services/feedback";

export const apiApp = new Hono();

// Hard-coded DSN component for feedback ingestion. Share this with the
// native client to allow posting feedback. Can replace with an env var
// or more complex DSN structure later to support rotation or other
// features.
const FEEDBACK_DSN = "dsn_6f4b9a5e8c2d4f1a9b3c7e2d5a1f0b4c";

// Auth (better-auth)
apiApp.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

apiApp.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  })
);

apiApp.use("*", async (c, next) => {
  console.log("Incoming method:", c.req.method, "URL:", c.req.url);
  await next();
});

// tRPC
apiApp.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext: (_opts, context) => createContext({ context }),
  })
);

// Simple feedback endpoint - accepts POSTed JSON and responds with an id.
// This is intentionally lightweight: later the payload can be validated
// and persisted to Postgres.
// Feedback endpoint with DSN-like component: POST /api/feedback/:dsn
// Basic in-memory rate limiting (best-effort).
// - per-IP limit to slow abusive clients
// Notes: in-memory limits reset when process restarts and are not suitable
// for multi-instance deployments; consider Redis/Datadog limiter later.
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 10; // max requests per window
const rateLimitByIp = new Map<string, { count: number; start: number }>();

function checkAndIncrement(map: Map<string, { count: number; start: number }>, key: string) {
  const now = Date.now();
  const existing = map.get(key);
  if (!existing || now - existing.start >= RATE_LIMIT_WINDOW_MS) {
    map.set(key, { count: 1, start: now });
    return true;
  }
  if (existing.count >= RATE_LIMIT_MAX) return false;
  existing.count += 1;
  map.set(key, existing);
  return true;
}

// Middleware style per-IP rate limiter (in-memory). This is best-effort
// and suitable for single-process deployments.
const feedbackRateLimit = async (c: any, next: () => Promise<any>) => {
  const extractHeaderValue = (headers: any, name: string) => {
    if (!headers) return undefined;
    const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? (headers as any)[key] : undefined;
  };

  const rawHeaders = c?.req?.headers ?? c?.req?.raw?.headers ?? null;
  const forwarded = extractHeaderValue(rawHeaders, "x-forwarded-for") || extractHeaderValue(rawHeaders, "x-real-ip");
  const ip = (forwarded || "unknown").split(",")[0].trim();
  if (!checkAndIncrement(rateLimitByIp, ip)) {
    return c.json({ ok: false, error: "rate_limited" }, 429);
  }
  return await next();
};

// Attach per-IP limiter as middleware for the feedback route.
apiApp.post("/api/feedback/:dsn", feedbackRateLimit, async (c) => {
  console.log("Raw body text:", await c.req.text());
  try {
    // @ts-ignore - Hono provides `req.param` at runtime
    const dsn: string | undefined = (c.req as any).param?.("dsn");
    if (!dsn) {
      return c.json({ ok: false, error: "dsn missing" }, 400);
    }

    // simple DSN check
    if (dsn !== FEEDBACK_DSN) {
      return c.json({ ok: false, error: "invalid dsn" }, 403);
    }

    const payload = await c.req.json();
    // persist to DB using the shared db package
    const id = (globalThis.crypto as any)?.randomUUID?.() ?? Date.now().toString();
    try {
      await insertFeedback({ id, type: (payload.type as any) ?? "general", email: payload.email, payload });
    } catch (dbErr) {
      console.error("DB error inserting feedback:", dbErr);
      return c.json({ ok: false, error: "db_error" }, 500);
    }
    return c.json({ ok: true, id }, 201);
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error("Error handling feedback POST:", err);
    return c.json({ ok: false, error: String(err?.message ?? err) }, 500);
  }
});
