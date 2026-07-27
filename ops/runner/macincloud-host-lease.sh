#!/usr/bin/env bash
# The remote lease functions are serialized with declare -f and emitted as
# single-quoted source; ShellCheck cannot follow that execution boundary.
# shellcheck disable=SC2016,SC2030,SC2031,SC2329
set -euo pipefail

# Atomic, owner-token-bound lease for the one mutable MacinCloud desktop.
# The controller runs this helper; all lease mutations happen over strict SSH.

helper_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly helper_dir
readonly status_python_path="$helper_dir/macincloud-host-lease-status.py"
readonly recover_python_path="$helper_dir/macincloud-host-lease-recover.py"
[[ -f "$status_python_path" && ! -L "$status_python_path" ]] ||
  { echo "Lease status helper is missing or unsafe" >&2; exit 66; }
[[ -f "$recover_python_path" && ! -L "$recover_python_path" ]] ||
  { echo "Lease recovery helper is missing or unsafe" >&2; exit 66; }

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

base64_decode() {
  if base64 --decode </dev/null >/dev/null 2>&1; then
    base64 --decode
  else
    base64 -D
  fi
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

ssh_script_function() {
  local function_name="$1"
  shift
  [[ "$function_name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] ||
    { echo "invalid remote function name" >&2; return 64; }
  local script_dir script_path status arg encoded
  local -a encoded_args=()
  for arg in "$@"; do
    # OpenSSH joins command arguments with spaces before the remote login shell
    # parses them. Carry only non-empty shell-token-safe base64 words and append
    # a sentinel before encoding so empty values and trailing newlines survive.
    encoded="$(printf '%s.' "$arg" | base64 | tr -d '\n')"
    [[ "$encoded" =~ ^[A-Za-z0-9+/=]+$ ]] ||
      { echo "failed to encode remote lease argument" >&2; return 64; }
    encoded_args+=("b64.$encoded")
  done
  script_dir="$(mktemp -d "${TMPDIR:-/tmp}/nixmac-e2e-lease-ssh.XXXXXX")"
  script_path="$script_dir/remote.sh"
  chmod 700 "$script_dir"
  (
    umask 077
    {
      declare -f "$function_name"
      printf '%s\n' \
        '' \
        'set -euo pipefail' \
        'lease_transport_base64_decode() {' \
        '  if /usr/bin/base64 --decode </dev/null >/dev/null 2>&1; then' \
        '    /usr/bin/base64 --decode' \
        '  else' \
        '    /usr/bin/base64 -D' \
        '  fi' \
        '}' \
        'lease_transport_args=()' \
        'for lease_transport_encoded in "$@"; do' \
        '  case "$lease_transport_encoded" in' \
        '    b64.*) lease_transport_payload="${lease_transport_encoded#b64.}" ;;' \
        '    *) echo "invalid remote lease argument envelope" >&2; exit 64 ;;' \
        '  esac' \
        '  [[ "$lease_transport_payload" =~ ^[A-Za-z0-9+/=]+$ ]] || {' \
        '    echo "invalid remote lease argument encoding" >&2' \
        '    exit 64' \
        '  }' \
        '  lease_transport_decoded="$(printf "%s" "$lease_transport_payload" | lease_transport_base64_decode)"' \
        '  [[ "$lease_transport_decoded" == *"." ]] || {' \
        '    echo "invalid remote lease argument sentinel" >&2' \
        '    exit 64' \
        '  }' \
        '  lease_transport_args+=("${lease_transport_decoded%?}")' \
        'done'
      printf '%s "${lease_transport_args[@]}"\n' "$function_name"
    } > "$script_path"
  )
  if ssh "${ssh_common[@]}" "$ssh_dest" bash -s -- "${encoded_args[@]}" < "$script_path"; then
    status=0
  else
    status=$?
  fi
  rm -f "$script_path"
  rmdir "$script_dir"
  return "$status"
}

token_digest() {
  printf '%s' "$owner_token" | shasum -a 256 | awk '{print $1}'
}

remote_status() {
  local python_b64
  python_b64="$(base64 < "$status_python_path" | tr -d '\n')"
  remote_status_payload() {
set -euo pipefail
python_b64="$1"
lease_root="$2"
lease_dir="$3"
quarantine_file="$4"
base64_decode() {
  if /usr/bin/base64 --decode </dev/null >/dev/null 2>&1; then
    /usr/bin/base64 --decode
  else
    /usr/bin/base64 -D
  fi
}
python_dir="$(mktemp -d "${TMPDIR:-/tmp}/nixmac-e2e-lease-status.XXXXXX")"
python_path="$python_dir/status.py"
chmod 700 "$python_dir"
cleanup_status_python() {
  rm -f "$python_path"
  rmdir "$python_dir" 2>/dev/null || true
}
trap cleanup_status_python EXIT HUP INT TERM
printf "%s" "$python_b64" | base64_decode > "$python_path"
chmod 600 "$python_path"
if python3 "$python_path" "$lease_root" "$lease_dir" "$quarantine_file"; then
  python_status=0
else
  python_status=$?
fi
cleanup_status_python
trap - EXIT HUP INT TERM
return "$python_status"
  }
  ssh_script_function remote_status_payload \
    "$python_b64" "$lease_root" "$lease_dir" "$quarantine_file"
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
  remote_quarantine_payload() {
set -euo pipefail
lease_root="$1"
quarantine_file="$2"
payload_b64="$3"
base64_decode() {
  if /usr/bin/base64 --decode </dev/null >/dev/null 2>&1; then
    /usr/bin/base64 --decode
  else
    /usr/bin/base64 -D
  fi
}
if [[ -e "$lease_root" || -L "$lease_root" ]]; then
  [[ -d "$lease_root" && ! -L "$lease_root" ]] ||
    { echo "unsafe lease root" >&2; exit 65; }
else
  mkdir "$lease_root"
fi
if [[ -e "$quarantine_file" || -L "$quarantine_file" ]]; then
  [[ -f "$quarantine_file" && ! -L "$quarantine_file" ]] ||
    { echo "unsafe quarantine metadata" >&2; exit 65; }
fi
tmp="${quarantine_file}.tmp.$$"
printf '%s' "$payload_b64" | base64_decode > "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$quarantine_file"
  }
  ssh_script_function remote_quarantine_payload \
    "$lease_root" "$quarantine_file" "$payload_b64"
}

github_run_status() {
  local owner_repo="$1"
  local owner_run_id="$2"
  GH_TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}" \
    gh api "repos/${owner_repo}/actions/runs/${owner_run_id}" --jq '.status'
}

github_run_status_with_retry() {
  local owner_repo="$1"
  local owner_run_id="$2"
  local status=""
  local retry_delay="${NIXMAC_E2E_LEASE_LIVENESS_RETRY_DELAY_SECONDS:-2}"
  require_uint "NIXMAC_E2E_LEASE_LIVENESS_RETRY_DELAY_SECONDS" "$retry_delay"
  for probe_attempt in 1 2 3; do
    if status="$(github_run_status "$owner_repo" "$owner_run_id" 2>/dev/null)"; then
      printf '%s\n' "$status"
      return 0
    fi
    if ((probe_attempt < 3 && retry_delay > 0)); then
      sleep "$retry_delay"
    fi
  done
  return 1
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
  local owner_json
  owner_json="$(
    jq -cn \
      --arg owner_token_sha256 "$owner_token_sha256" \
      --arg repository "$repository" \
      --arg run_id "$run_id" \
      --arg logical_job "$logical_job" \
      --arg attempt "$attempt" \
      --arg nonce "$nonce" \
      '{
        schemaVersion:1,
        owner_token_sha256:$owner_token_sha256,
        repository:$repository,
        run_id:$run_id,
        logical_job:$logical_job,
        attempt:$attempt,
        nonce:$nonce,
        created_at:""
      }'
  )"
  local owner_b64
  owner_b64="$(printf '%s' "$owner_json" | base64 | tr -d '\n')"
  local deadline=$((SECONDS + wait_seconds))
  local transport_failures=0
  local transport_deadline=0

  while true; do
    local response
    if ! response="$(
      acquire_remote_payload() {
set -euo pipefail
lease_root="$1"
lease_dir="$2"
quarantine_file="$3"
owner_b64="$4"
owner_token_sha256="$5"
max_hold_seconds="$6"
base64_decode() {
  if /usr/bin/base64 --decode </dev/null >/dev/null 2>&1; then
    /usr/bin/base64 --decode
  else
    /usr/bin/base64 -D
  fi
}
if [[ ! -e "$lease_root" && ! -L "$lease_root" ]]; then
  if [[ "${NIXMAC_E2E_LEASE_TEST_MODE:-0}" == "1" &&
    -n "${NIXMAC_E2E_LEASE_ROOT_CREATION_TEST_HOOK:-}" ]]; then
    "$NIXMAC_E2E_LEASE_ROOT_CREATION_TEST_HOOK" "$lease_root"
  fi
  if ! mkdir "$lease_root" 2>/dev/null; then
    [[ -d "$lease_root" && ! -L "$lease_root" ]] ||
      { printf 'UNSAFE\n'; exit 0; }
  fi
fi
[[ -d "$lease_root" && ! -L "$lease_root" ]] || { printf 'UNSAFE\n'; exit 0; }
if [[ -e "$quarantine_file" || -L "$quarantine_file" ]]; then
  [[ -f "$quarantine_file" && ! -L "$quarantine_file" ]] ||
    { printf 'UNSAFE\n'; exit 0; }
  printf 'QUARANTINED\n'
  exit 0
fi
lease_dir_state() {
  if [[ -d "$lease_dir" && ! -L "$lease_dir" ]]; then
    printf 'DIRECTORY\n'
  elif [[ ! -e "$lease_dir" && ! -L "$lease_dir" ]]; then
    printf 'ABSENT\n'
  else
    printf 'UNSAFE\n'
  fi
}
[[ "$(lease_dir_state)" != "UNSAFE" ]] || { printf 'UNSAFE\n'; exit 0; }
if mkdir "$lease_dir" 2>/dev/null; then
  trap 'rm -f "$lease_dir/owner.json.tmp.$$"; rmdir "$lease_dir" 2>/dev/null || true' ERR
  if [[ "${NIXMAC_E2E_LEASE_TEST_MODE:-0}" == "1" &&
    -n "${NIXMAC_E2E_LEASE_OWNER_INIT_TEST_HOOK:-}" ]]; then
    "$NIXMAC_E2E_LEASE_OWNER_INIT_TEST_HOOK" "$lease_dir"
  fi
  acquired_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '%s' "$owner_b64" |
    base64_decode |
    jq -c --arg acquired_at "$acquired_at" '.created_at = $acquired_at' \
      > "$lease_dir/owner.json.tmp.$$"
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
  printf 'ACQUIRED\t%s\n' "$acquired_at"
  exit 0
fi
if [[ "${NIXMAC_E2E_LEASE_TEST_MODE:-0}" == "1" &&
  -n "${NIXMAC_E2E_LEASE_POST_MKDIR_FAILURE_TEST_HOOK:-}" ]]; then
  "$NIXMAC_E2E_LEASE_POST_MKDIR_FAILURE_TEST_HOOK" "$lease_dir"
fi
case "$(lease_dir_state)" in
  DIRECTORY) ;;
  ABSENT) printf 'RETRY\n'; exit 0 ;;
  *) printf 'UNSAFE\n'; exit 0 ;;
