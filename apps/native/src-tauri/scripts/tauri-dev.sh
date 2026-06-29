#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
tauri_dir="$(cd -- "$script_dir/.." && pwd)"
native_dir="$(cd -- "$tauri_dir/.." && pwd)"

cd "$tauri_dir"

needs_regen=false
reasons=()
stamp_dir="$native_dir/.devenv/state"
stamp_file="$stamp_dir/specta-gen.input.sha256"

mkdir -p "$stamp_dir"

input_hash="$({
  cat src/sqlite_types.rs
  cat src/shared_types.rs
  cat examples/specta_gen_ts.rs
  cat configurable-derive/src/{attrs,fields,types,codegen}.rs
  cat src/evolve/config.rs
  cat src/env/config.rs
  cat src/schema_gen.rs
} | shasum -a 256 | awk '{print $1}')"

if [ ! -f ../src/ipc/sqlite.ts ]; then
  needs_regen=true
  reasons+=("missing ../src/ipc/sqlite.ts")
fi

if [ ! -f ../src/ipc/types.ts ]; then
  needs_regen=true
  reasons+=("missing ../src/ipc/types.ts")
fi

if [ ! -f "$stamp_file" ]; then
  needs_regen=true
  reasons+=("missing $stamp_file")
fi

if [ -f "$stamp_file" ] && [ "$(cat "$stamp_file")" != "$input_hash" ]; then
  needs_regen=true
  reasons+=("input hash changed")
fi

schema_stamp_file="$stamp_dir/config-schema-gen.input.sha256"
schema_needs_regen=false

if [ ! -f resources/schemas/settings.schema.json ]; then
  schema_needs_regen=true
fi

if [ ! -f resources/schemas/env.schema.json ]; then
  schema_needs_regen=true
fi

if [ ! -f "$schema_stamp_file" ]; then
  schema_needs_regen=true
fi

if [ -f "$schema_stamp_file" ] && [ "$(cat "$schema_stamp_file")" != "$input_hash" ]; then
  schema_needs_regen=true
fi

if [ "$schema_needs_regen" = true ]; then
  echo "[tauri-dev] Regenerating configurable JSON Schema files"
  cargo run --bin nixmac -- gen-schemas
  printf '%s\n' "$input_hash" > "$schema_stamp_file"
else
  echo "[tauri-dev] Configurable JSON Schemas up-to-date; skipping generation"
fi

if [ "$needs_regen" = true ]; then
  echo "[tauri-dev] Regenerating Specta TypeScript bindings"
  printf '[tauri-dev] Regeneration reason: %s\n' "${reasons[@]}"
  cargo run --example specta_gen_ts
  printf '%s\n' "$input_hash" > "$stamp_file"
else
  echo "[tauri-dev] Specta bindings up-to-date; skipping generation"
fi

cd "$native_dir"
echo "[tauri-dev] Starting tauri dev"
RUST_LOG=nixmac=debug tauri dev --config src-tauri/tauri.conf.dev.json
