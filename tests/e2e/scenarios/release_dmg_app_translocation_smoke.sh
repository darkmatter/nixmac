#!/bin/bash
# =============================================================================
# Scenario: release_dmg_app_translocation_smoke
#
# Verifies the installed app launches from /Applications and renders a usable
# first screen without App Translocation / updater / startup crashes.
# =============================================================================

E2E_ADAPTER="nixmac"
E2E_FIXTURE="clean-machine"

latest_screenshot_for() {
    local prefix="$1"
    find "$E2E_SCREENSHOT_DIR" -maxdepth 1 -type f \
        -name "${prefix}-*.png" ! -name "*_annotated.png" 2>/dev/null \
        | sort \
        | tail -1
}

assert_png_region_has_light_detail() {
    local image="$1"
    local x0="$2"
    local y0="$3"
    local x1="$4"
    local y1="$5"
    local minimum_pixels="$6"
    local label="$7"

    python3 - "$image" "$x0" "$y0" "$x1" "$y1" "$minimum_pixels" "$label" <<'PY'
import struct
import sys
import zlib

image, x0, y0, x1, y1, minimum, label = sys.argv[1:]
x0, y0, x1, y1 = map(float, (x0, y0, x1, y1))
minimum = int(minimum)

data = open(image, "rb").read()
if not data.startswith(b"\x89PNG\r\n\x1a\n"):
    print(f"{label}: not a PNG: {image}", file=sys.stderr)
    sys.exit(1)

offset = 8
width = height = bit_depth = color_type = None
payload = bytearray()
while offset < len(data):
    length = struct.unpack(">I", data[offset:offset + 4])[0]
    kind = data[offset + 4:offset + 8]
    body = data[offset + 8:offset + 8 + length]
    offset += 12 + length
    if kind == b"IHDR":
        width, height, bit_depth, color_type, _, _, _ = struct.unpack(">IIBBBBB", body)
    elif kind == b"IDAT":
        payload.extend(body)
    elif kind == b"IEND":
        break

if bit_depth != 8 or color_type not in (2, 6):
    print(f"{label}: unsupported PNG format bit_depth={bit_depth} color_type={color_type}", file=sys.stderr)
    sys.exit(1)

channels = 4 if color_type == 6 else 3
stride = width * channels
raw = zlib.decompress(bytes(payload))
rows = []
cursor = 0
previous = bytearray(stride)

for _ in range(height):
    filter_type = raw[cursor]
    cursor += 1
    current = bytearray(raw[cursor:cursor + stride])
    cursor += stride
    for index in range(stride):
        left = current[index - channels] if index >= channels else 0
        up = previous[index]
        up_left = previous[index - channels] if index >= channels else 0
        if filter_type == 1:
            current[index] = (current[index] + left) & 0xFF
        elif filter_type == 2:
            current[index] = (current[index] + up) & 0xFF
        elif filter_type == 3:
            current[index] = (current[index] + ((left + up) // 2)) & 0xFF
        elif filter_type == 4:
            predictor = left + up - up_left
            pa = abs(predictor - left)
            pb = abs(predictor - up)
            pc = abs(predictor - up_left)
            current[index] = (current[index] + (left if pa <= pb and pa <= pc else up if pb <= pc else up_left)) & 0xFF
        elif filter_type != 0:
            print(f"{label}: unsupported PNG filter {filter_type}", file=sys.stderr)
            sys.exit(1)
    rows.append(current)
    previous = current

left = max(0, min(width, int(width * x0)))
right = max(left + 1, min(width, int(width * x1)))
top = max(0, min(height, int(height * y0)))
bottom = max(top + 1, min(height, int(height * y1)))

light_pixels = 0
for y in range(top, bottom):
    row = rows[y]
    for x in range(left, right):
        base = x * channels
        r, g, b = row[base], row[base + 1], row[base + 2]
        alpha = row[base + 3] if channels == 4 else 255
        luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
        if alpha > 128 and luminance > 180:
            light_pixels += 1

if light_pixels < minimum:
    print(f"{label}: only {light_pixels} light pixels in expected region; need {minimum}", file=sys.stderr)
    sys.exit(1)
PY
}

scenario_test() {
    phase "Fixture: app installed"
    peekaboo_check
    nixmac_clear_state
    if [ ! -d "$NIXMAC_APP_PATH" ]; then
        die "App not found at $NIXMAC_APP_PATH"
    fi
    phase_pass "App installed at $NIXMAC_APP_PATH"

    phase "Launch nixmac app"
    nixmac_launch || die "App failed to launch"
    nixmac_screenshot "01-launched"
    local launch_screen
    launch_screen="$(latest_screenshot_for "01-launched")"
    phase_pass "App launched"

    phase "Verify first screen"
    local text
    text=$(nixmac_text)
    if echo "$text" | grep -qiE "install|nix|configuration|settings|browse|host|welcome|get started"; then
        phase_pass "First screen rendered"
    else
        nixmac_screenshot "unexpected-first-screen"
        die "First screen did not contain expected nixmac text"
    fi
    if ! echo "$text" | grep -qi "nixmac needs"; then
        nixmac_screenshot "missing-nixmac-identity-copy"
        die "First screen did not contain visible nixmac setup identity copy"
    fi
    if [ -z "$launch_screen" ] || [ ! -s "$launch_screen" ]; then
        nixmac_screenshot "missing-launch-screenshot"
        die "Launch screenshot was unavailable for first-screen identity check"
    fi
    if ! assert_png_region_has_light_detail "$launch_screen" 0.44 0.28 0.56 0.38 24 "nixmac setup identity icon"; then
        nixmac_screenshot "missing-nixmac-identity-icon"
        die "First screen did not show the nixmac setup identity icon"
    fi
}

scenario_cleanup() {
    nixmac_quit
}
