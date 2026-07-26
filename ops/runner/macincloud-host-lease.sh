#!/usr/bin/env bash
set -euo pipefail

# Atomic, owner-token-bound lease for the one mutable MacinCloud desktop.
# The controller runs this helper; all lease mutations happen over strict SSH.

lease_root="/tmp/nixmac-e2e-host-lease-v1"
if [[ "${NIXMAC_E2E_LEASE_TEST_MODE:-}" == "1" ]]; then
  lease_root="${NIXMAC_E2E_LEASE_ROOT:-}"
  if [[ ! "$lease_root" =~ /nixmac-host-lease-contract-[^/]+/remote-lease$ ]]; then
    echo "Test lease root must be an isolated nixmac-host-lease-contract fixture" >&2
    exit 64
  fi
elif [[ -n "${NIXMAC_E2E_LEASE_ROOT:-}" ]]; then
  echo "NIXMAC_E2E_LEASE_ROOT is test-only" >&2
  exit 64
fi
readonly lease_root
readonly lease_dir="${lease_root}/owner"
readonly quarantine_file="${lease_root}/QUARANTINED.json"
readonly recovery_audit_root="${lease_root}-recovery-audit"

usage() {
  cat >&2 <<'USAGE'
Usage:
  macincloud-host-lease.sh acquire|release|status|quarantine [options]
  macincloud-host-lease.sh recover --observed-lease-digest SHA256 --operator-reason TEXT [options]

Connection:
  --ssh-dest USER@HOST --ssh-key PATH --known-hosts PATH

Ownership:
  --owner-token TOKEN --repository OWNER/REPO --run-id ID
  --logical-job ID --attempt NUMBER --nonce NONCE

Acquire controls:
  --wait-seconds NUMBER --poll-seconds NUMBER --max-hold-seconds NUMBER
USAGE
}

command_name="${1:-}"
if [[ -z "$command_name" ]]; then
  usage
  exit 64
fi
shift

ssh_dest=""
ssh_key=""
known_hosts=""
owner_token=""
repository=""
run_id=""
logical_job=""
attempt=""
nonce=""
wait_seconds="900"
poll_seconds="15"
max_hold_seconds="10800"
quarantine_reason=""
observed_lease_digest=""
operator_reason=""

while (($#)); do
  case "$1" in
    --ssh-dest) ssh_dest="${2:-}"; shift 2 ;;
    --ssh-key) ssh_key="${2:-}"; shift 2 ;;
    --known-hosts) known_hosts="${2:-}"; shift 2 ;;
    --owner-token) owner_token="${2:-}"; shift 2 ;;
    --repository) repository="${2:-}"; shift 2 ;;
    --run-id) run_id="${2:-}"; shift 2 ;;
    --logical-job) logical_job="${2:-}"; shift 2 ;;
    --attempt) attempt="${2:-}"; shift 2 ;;
    --nonce) nonce="${2:-}"; shift 2 ;;
    --wait-seconds) wait_seconds="${2:-}"; shift 2 ;;
    --poll-seconds) poll_seconds="${2:-}"; shift 2 ;;
    --max-hold-seconds) max_hold_seconds="${2:-}"; shift 2 ;;
    --reason) quarantine_reason="${2:-}"; shift 2 ;;
    --observed-lease-digest) observed_lease_digest="${2:-}"; shift 2 ;;
    --operator-reason) operator_reason="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 64 ;;
  esac
done

require_nonempty() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    echo "Missing required $name" >&2
    exit 64
  fi
}

require_connection() {
  require_nonempty "--ssh-dest" "$ssh_dest"
  require_nonempty "--ssh-key" "$ssh_key"
  require_nonempty "--known-hosts" "$known_hosts"
  [[ -f "$ssh_key" ]] || { echo "SSH key not found: $ssh_key" >&2; exit 66; }
  [[ -f "$known_hosts" ]] || { echo "known_hosts not found: $known_hosts" >&2; exit 66; }
  ssh-keygen -F "${ssh_dest#*@}" -f "$known_hosts" >/dev/null ||
    { echo "Strict known-host entry missing for ${ssh_dest#*@}" >&2; exit 66; }
}

