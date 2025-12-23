import { apiApp } from "@nixmac/hono-api";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      DELETE: ({ request }) => apiApp.fetch(request),
      GET: ({ request }) => apiApp.fetch(request),
      HEAD: ({ request }) => apiApp.fetch(request),
      OPTIONS: ({ request }) => apiApp.fetch(request),
      PATCH: ({ request }) => apiApp.fetch(request),
      POST: ({ request }) => apiApp.fetch(request),
      PUT: ({ request }) => apiApp.fetch(request),
    },
  },
});