esac
directory_identity() {
  case "$(/usr/bin/uname -s)" in
    Darwin) /usr/bin/stat -f '%d:%i' "$1" 2>/dev/null ;;
    *) /usr/bin/stat -c '%d:%i' "$1" 2>/dev/null ;;
  esac
}
if ! owner_identity="$(directory_identity "$lease_dir")"; then
  if [[ "$(lease_dir_state)" == "ABSENT" ]]; then
    printf 'RETRY\n'
  else
    printf 'UNSAFE\n'
  fi
  exit 0
fi
initialization_deadline=$((SECONDS + 5))
while [[ ! -e "$lease_dir/owner.json" && ! -L "$lease_dir/owner.json" ]]; do
  current_identity="$(directory_identity "$lease_dir")" ||
    { printf 'RETRY\n'; exit 0; }
  if [[ "$current_identity" != "$owner_identity" ]]; then
    printf 'RETRY\n'
    exit 0
  fi
  if ((SECONDS >= initialization_deadline)); then
    printf 'AMBIGUOUS\n'
    exit 0
  fi
  sleep 0.1
done
current_identity="$(directory_identity "$lease_dir")" ||
  { printf 'RETRY\n'; exit 0; }
if [[ "$current_identity" != "$owner_identity" ]]; then
  printf 'RETRY\n'
  exit 0