require_owner() {
  require_nonempty "--owner-token" "$owner_token"
  require_nonempty "--repository" "$repository"
  require_nonempty "--run-id" "$run_id"
  require_nonempty "--logical-job" "$logical_job"
  require_nonempty "--attempt" "$attempt"
  require_nonempty "--nonce" "$nonce"
  [[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] ||
    { echo "Invalid repository: $repository" >&2; exit 64; }
  [[ "$run_id" =~ ^[0-9]+$ ]] || { echo "Invalid run ID" >&2; exit 64; }
  [[ "$attempt" =~ ^[0-9]+$ ]] || { echo "Invalid attempt" >&2; exit 64; }
}

require_uint() {
  local name="$1"
  local value="$2"
  [[ "$value" =~ ^[0-9]+$ ]] || { echo "Invalid $name: $value" >&2; exit 64; }
}

require_sha256() {
  local value="$1"
  [[ "$value" =~ ^[0-9a-f]{64}$ ]] ||
    { echo "Observed lease digest must be a lowercase SHA-256" >&2; exit 64; }
}

require_connection
readonly -a ssh_common=(
  -i "$ssh_key"
  -o BatchMode=yes
  -o StrictHostKeyChecking=yes
  -o "UserKnownHostsFile=$known_hosts"
  -o ConnectTimeout=30
  -o ServerAliveInterval=15
  -o ServerAliveCountMax=4
)

ssh_script() {
  ssh "${ssh_common[@]}" "$ssh_dest" bash -s -- "$@"
}

token_digest() {
  printf '%s' "$owner_token" | shasum -a 256 | awk '{print $1}'
}

remote_status() {
  ssh_script "$lease_root" "$lease_dir" "$quarantine_file" <<'REMOTE'
set -euo pipefail
lease_root="$1"
lease_dir="$2"
quarantine_file="$3"
if [[ ! -d "$lease_dir" ]]; then
  if [[ -f "$quarantine_file" ]]; then
    quarantine_digest="$(shasum -a 256 "$quarantine_file" | awk '{print $1}')"
    printf 'QUARANTINED\t%s\t' "$quarantine_digest"
    base64 < "$quarantine_file" | tr -d '\n'
    printf '\n'
    exit 0
  fi
  printf 'FREE\n'
  exit 0
fi
if [[ ! -f "$lease_dir/owner.json" ]]; then
  printf 'AMBIGUOUS\tmissing-owner-metadata\n'
  exit 0
fi
owner_digest="$(shasum -a 256 "$lease_dir/owner.json" | awk '{print $1}')"
printf 'OCCUPIED\t%s\t' "$owner_digest"
base64 < "$lease_dir/owner.json" | tr -d '\n'
printf '\n'
REMOTE
}

remote_quarantine() {
  local reason="$1"
  local detail="${2:-}"
  local now
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local payload
  payload="$(
    jq -cn \
      --arg reason "$reason" \
      --arg detail "$detail" \
      --arg observed_at "$now" \
      '{schemaVersion:1,reason:$reason,detail:$detail,observedAt:$observed_at}'
  )"
  local payload_b64
  payload_b64="$(printf '%s' "$payload" | base64 | tr -d '\n')"
  ssh_script "$lease_root" "$quarantine_file" "$payload_b64" <<'REMOTE'
set -euo pipefail
lease_root="$1"
quarantine_file="$2"
payload_b64="$3"
mkdir -p "$lease_root"
tmp="${quarantine_file}.tmp.$$"
printf '%s' "$payload_b64" | /usr/bin/base64 -D > "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$quarantine_file"
REMOTE
}

github_run_status() {
  local owner_repo="$1"
  local owner_run_id="$2"
  GH_TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}" \
    gh api "repos/${owner_repo}/actions/runs/${owner_run_id}" --jq '.status'
}

