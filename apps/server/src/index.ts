/// <reference types="bun" />
/* global Bun */
import "dotenv/config";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import { apiApp } from "@nixmac/hono-api";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

const app = new Hono();

app.use(logger());

// CORS should apply to API routes, not to static asset delivery.
app.use(
  "/api/*",
  cors({
    origin: process.env.CORS_ORIGIN || "",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use(
  "/trpc/*",
  cors({
    origin: process.env.CORS_ORIGIN || "",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.all("/api/*", (c) => apiApp.fetch(c.req.raw));
app.all("/trpc/*", (c) => apiApp.fetch(c.req.raw));

// Serve the Vite build output (SPA) from the filesystem.
// In your nix2container image, `./dist` becomes `/env/dist`.
const staticRoot = process.env.STATIC_ROOT || "/env/dist";
const staticServe = serveStatic({ root: staticRoot });

const fileExists = async (filePath: string) => {
  try {
    await access(filePath);
    const s = await stat(filePath);
    return s.isFile();
  } catch {
    return false;
  }
};

app.get("*", async (c, next) => {
  const pathname = new URL(c.req.url).pathname;

  // Never intercept API routes.
  if (pathname.startsWith("/api/") || pathname.startsWith("/trpc/")) {
    return next();
  }

  // Serve an existing file if present.
  const candidate = path.join(staticRoot, pathname);
  if (await fileExists(candidate)) {
    return staticServe(c, next);
  }

  // SPA fallback.
  // biome-ignore lint: Bun is a runtime global in Bun.
  const indexHtml = Bun.file(path.join(staticRoot, "index.html"));
  return c.body(indexHtml as unknown as Parameters<typeof c.body>[0]);
});

// Bun auto-starts an HTTP server for modules exporting `{ port, fetch }`.
const port = Number(process.env.PORT || 3001);
export default { port, fetch: app.fetch };