fi
if [[ -f "$lease_dir/owner.json" && ! -L "$lease_dir/owner.json" ]]; then
  :
elif [[ "$(lease_dir_state)" == "ABSENT" ]]; then
  printf 'RETRY\n'
  exit 0
else
  printf 'UNSAFE\n'
  exit 0
fi
existing_json="$(cat "$lease_dir/owner.json")"
desired_json="$(printf '%s' "$owner_b64" | base64_decode)"
if ! jq -e '
  .schemaVersion == 1 and
  (.owner_token_sha256 | type == "string") and
  (.repository | type == "string") and
  (.run_id | type == "string") and
  (.logical_job | type == "string") and
  (.attempt | type == "string") and
  (.nonce | type == "string") and
  (.created_at | type == "string")
' >/dev/null 2>&1 <<<"$existing_json"; then
  printf 'UNVERIFIABLE\t'
  base64 < "$lease_dir/owner.json" | tr -d '\n'
  printf '\n'
  exit 0
fi
same_binding="$(
  jq -nr \
    --argjson existing "$existing_json" \
    --argjson desired "$desired_json" \
    '[
      "schemaVersion",
      "owner_token_sha256",
      "repository",
      "run_id",
      "logical_job",
      "attempt",
      "nonce"
    ] | all(. as $key | $existing[$key] == $desired[$key])'
)"
stale_logical_attempt="$(
  jq -nr \
    --argjson existing "$existing_json" \
    --argjson desired "$desired_json" \
    '$existing.repository == $desired.repository and
     $existing.run_id == $desired.run_id and
     $existing.logical_job == $desired.logical_job and
     ($existing.attempt != $desired.attempt or $existing.nonce != $desired.nonce)'
)"
existing_token="$(jq -r '.owner_token_sha256' <<<"$existing_json")"
if [[ "$same_binding" == "true" ]]; then
  date -u +%s > "$lease_dir/heartbeat.tmp.$$"
  mv "$lease_dir/heartbeat.tmp.$$" "$lease_dir/heartbeat"
  acquired_at="$(jq -er '.created_at' "$lease_dir/owner.json")"
  [[ "$acquired_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]
  printf 'ACQUIRED\t%s\n' "$acquired_at"
elif [[ "$stale_logical_attempt" == "true" ]]; then
  printf 'STALE_ATTEMPT\t'
  base64 < "$lease_dir/owner.json" | tr -d '\n'
  printf '\n'
elif [[ "$existing_token" == "$owner_token_sha256" ]]; then
  printf 'OWNER_BINDING_MISMATCH\t'
  base64 < "$lease_dir/owner.json" | tr -d '\n'
  printf '\n'
else
  printf 'OCCUPIED\t'
  base64 < "$lease_dir/owner.json" | tr -d '\n'
  printf '\n'
fi
      }
      ssh_script_function acquire_remote_payload \
        "$lease_root" "$lease_dir" "$quarantine_file" "$owner_b64" \
        "$owner_token_sha256" "$max_hold_seconds"
    )"; then
      ((transport_failures += 1))
      if ((transport_failures == 1)); then
        transport_deadline=$((SECONDS + 5))
      fi
      if ((transport_failures >= 3 || SECONDS >= transport_deadline)); then
        echo "LEASE_TRANSPORT_UNAVAILABLE: acquire probe failed after bounded retries" >&2
        return 76
      fi
      sleep "$transport_failures"
      continue
    fi
    transport_failures=0
    transport_deadline=0

    case "${response%%$'\t'*}" in
      ACQUIRED)
        local acquired_at="${response#*$'\t'}"
        [[ "$acquired_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] ||
          { echo "LEASE_QUARANTINED: invalid acquisition timestamp" >&2; return 73; }
        printf 'LEASE_ACQUIRED\t%s\towner_token_sha256=%s\n' \
          "$acquired_at" \
          "$owner_token_sha256"
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
      RETRY)
        if ((SECONDS >= deadline)); then
          echo "LEASE_BUSY: owner initialization changed; retry later" >&2
          return 75
        fi
        sleep 1
        ;;
      UNSAFE)
        echo "LEASE_QUARANTINED: unsafe lease filesystem boundary" >&2
        return 73
        ;;
      UNVERIFIABLE)
        local unverifiable_encoded="${response#*$'\t'}"
        local unverifiable_json
        unverifiable_json="$(printf '%s' "$unverifiable_encoded" | base64_decode 2>/dev/null || true)"
        remote_quarantine "unverifiable-lease-owner" "$unverifiable_json"
        echo "LEASE_QUARANTINED: unverifiable owner" >&2
        return 73
        ;;
      STALE_ATTEMPT)
        local stale_encoded="${response#*$'\t'}"
        local stale_json stale_repo stale_run stale_job stale_attempt stale_nonce
        stale_json="$(printf '%s' "$stale_encoded" | base64_decode 2>/dev/null || true)"
        stale_repo="$(jq -r '.repository // ""' <<<"$stale_json" 2>/dev/null || true)"
        stale_run="$(jq -r '.run_id // ""' <<<"$stale_json" 2>/dev/null || true)"
        stale_job="$(jq -r '.logical_job // ""' <<<"$stale_json" 2>/dev/null || true)"
        stale_attempt="$(jq -r '.attempt // ""' <<<"$stale_json" 2>/dev/null || true)"
        stale_nonce="$(jq -r '.nonce // ""' <<<"$stale_json" 2>/dev/null || true)"
        if [[ "$stale_repo" != "$repository" || "$stale_run" != "$run_id" ||
          "$stale_job" != "$logical_job" || ! "$stale_attempt" =~ ^[0-9]+$ ||
          -z "$stale_nonce" ]]; then
          remote_quarantine "unverifiable-lease-owner" "$stale_json"
          echo "LEASE_QUARANTINED: unverifiable stale attempt" >&2
          return 73
        fi
        local stale_detail
        stale_detail="$(
          jq -cn \
            --arg repository "$repository" \
            --arg run_id "$run_id" \
            --arg logical_job "$logical_job" \
            --arg old_attempt "$stale_attempt" \
            --arg old_nonce "$stale_nonce" \
            --arg requested_attempt "$attempt" \
            --arg requested_nonce "$nonce" \
            '{
              repository:$repository,
              run_id:$run_id,
              logical_job:$logical_job,
              old_attempt:$old_attempt,
              old_nonce:$old_nonce,
              requested_attempt:$requested_attempt,
              requested_nonce:$requested_nonce
            }'
        )"
        remote_quarantine "stale-attempt-lease-owner" "$stale_detail"
        echo "LEASE_QUARANTINED: stale attempt retained for audited recovery" >&2
        return 73
        ;;
      OWNER_BINDING_MISMATCH)
        local mismatch_encoded="${response#*$'\t'}"
        local mismatch_json
        mismatch_json="$(printf '%s' "$mismatch_encoded" | base64_decode 2>/dev/null || true)"
        remote_quarantine "owner-binding-mismatch" "$mismatch_json"
        echo "LEASE_QUARANTINED: owner token metadata binding mismatch" >&2
        return 73
        ;;
      OCCUPIED)
        local encoded="${response#*$'\t'}"
        local existing_json
        existing_json="$(printf '%s' "$encoded" | base64_decode 2>/dev/null || true)"
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
        if ! status="$(github_run_status_with_retry "$existing_repo" "$existing_run")"; then
          remote_quarantine "owner-liveness-unverifiable" "${existing_repo}/actions/runs/${existing_run}"
          echo "LEASE_QUARANTINED: owner liveness unavailable after bounded retries" >&2
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
  release_once() {
    release_remote_payload() {
set -euo pipefail
lease_root="$1"
lease_dir="$2"
quarantine_file="$3"
owner_token_sha256="$4"
repository="$5"
run_id="$6"
logical_job="$7"
attempt="$8"
nonce="$9"
if [[ -e "$lease_root" || -L "$lease_root" ]]; then
  [[ -d "$lease_root" && ! -L "$lease_root" ]] ||
    { echo "LEASE_QUARANTINED: unsafe lease root during release" >&2; exit 73; }
else
  printf 'LEASE_ALREADY_RELEASED\n'
  exit 0
fi
if [[ -e "$lease_dir" || -L "$lease_dir" ]]; then
  [[ -d "$lease_dir" && ! -L "$lease_dir" ]] ||
    { echo "LEASE_QUARANTINED: unsafe owner directory during release" >&2; exit 73; }
else
  printf 'LEASE_ALREADY_RELEASED\n'
  exit 0
fi
if [[ -e "$lease_dir/owner.json" || -L "$lease_dir/owner.json" ]]; then
  [[ -f "$lease_dir/owner.json" && ! -L "$lease_dir/owner.json" ]] ||
    { echo "LEASE_QUARANTINED: unsafe owner metadata during release" >&2; exit 73; }
else
  echo "LEASE_QUARANTINED: owner metadata missing during release" >&2
  exit 73
fi
if ! jq -e \
  --arg owner_token_sha256 "$owner_token_sha256" \
  --arg repository "$repository" \
  --arg run_id "$run_id" \
  --arg logical_job "$logical_job" \
  --arg attempt "$attempt" \
  --arg nonce "$nonce" \
  '.schemaVersion == 1 and
   .owner_token_sha256 == $owner_token_sha256 and
   .repository == $repository and
   .run_id == $run_id and
   .logical_job == $logical_job and
   .attempt == $attempt and
   .nonce == $nonce' \
  "$lease_dir/owner.json" >/dev/null; then
  echo "LEASE_QUARANTINED: owner metadata mismatch during release" >&2
  exit 73
fi
for required in heartbeat heartbeat.pid heartbeat.sh heartbeat.log; do
  [[ -f "$lease_dir/$required" && ! -L "$lease_dir/$required" ]] ||
    { echo "LEASE_QUARANTINED: unsafe or missing lease metadata $required" >&2; exit 73; }
done
heartbeat_pid="$(cat "$lease_dir/heartbeat.pid")"
[[ "$heartbeat_pid" =~ ^[0-9]+$ ]] ||
  { echo "LEASE_QUARANTINED: heartbeat PID is invalid during release" >&2; exit 73; }
heartbeat_ps_path="/bin/ps"
if [[ "${NIXMAC_E2E_LEASE_TEST_MODE:-0}" == "1" &&
  -n "${NIXMAC_E2E_LEASE_PS_PATH:-}" ]]; then
  heartbeat_ps_path="$NIXMAC_E2E_LEASE_PS_PATH"
fi
heartbeat_command_for_pid() {
  local pid="$1"
  local output
  local status
  if [[ ! -x "$heartbeat_ps_path" ]]; then
    echo "LEASE_QUARANTINED: heartbeat process probe is unavailable during release" >&2
    return 73
  fi
  set +e
  output="$("$heartbeat_ps_path" -ww -p "$pid" -o command= 2>/dev/null)"
  status=$?
  set -e
  case "$status" in
    0)
      printf '%s\n' "$output"
      ;;
    1)
      printf '\n'
      ;;
    *)
      echo "LEASE_QUARANTINED: heartbeat process probe failed during release" >&2
      return 73
      ;;
  esac
}
heartbeat_command="$(heartbeat_command_for_pid "$heartbeat_pid")"
if [[ "$heartbeat_command" == *"$lease_dir/heartbeat.sh"* ]]; then
  if [[ "${NIXMAC_E2E_LEASE_TEST_MODE:-0}" == "1" &&
    -n "${NIXMAC_E2E_LEASE_RELEASE_BEFORE_STOP_TEST_HOOK:-}" ]]; then
    "$NIXMAC_E2E_LEASE_RELEASE_BEFORE_STOP_TEST_HOOK" "$lease_dir" "$heartbeat_pid"
  fi
  kill -TERM "$heartbeat_pid" 2>/dev/null || true
  heartbeat_stop_deadline=$((SECONDS + 2))
  while true; do
    heartbeat_command="$(heartbeat_command_for_pid "$heartbeat_pid")"
    [[ "$heartbeat_command" == *"$lease_dir/heartbeat.sh"* ]] || break
    if ((SECONDS >= heartbeat_stop_deadline)); then
      echo "LEASE_QUARANTINED: heartbeat did not stop during release" >&2
      exit 73
    fi
    sleep 0.05
  done