acquire() {
  require_owner
  require_uint "--wait-seconds" "$wait_seconds"
  require_uint "--poll-seconds" "$poll_seconds"
  require_uint "--max-hold-seconds" "$max_hold_seconds"
  ((poll_seconds > 0 && max_hold_seconds > 0)) ||
    { echo "poll/max-hold seconds must be positive" >&2; exit 64; }

  local owner_token_sha256
  owner_token_sha256="$(token_digest)"
  local created_at
  created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local owner_json
  owner_json="$(
    jq -cn \
      --arg owner_token_sha256 "$owner_token_sha256" \
      --arg repository "$repository" \
      --arg run_id "$run_id" \
      --arg logical_job "$logical_job" \
      --arg attempt "$attempt" \
      --arg nonce "$nonce" \
      --arg created_at "$created_at" \
      '{
        schemaVersion:1,
        owner_token_sha256:$owner_token_sha256,
        repository:$repository,
        run_id:$run_id,
        logical_job:$logical_job,
        attempt:$attempt,
        nonce:$nonce,
        created_at:$created_at
      }'
  )"
  local owner_b64
  owner_b64="$(printf '%s' "$owner_json" | base64 | tr -d '\n')"
  local deadline=$((SECONDS + wait_seconds))

  while true; do
    local response
    response="$(
      ssh_script "$lease_root" "$lease_dir" "$quarantine_file" "$owner_b64" \
        "$owner_token_sha256" "$max_hold_seconds" <<'REMOTE'
set -euo pipefail
lease_root="$1"
lease_dir="$2"
quarantine_file="$3"
owner_b64="$4"
owner_token_sha256="$5"
max_hold_seconds="$6"
mkdir -p "$lease_root"
if [[ -f "$quarantine_file" ]]; then
  printf 'QUARANTINED\n'
  exit 0
fi
if mkdir "$lease_dir" 2>/dev/null; then
  trap 'rm -f "$lease_dir/owner.json.tmp.$$"; rmdir "$lease_dir" 2>/dev/null || true' ERR
  printf '%s' "$owner_b64" | /usr/bin/base64 -D > "$lease_dir/owner.json.tmp.$$"
  chmod 600 "$lease_dir/owner.json.tmp.$$"
  mv "$lease_dir/owner.json.tmp.$$" "$lease_dir/owner.json"
  date -u +%s > "$lease_dir/heartbeat"
  cat > "$lease_dir/heartbeat.sh" <<'HEARTBEAT'
#!/usr/bin/env bash
set -euo pipefail
lease_dir="$1"
expected_digest="$2"
deadline="$3"
while [[ "$(date -u +%s)" -lt "$deadline" ]]; do
  [[ -f "$lease_dir/owner.json" ]] || exit 0
  actual="$(jq -r '.owner_token_sha256 // ""' "$lease_dir/owner.json")"
  [[ "$actual" == "$expected_digest" ]] || exit 0
  date -u +%s > "$lease_dir/heartbeat.tmp.$$"
  mv "$lease_dir/heartbeat.tmp.$$" "$lease_dir/heartbeat"
  sleep 30
done
HEARTBEAT
  chmod 700 "$lease_dir/heartbeat.sh"
  heartbeat_deadline="$(($(date -u +%s) + max_hold_seconds))"
  nohup "$lease_dir/heartbeat.sh" "$lease_dir" "$owner_token_sha256" \
    "$heartbeat_deadline" </dev/null >"$lease_dir/heartbeat.log" 2>&1 &
  printf '%s\n' "$!" > "$lease_dir/heartbeat.pid"
  printf 'ACQUIRED\n'
  exit 0
fi
if [[ ! -f "$lease_dir/owner.json" ]]; then
  printf 'AMBIGUOUS\n'
  exit 0
fi
existing="$(jq -r '.owner_token_sha256 // ""' "$lease_dir/owner.json" 2>/dev/null || true)"
if [[ "$existing" == "$owner_token_sha256" ]]; then
  date -u +%s > "$lease_dir/heartbeat.tmp.$$"
  mv "$lease_dir/heartbeat.tmp.$$" "$lease_dir/heartbeat"
  printf 'ACQUIRED\n'
else
  printf 'OCCUPIED\t'
  base64 < "$lease_dir/owner.json" | tr -d '\n'
  printf '\n'
