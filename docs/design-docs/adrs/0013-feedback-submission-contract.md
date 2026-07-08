# ADR 0013: Feedback Submission Contract Is Separate From Sentry

Status: proposed for team review

## Context

Slack `#nixmac` on 2026-07-04 discussed a feedback-submission backend route,
device API-key authentication, and Sentry DSN confusion. The reviewed web route
landed as a public feedback endpoint that accepts a feedback DSN in the request
body. That is different from both Sentry telemetry and device-key
authentication.

Client and server feedback contracts can diverge. For example, native code may
send a device API-key header or require sign-in while the server route still
only enforces a public feedback DSN guard. Durable docs should describe the
contract that exists end-to-end and call out gaps instead of implying stronger
auth or Sentry coupling than the implementation provides.

## Decision

Treat feedback submission as its own product/backend contract.

- Sentry DSNs are for error telemetry.
- Feedback submission DSNs route feedback to the hosted backend and are not
  secrets or authentication.
- Device API-key authentication is a separate design choice. Do not document it
  as shipped unless the server route and native client both enforce it.
- Native feedback changes must update URL shape, request body, headers, retry
  behavior, and tests together.
- Telemetry opt-out or telemetry initialization failure should not by itself
  block explicit user feedback submission.

## Consequences

Docs, clients, and tests should not mix Sentry DSNs with feedback DSNs. If the
team decides feedback needs device authentication, make that a server/client
contract change and update security docs at the same time.