fi
shopt -s nullglob dotglob
for entry in "$lease_dir"/*; do
  name="${entry##*/}"
  case "$name" in
    owner.json|heartbeat|heartbeat.pid|heartbeat.sh|heartbeat.log) ;;
    heartbeat.tmp.*)
      heartbeat_tmp_suffix="${name#heartbeat.tmp.}"
      [[ "$heartbeat_tmp_suffix" =~ ^[0-9]+$ ]] ||
        { echo "LEASE_QUARANTINED: invalid heartbeat temporary file name" >&2; exit 73; }
      [[ -f "$entry" && ! -L "$entry" ]] ||
        { echo "LEASE_QUARANTINED: unsafe heartbeat temporary file" >&2; exit 73; }
      heartbeat_tmp_size="$(wc -c < "$entry" | tr -d '[:space:]')"
      if [[ ! "$heartbeat_tmp_size" =~ ^[0-9]+$ ]] || ((heartbeat_tmp_size > 32)); then
        echo "LEASE_QUARANTINED: invalid heartbeat temporary file" >&2
        exit 73
      fi
      ;;
    *)
      echo "LEASE_QUARANTINED: unexpected lease metadata $name" >&2
      exit 73
      ;;
  esac
  [[ -f "$entry" && ! -L "$entry" ]] ||
    { echo "LEASE_QUARANTINED: unsafe lease metadata $name" >&2; exit 73; }