fi
REMOTE
    )"

    case "${response%%$'\t'*}" in
      ACQUIRED)
        printf 'LEASE_ACQUIRED owner_token_sha256=%s\n' "$owner_token_sha256"
        return 0
        ;;
      QUARANTINED)
        echo "LEASE_QUARANTINED: host is quarantined" >&2
        return 73
        ;;
      AMBIGUOUS)
        remote_quarantine "ambiguous-lease-owner" "lease directory exists without verifiable metadata"
        echo "LEASE_QUARANTINED: ambiguous owner metadata" >&2
        return 73
        ;;
      OCCUPIED)
        local encoded="${response#*$'\t'}"
        local existing_json
        existing_json="$(printf '%s' "$encoded" | base64 --decode 2>/dev/null || true)"
        local existing_repo existing_run
        existing_repo="$(jq -r '.repository // ""' <<<"$existing_json" 2>/dev/null || true)"
        existing_run="$(jq -r '.run_id // ""' <<<"$existing_json" 2>/dev/null || true)"
        if [[ ! "$existing_repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ||
          ! "$existing_run" =~ ^[0-9]+$ ]]; then
          remote_quarantine "unverifiable-lease-owner" "$existing_json"
          echo "LEASE_QUARANTINED: unverifiable owner" >&2
          return 73
        fi
        local status
        if ! status="$(github_run_status "$existing_repo" "$existing_run" 2>/dev/null)"; then
          remote_quarantine "owner-liveness-unverifiable" "${existing_repo}/actions/runs/${existing_run}"
          echo "LEASE_QUARANTINED: owner liveness unavailable" >&2
          return 73
        fi
        case "$status" in
          queued|in_progress|requested|waiting|pending)
            if ((SECONDS >= deadline)); then
              echo "LEASE_BUSY: live owner ${existing_repo}/actions/runs/${existing_run}" >&2
              return 75
            fi
            sleep "$poll_seconds"
            ;;
          *)
            remote_quarantine "stale-terminal-lease-owner" \
              "${existing_repo}/actions/runs/${existing_run} status=${status}"
            echo "LEASE_QUARANTINED: terminal owner retained for audited recovery" >&2
            return 73
            ;;
        esac
        ;;
      *)
        remote_quarantine "unexpected-lease-response" "$response"
        echo "LEASE_QUARANTINED: unexpected lease response" >&2
        return 73
        ;;
    esac
  done
}

release() {
  require_owner
  local owner_token_sha256
  owner_token_sha256="$(token_digest)"
  ssh_script "$lease_dir" "$quarantine_file" "$owner_token_sha256" <<'REMOTE'
set -euo pipefail
lease_dir="$1"
quarantine_file="$2"
owner_token_sha256="$3"
if [[ ! -d "$lease_dir" ]]; then
  printf 'LEASE_ALREADY_RELEASED\n'
  exit 0
fi
if [[ ! -f "$lease_dir/owner.json" ]]; then
  echo "LEASE_QUARANTINED: owner metadata missing during release" >&2
  exit 73
fi
actual="$(jq -r '.owner_token_sha256 // ""' "$lease_dir/owner.json")"
if [[ "$actual" != "$owner_token_sha256" ]]; then
  echo "LEASE_QUARANTINED: owner token mismatch during release" >&2
  exit 73
fi
[[ -f "$lease_dir/heartbeat" ]] ||
  { echo "LEASE_QUARANTINED: final heartbeat missing during release" >&2; exit 73; }
last_heartbeat_epoch="$(cat "$lease_dir/heartbeat")"
[[ "$last_heartbeat_epoch" =~ ^[0-9]+$ ]] ||
  { echo "LEASE_QUARANTINED: final heartbeat invalid during release" >&2; exit 73; }
if ! last_heartbeat_at="$(date -u -d "@$last_heartbeat_epoch" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)"; then
  last_heartbeat_at="$(/bin/date -u -r "$last_heartbeat_epoch" +%Y-%m-%dT%H:%M:%SZ)"
fi
if [[ -f "$lease_dir/heartbeat.pid" ]]; then
  heartbeat_pid="$(cat "$lease_dir/heartbeat.pid")"
  if [[ "$heartbeat_pid" =~ ^[0-9]+$ ]] &&
    ps -p "$heartbeat_pid" -o command= 2>/dev/null | grep -Fq "$lease_dir/heartbeat.sh"; then
    kill -TERM "$heartbeat_pid" 2>/dev/null || true
  fi
fi
rm -f "$lease_dir/heartbeat.pid" "$lease_dir/heartbeat" \
  "$lease_dir/heartbeat.sh" "$lease_dir/heartbeat.log" "$lease_dir/owner.json"
if ! rmdir "$lease_dir"; then
  echo "LEASE_QUARANTINED: unexpected files remain during release" >&2
  exit 73
fi
released_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'LEASE_RELEASED\t%s\t%s\n' "$last_heartbeat_at" "$released_at"
REMOTE
}

