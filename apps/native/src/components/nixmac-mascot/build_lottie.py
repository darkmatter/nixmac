#!/usr/bin/env python3
"""
Generate nixmac-mascot.json — a real, portable Lottie animation — from the rigged
SVG (nixmac-mascot.svg). Converts the SVG to Lottie shapes, then bakes keyframes:

  idle (always):  eyes blink · smile breathes · blush + circuits pulse
  intermittent:   the whole mascot crouches, hops, does a 360 spin, and lands

The hop rides on the *layer* transform, so the frame + face move as one unit while
the idle channels keep animating underneath. "Intermittent" just means one hop per
loop — LOOP_S sets how often it fires.

No system install needed; run through uv with an ephemeral env:

    uv run --python 3.12 --with lottie python build_lottie.py

Output is a standard Lottie .json (lottie-web, lottie-react, dotLottie, iOS/Android).
"""
import os
from lottie.parsers.svg import parse_svg_file
from lottie.exporters.core import export_lottie
from lottie.objects import easing

HERE = os.path.dirname(os.path.abspath(__file__))
SVG = os.path.join(HERE, "nixmac-mascot.svg")
OUT = os.path.join(HERE, "nixmac-mascot.json")

# Canvas centre (viewBox is 441 x 406) — the pivot the mascot spins about.
CX, CY = 220.5, 203.0

# ──────────────────────────────────────────────────────────────────────────
# TUNE THE PERSONALITY HERE  ← the part that's yours to shape.
# Re-run after editing to regenerate the Lottie.
# ──────────────────────────────────────────────────────────────────────────
FPS = 60            # frame rate
LOOP_S = 8.0        # loop length (s) == how often the hop fires. Bigger = rarer.

# idle channels
BLINK_AT = [0.30, 0.55]   # blink moments, as fractions of the loop
BLINK_CLOSE = 8           # eye height % at peak blink (0 = fully shut)
SMILE_RISE = 4            # px the smile lifts at its breathe peak
BLUSH_DIM = 80            # blush opacity % at its dimmest
PULSE_DIM = 35            # circuit opacity % between pulses
PULSES = 3                # circuit pulses per loop

# the hop + spin (one event per loop, inside this window)
JUMP_WINDOW = (0.68, 0.95)  # start/end of the hop, as fractions of the loop
JUMP_HEIGHT = 72            # px the mascot rises at the peak
CROUCH = 10                 # px it dips first (anticipation)
SQUASH = 13                 # % deformation on crouch/landing (0 = rigid hop)
STRETCH = 13                # % deformation on takeoff/rebound
SPIN_DEG = 360              # spin during the hop (360 = one full flip; keep a multiple of 360)
# ── end personality block ──

TOTAL = int(FPS * LOOP_S)
EASE = easing.Sigmoid()
EZ_IN = easing.EaseIn()
EZ_OUT = easing.EaseOut()


def find(obj, name):
    for attr in ("layers", "shapes"):
        for child in getattr(obj, attr, []) or []:
            if getattr(child, "name", None) == name:
                return child
            hit = find(child, name)
            if hit:
                return hit
    return None


def center(group):
    bb = group.bounding_box(0)
    return (bb.x1 + bb.x2) / 2.0, (bb.y1 + bb.y2) / 2.0


def pivot(group):
    cx, cy = center(group)
    group.transform.anchor_point.value = [cx, cy]
    group.transform.position.value = [cx, cy]
    return cx, cy


def kf(prop, items):
    """items: list of (frame, value[, easing]) — easing defaults to Sigmoid."""
    for item in items:
        t, v = item[0], item[1]
        e = item[2] if len(item) > 2 else EASE
        prop.add_keyframe(t, v, e)