done
for entry in "$lease_dir"/heartbeat.tmp.*; do
  rm -f "$entry"
done
last_heartbeat_epoch="$(cat "$lease_dir/heartbeat")"
[[ "$last_heartbeat_epoch" =~ ^[0-9]+$ ]] ||
  { echo "LEASE_QUARANTINED: final heartbeat invalid during release" >&2; exit 73; }
if ! last_heartbeat_at="$(date -u -d "@$last_heartbeat_epoch" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)"; then
  last_heartbeat_at="$(/bin/date -u -r "$last_heartbeat_epoch" +%Y-%m-%dT%H:%M:%SZ)"
fi
rm -f "$lease_dir/heartbeat.pid" "$lease_dir/heartbeat" \
  "$lease_dir/heartbeat.sh" "$lease_dir/heartbeat.log"
remaining_entries=("$lease_dir"/*)
if ((${#remaining_entries[@]} != 1)) ||
  [[ "${remaining_entries[0]##*/}" != "owner.json" ]]; then
  echo "LEASE_QUARANTINED: unexpected files remain before owner release" >&2
  exit 73
fi
owner_snapshot="$(cat "$lease_dir/owner.json")"
rm -f "$lease_dir/owner.json"
if ! rmdir "$lease_dir"; then
  if [[ -d "$lease_dir" && ! -e "$lease_dir/owner.json" ]]; then
    (umask 077; printf '%s\n' "$owner_snapshot" > "$lease_dir/owner.json")
  fi
  echo "LEASE_QUARANTINED: unexpected files remain during release" >&2
  exit 73