recover() {
  require_nonempty "--observed-lease-digest" "$observed_lease_digest"
  require_sha256 "$observed_lease_digest"
  require_nonempty "--operator-reason" "$operator_reason"
  ((${#operator_reason} >= 8)) ||
    { echo "Operator reason must be at least 8 characters" >&2; exit 64; }

  local status_line
  status_line="$(remote_status)"
  local state digest encoded
  IFS=$'\t' read -r state digest encoded <<<"$status_line"
  [[ "$state" == "OCCUPIED" ]] ||
    { echo "Recovery requires an occupied lease; observed $state" >&2; exit 65; }
  [[ "$digest" == "$observed_lease_digest" ]] ||
    { echo "Observed lease digest changed; refusing recovery" >&2; exit 65; }

  local owner_json owner_repo owner_run owner_status
  owner_json="$(printf '%s' "$encoded" | base64 --decode)"
  owner_repo="$(jq -r '.repository // ""' <<<"$owner_json")"
  owner_run="$(jq -r '.run_id // ""' <<<"$owner_json")"
  if ! owner_status="$(github_run_status "$owner_repo" "$owner_run" 2>/dev/null)"; then
    echo "Owning GitHub run is unverifiable; refusing recovery" >&2
    exit 73
  fi
  case "$owner_status" in
    queued|in_progress|requested|waiting|pending)
      echo "Owning GitHub run is active; refusing recovery" >&2
      exit 73
      ;;
  esac

  local reason_b64
  reason_b64="$(printf '%s' "$operator_reason" | base64 | tr -d '\n')"
  ssh_script "$lease_dir" "$quarantine_file" "$recovery_audit_root" \
    "$observed_lease_digest" "$reason_b64" <<'REMOTE'
set -euo pipefail
lease_dir="$1"
quarantine_file="$2"
recovery_audit_root="$3"
expected_digest="$4"
reason_b64="$5"
[[ -f "$lease_dir/owner.json" ]] || { echo "owner metadata disappeared" >&2; exit 65; }
actual_digest="$(shasum -a 256 "$lease_dir/owner.json" | awk '{print $1}')"
[[ "$actual_digest" == "$expected_digest" ]] ||
  { echo "lease digest changed during recovery" >&2; exit 65; }
if pgrep -f 'nixmac\.app/Contents/MacOS/nixmac|/Contents/MacOS/nixmac' >/dev/null; then
  echo "nixmac process active; refusing recovery" >&2
  exit 73
fi
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
audit_dir="${recovery_audit_root}/${stamp}-${expected_digest}"
mkdir -p "$audit_dir"
cp "$lease_dir/owner.json" "$audit_dir/owner.json"
[[ -f "$lease_dir/heartbeat" ]] && cp "$lease_dir/heartbeat" "$audit_dir/heartbeat"
[[ -f "$quarantine_file" ]] && cp "$quarantine_file" "$audit_dir/QUARANTINED.json"
printf '%s' "$reason_b64" | /usr/bin/base64 -D > "$audit_dir/operator-reason.txt"
chmod 600 "$audit_dir"/*
if [[ -f "$lease_dir/heartbeat.pid" ]]; then
  heartbeat_pid="$(cat "$lease_dir/heartbeat.pid")"
  if [[ "$heartbeat_pid" =~ ^[0-9]+$ ]] &&
    ps -p "$heartbeat_pid" -o command= 2>/dev/null | grep -Fq "$lease_dir/heartbeat.sh"; then
    kill -TERM "$heartbeat_pid" 2>/dev/null || true
  fi
fi
rm -f "$lease_dir/heartbeat.pid" "$lease_dir/heartbeat" \
  "$lease_dir/heartbeat.sh" "$lease_dir/heartbeat.log" "$lease_dir/owner.json"
rmdir "$lease_dir"
rm -f "$quarantine_file"
printf 'LEASE_RECOVERED audit=%s\n' "$audit_dir"
REMOTE
}

case "$command_name" in
  acquire) acquire ;;
  release) release ;;
  status) remote_status ;;
  quarantine)
    require_nonempty "--reason" "$quarantine_reason"
    remote_quarantine "operator-quarantine" "$quarantine_reason"
    echo "LEASE_QUARANTINED"
    ;;
  recover) recover ;;
  *) echo "Unknown command: $command_name" >&2; usage; exit 64 ;;
esac