def add_idle(anim):
    for name in ("eye-left", "eye-right"):
        g = find(anim, name)
        pivot(g)
        frames = [(0, [100, 100])]
        for at in BLINK_AT:
            t = at * TOTAL
            frames += [(t - 5, [100, 100]), (t, [100, BLINK_CLOSE]), (t + 5, [100, 100])]
        frames += [(TOTAL, [100, 100])]
        kf(g.transform.scale, frames)

    g = find(anim, "smile")
    cx, cy = pivot(g)
    kf(g.transform.position, [(0, [cx, cy]), (0.5 * TOTAL, [cx, cy + SMILE_RISE]), (TOTAL, [cx, cy])])

    for name in ("blush-left", "blush-right"):
        g = find(anim, name)
        kf(g.transform.opacity, [(0, BLUSH_DIM), (0.5 * TOTAL, 100), (TOTAL, BLUSH_DIM)])

    g = find(anim, "circuits")
    frames = [(0, PULSE_DIM)]
    for i in range(PULSES):
        frames += [((i + 0.5) / PULSES * TOTAL, 100), ((i + 1) / PULSES * TOTAL, PULSE_DIM)]
    kf(g.transform.opacity, frames)


def add_hop(layer):
    """Hop + spin on the whole-layer transform, pivoting about the canvas centre."""
    layer.transform.anchor_point.value = [CX, CY]
    j0, j1 = (f * TOTAL for f in JUMP_WINDOW)

    def at(f):  # fraction within the hop window -> absolute frame
        return j0 + f * (j1 - j0)

    S, T = SQUASH, STRETCH

    # vertical arc: crouch down, spring up to peak (decelerate), fall (accelerate), land
    kf(layer.transform.position, [
        (0, [CX, CY]),
        (j0, [CX, CY]),
        (at(0.12), [CX, CY + CROUCH], EZ_OUT),          # anticipation dip
        (at(0.24), [CX, CY - JUMP_HEIGHT * 0.2], EZ_OUT),
        (at(0.50), [CX, CY - JUMP_HEIGHT], EZ_IN),      # peak
        (at(0.78), [CX, CY - JUMP_HEIGHT * 0.15], EZ_IN),
        (at(0.86), [CX, CY], EZ_OUT),                   # touchdown
        (at(1.00), [CX, CY], EZ_OUT),
        (TOTAL, [CX, CY]),
    ])

    # squash & stretch: wide-short on crouch/land, tall-thin on takeoff/rebound
    kf(layer.transform.scale, [
        (0, [100, 100]),
        (j0, [100, 100]),
        (at(0.12), [100 + S, 100 - S], EZ_OUT),         # crouch squash
        (at(0.24), [100 - T, 100 + T], EZ_OUT),         # takeoff stretch
        (at(0.46), [100, 100]),
        (at(0.82), [100, 100]),
        (at(0.86), [100 + round(S * 1.3), 100 - round(S * 1.3)], EZ_OUT),  # land squash
        (at(0.93), [100 - round(T * 0.4), 100 + round(T * 0.4)], EZ_OUT),  # rebound
        (at(1.00), [100, 100]),
        (TOTAL, [100, 100]),
    ])

    # the spin: hold, then a smooth full turn during the airborne span, then hold
    # (ends on SPIN_DEG; the loop reset to 0 is visually identical mod 360)
    kf(layer.transform.rotation, [
        (0, 0),
        (at(0.20), 0),
        (at(0.86), SPIN_DEG),
        (TOTAL, SPIN_DEG),
    ])


def main():
    anim = parse_svg_file(SVG)
    anim.frame_rate = FPS
    anim.in_point = 0
    anim.out_point = TOTAL
    for layer in anim.layers:
        layer.in_point, layer.out_point = 0, TOTAL

    add_idle(anim)
    for layer in anim.layers:
        add_hop(layer)

    export_lottie(anim, OUT)
    print(f"OK -> {OUT}  ({os.path.getsize(OUT)} bytes, {TOTAL} frames @ {FPS}fps, hop @ {JUMP_WINDOW})")


if __name__ == "__main__":
    main()