fi
released_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'LEASE_RELEASED\t%s\t%s\n' "$last_heartbeat_at" "$released_at"
    }
    ssh_script_function release_remote_payload \
      "$lease_root" "$lease_dir" "$quarantine_file" "$owner_token_sha256" \
      "$repository" "$run_id" "$logical_job" "$attempt" "$nonce"
  }

  local release_output=""
  for release_attempt in 1 2 3; do
    if release_output="$(release_once)"; then
      printf '%s\n' "$release_output"
      return 0
    fi
    if ((release_attempt < 3)); then
      sleep "$release_attempt"
    fi
  done
  echo "LEASE_QUARANTINED: owner-matched release unavailable after bounded retries" >&2
  return 73
}

recover() {
  require_nonempty "--observed-lease-digest" "$observed_lease_digest"
  require_sha256 "$observed_lease_digest"
  require_nonempty "--operator-reason" "$operator_reason"
  ((${#operator_reason} >= 8)) ||
    { echo "Operator reason must be at least 8 characters" >&2; exit 64; }

  local status_line
  status_line="$(remote_status)"
  local state digest encoded quarantine_encoded
  IFS=$'\t' read -r state digest encoded quarantine_encoded <<<"$status_line"
  [[ "$state" == "OCCUPIED" || "$state" == "AMBIGUOUS" || "$state" == "QUARANTINED" ]] ||
    { echo "Recovery requires an occupied, ambiguous, or marker-only quarantined lease; observed $state" >&2; exit 65; }
  [[ "$digest" == "$observed_lease_digest" ]] ||
    { echo "Observed lease digest changed; refusing recovery" >&2; exit 65; }

  if [[ "$state" == "OCCUPIED" ]]; then
    local owner_json owner_repo owner_run owner_status
    owner_json="$(printf '%s' "$encoded" | base64_decode)"
    owner_repo="$(jq -r '.repository // ""' <<<"$owner_json")"
    owner_run="$(jq -r '.run_id // ""' <<<"$owner_json")"
    if ! owner_status="$(github_run_status_with_retry "$owner_repo" "$owner_run")"; then
      echo "Owning GitHub run is unverifiable; refusing recovery" >&2
      exit 73
    fi
    case "$owner_status" in
      queued|in_progress|requested|waiting|pending)
        local quarantine_json quarantine_reason_value quarantine_detail
        quarantine_json="$(printf '%s' "$quarantine_encoded" | base64_decode 2>/dev/null || true)"
        quarantine_reason_value="$(
          jq -r '.reason // ""' <<<"$quarantine_json" 2>/dev/null || true
        )"
        quarantine_detail="$(
          jq -r '.detail // ""' <<<"$quarantine_json" 2>/dev/null || true
        )"
        if [[ "$quarantine_reason_value" != "stale-attempt-lease-owner" ]] ||
          ! jq -e \
            --arg repository "$(jq -r '.repository // ""' <<<"$owner_json")" \
            --arg run_id "$(jq -r '.run_id // ""' <<<"$owner_json")" \
            --arg logical_job "$(jq -r '.logical_job // ""' <<<"$owner_json")" \
            --arg old_attempt "$(jq -r '.attempt // ""' <<<"$owner_json")" \
            --arg old_nonce "$(jq -r '.nonce // ""' <<<"$owner_json")" \
            '.repository == $repository and
             .run_id == $run_id and
             .logical_job == $logical_job and
             .old_attempt == $old_attempt and
             .old_nonce == $old_nonce and
             (.requested_attempt | type == "string") and
             (.requested_attempt | test("^[0-9]+$")) and
             .requested_attempt != .old_attempt and
             (.requested_nonce | type == "string") and
             (.requested_nonce | length > 0) and
             .requested_nonce != .old_nonce' \
            >/dev/null 2>&1 <<<"$quarantine_detail"; then
          echo "Owning GitHub run is active; refusing recovery" >&2
          exit 73
        fi
        ;;
    esac
  fi

  local recovery_test_hook=""
  if [[ "${NIXMAC_E2E_LEASE_TEST_MODE:-}" == "1" &&
    -n "${NIXMAC_E2E_LEASE_RECOVERY_TEST_HOOK:-}" ]]; then
    recovery_test_hook="$NIXMAC_E2E_LEASE_RECOVERY_TEST_HOOK"
    local fixture_root="${lease_root%/remote-lease}"
    [[ "$recovery_test_hook" == "$fixture_root"/* &&
      -f "$recovery_test_hook" && ! -L "$recovery_test_hook" &&
      -x "$recovery_test_hook" ]] ||
      { echo "Invalid isolated recovery test hook" >&2; exit 64; }
  fi

  local reason_b64
  reason_b64="$(printf '%s' "$operator_reason" | base64 | tr -d '\n')"
  local python_b64
  python_b64="$(base64 < "$recover_python_path" | tr -d '\n')"
  recover_remote_payload() {
set -euo pipefail
python_b64="$1"
lease_root="$2"
lease_dir="$3"
quarantine_file="$4"
recovery_audit_root="$5"
expected_digest="$6"
reason_b64="$7"
lease_state="$8"
recovery_test_hook="$9"
base64_decode() {
  if /usr/bin/base64 --decode </dev/null >/dev/null 2>&1; then
    /usr/bin/base64 --decode
  else
    /usr/bin/base64 -D
  fi
}
python_dir="$(mktemp -d "${TMPDIR:-/tmp}/nixmac-e2e-lease-recover.XXXXXX")"
python_path="$python_dir/recover.py"
chmod 700 "$python_dir"
cleanup_recover_python() {
  rm -f "$python_path"
  rmdir "$python_dir" 2>/dev/null || true
}
trap cleanup_recover_python EXIT HUP INT TERM
printf "%s" "$python_b64" | base64_decode > "$python_path"
chmod 600 "$python_path"
if python3 "$python_path" "$lease_root" "$lease_dir" "$quarantine_file" \
  "$recovery_audit_root" "$expected_digest" "$reason_b64" "$lease_state" \
  "$recovery_test_hook"; then
  python_status=0
else
  python_status=$?
fi
cleanup_recover_python
trap - EXIT HUP INT TERM
return "$python_status"
  }
  ssh_script_function recover_remote_payload \
    "$python_b64" "$lease_root" "$lease_dir" "$quarantine_file" "$recovery_audit_root" \
    "$observed_lease_digest" "$reason_b64" "$state" "$recovery_test_hook"
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
