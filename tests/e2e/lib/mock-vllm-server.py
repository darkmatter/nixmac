#!/usr/bin/env python3
"""Tiny OpenAI-compatible mock server for full-Mac E2E hosts without Node."""

from __future__ import annotations

import argparse
import json
import os
import signal
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--context", required=True)
    parser.add_argument("--data-dir", default="")
    parser.add_argument("--response-files", default="")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--paths", default="/v1/chat/completions,/chat/completions")
    return parser.parse_args()


def resolve_response_file(file_path: str, data_dir: Path) -> Path:
    path = Path(file_path)
    return path if path.is_absolute() else data_dir / path


def parse_jsonl(path: Path) -> list[dict[str, Any]]:
    responses: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for index, line in enumerate(handle, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                responses.append(json.loads(stripped))
            except json.JSONDecodeError as error:
                raise RuntimeError(f"Failed parsing JSONL response at {path}:{index}: {error}") from error
    return responses


def load_responses(files: list[str], data_dir: Path) -> list[dict[str, Any]]:
    responses: list[dict[str, Any]] = []
    for file_name in files:
        responses.extend(parse_jsonl(resolve_response_file(file_name, data_dir)))
    return responses


def split_csv(value: str) -> list[str]:
    return [part for part in value.split(",") if part]


def main() -> int:
    args = parse_args()
    script_dir = Path(__file__).resolve().parent
    data_dir = Path(args.data_dir) if args.data_dir else script_dir.parent / "data"
    allowed_paths = set(split_csv(args.paths))
    state: dict[str, Any] = {
        "responses": load_responses(split_csv(args.response_files), data_dir),
        "request_index": 0,
    }

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt: str, *fmt_args: Any) -> None:
            print(f"[full-mac:mock-vllm] {self.address_string()} {fmt % fmt_args}", flush=True)

        def read_body(self, max_preview_chars: int = 4000) -> str:
            length = int(self.headers.get("content-length", "0") or "0")
            raw = self.rfile.read(length).decode("utf-8", errors="replace") if length else ""
            if len(raw) > max_preview_chars:
                return f"{raw[:max_preview_chars]}...[truncated {len(raw) - max_preview_chars} chars]"
            return raw

        def write_json(self, status_code: int, body: dict[str, Any]) -> None:
            payload = (json.dumps(body) + "\n").encode("utf-8")
            self.send_response(status_code)
            self.send_header("content-type", "application/json; charset=utf-8")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self) -> None:
            if self.path.split("?", 1)[0] == "/health":
                self.write_json(
                    200,
                    {
                        "status": "ok",
                        "queuedResponses": len(state["responses"]),
                        "consumedResponses": state["request_index"],
                    },
                )
                return
            self.write_json(404, {"error": f"Unhandled mock endpoint: GET {self.path}"})

        def do_POST(self) -> None:
            pathname = self.path.split("?", 1)[0]
            if pathname == "/__admin/mock-responses":
                raw_body = self.read_body()
                try:
                    parsed = json.loads(raw_body) if raw_body.strip() else {}
                except json.JSONDecodeError as error:
                    self.write_json(400, {"error": f"Invalid JSON request body: {error}"})
                    return

                if isinstance(parsed.get("responses"), list):
                    state["responses"] = list(parsed["responses"])
                elif isinstance(parsed.get("responseFiles"), list):
                    state["responses"] = load_responses([str(item) for item in parsed["responseFiles"]], data_dir)
                else:
                    self.write_json(400, {"error": "Expected responses or responseFiles in request body"})
                    return

                state["request_index"] = 0
                self.write_json(200, {"status": "ok", "queuedResponses": len(state["responses"])})
                return

            if pathname not in allowed_paths:
                self.write_json(404, {"error": f"Unhandled mock endpoint: POST {pathname}"})
                return

            request_body_preview = self.read_body()
            request_index = int(state["request_index"])
            responses = state["responses"]
            if request_index >= len(responses):
                self.write_json(
                    500,
                    {
                        "error": "Mock response queue exhausted",
                        "code": "MOCK_RESPONSE_QUEUE_EXHAUSTED",
                        "configuredResponses": len(responses),
                        "consumedResponses": request_index,
                        "requestedPath": pathname,
                        "requestBodyPreview": request_body_preview,
                    },
                )
                return

            payload = responses[request_index]
            state["request_index"] = request_index + 1
            if "__mockStatus" in payload:
                status_code = int(payload.get("__mockStatus") or 500)
                body = payload.get("__mockBody") or {"error": "Mock provider error"}
                self.write_json(status_code, body)
                return

            self.write_json(200, payload)

    server = ThreadingHTTPServer((args.host, 0), Handler)
    origin = f"http://{args.host}:{server.server_address[1]}"
    context_path = Path(args.context)
    context_path.write_text(
        json.dumps(
            {
                "origin": origin,
                "baseUrl": f"{origin}/v1",
                "responseCount": len(state["responses"]),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"[full-mac:mock-vllm] {origin} with {len(state['responses'])} queued responses", flush=True)

    def shutdown(_signum: int, _frame: Any) -> None:
        server.server_close()
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    try:
        server.serve_forever()
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(f"[full-mac:mock-vllm] {error}", file=sys.stderr, flush=True)
        sys.exit(1)
