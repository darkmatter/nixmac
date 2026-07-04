#!/usr/bin/env python3
"""Write deterministic Finder layout metadata (.DS_Store) for the nixmac DMG.

Runs against the *mounted read-write* DMG volume. Builds the same records
dmgbuild produces: window shape (bwsp), icon-view options with a picture
background (icvp, backgroundType 2 + backgroundImageAlias), and icon
positions (Iloc). The alias is generated against the mounted volume so Finder
can resolve the background image on end-user machines.

Usage: write-dmg-ds-store.py <mount-point> <app-name>
Requires: python3 with ds-store and mac-alias (provided via nix shell in CI).
"""

import plistlib
import struct
import sys
from pathlib import Path

from ds_store import DSStore, DSStoreEntry
from mac_alias import Alias

WINDOW = {"x": 100, "y": 100, "width": 660, "height": 400}
APP_POSITION = (180, 170)
APPLICATIONS_POSITION = (480, 170)
ICON_SIZE = 128.0
TEXT_SIZE = 12.0
BACKGROUND_RELATIVE = ".background/dmg-background.png"


def main() -> int:
    if len(sys.argv) != 3:
        print(f"usage: {sys.argv[0]} <mount-point> <app-name>", file=sys.stderr)
        return 2

    mount_point = Path(sys.argv[1])
    app_name = sys.argv[2]

    background = mount_point / BACKGROUND_RELATIVE
    if not background.is_file():
        print(f"ERROR: missing background image: {background}", file=sys.stderr)
        return 2
    if not (mount_point / app_name).is_dir():
        print(f"ERROR: missing app bundle: {mount_point / app_name}", file=sys.stderr)
        return 2

    alias = Alias.for_file(str(background))

    bwsp = {
        "ShowStatusBar": False,
        "ShowToolbar": False,
        "ShowTabView": False,
        "ContainerShowSidebar": False,
        "ShowSidebar": False,
        "ShowPathbar": False,
        "WindowBounds": "{{%d, %d}, {%d, %d}}"
        % (WINDOW["x"], WINDOW["y"], WINDOW["width"], WINDOW["height"]),
    }

    icvp = {
        "viewOptionsVersion": 1,
        "backgroundType": 2,
        "backgroundColorRed": 1.0,
        "backgroundColorGreen": 1.0,
        "backgroundColorBlue": 1.0,
        "backgroundImageAlias": alias.to_bytes(),
        "showIconPreview": True,
        "showItemInfo": False,
        "arrangeBy": "none",
        "gridOffsetX": 0.0,
        "gridOffsetY": 0.0,
        "gridSpacing": 100.0,
        "labelOnBottom": True,
        "textSize": TEXT_SIZE,
        "iconSize": ICON_SIZE,
        "scrollPositionX": 0.0,
        "scrollPositionY": 0.0,
    }

    ds_path = mount_point / ".DS_Store"
    if ds_path.exists():
        ds_path.unlink()

    with DSStore.open(str(ds_path), "w+") as store:
        store.insert(DSStoreEntry(".", b"vSrn", b"long", 1))
        store.insert(
            DSStoreEntry(
                ".",
                b"bwsp",
                b"blob",
                plistlib.dumps(bwsp, fmt=plistlib.FMT_BINARY),
            )
        )
        store.insert(
            DSStoreEntry(
                ".",
                b"icvp",
                b"blob",
                plistlib.dumps(icvp, fmt=plistlib.FMT_BINARY),
            )
        )
        store.insert(DSStoreEntry(app_name, b"Iloc", b"blob", _iloc(APP_POSITION)))
        store.insert(
            DSStoreEntry("Applications", b"Iloc", b"blob", _iloc(APPLICATIONS_POSITION))
        )

    # Read back and assert the picture-background record really landed.
    with DSStore.open(str(ds_path), "r") as store:
        records = {(rec.filename, rec.code): rec.value for rec in store}

    icvp_value = records.get((".", b"icvp"))
    if not isinstance(icvp_value, dict):
        print("ERROR: .DS_Store icvp record missing after write", file=sys.stderr)
        return 2
    if icvp_value.get("backgroundType") != 2:
        print(
            f"ERROR: icvp backgroundType is {icvp_value.get('backgroundType')!r}, expected 2 (picture)",
            file=sys.stderr,
        )
        return 2
    alias_bytes = icvp_value.get("backgroundImageAlias")
    if not alias_bytes:
        print("ERROR: icvp backgroundImageAlias missing", file=sys.stderr)
        return 2
    parsed = Alias.from_bytes(bytes(alias_bytes))
    target = parsed.target.filename.decode() if isinstance(parsed.target.filename, bytes) else parsed.target.filename
    if target != "dmg-background.png":
        print(f"ERROR: alias target is {target!r}, expected dmg-background.png", file=sys.stderr)
        return 2
    for key in ((app_name, b"Iloc"), ("Applications", b"Iloc")):
        if key not in records:
            print(f"ERROR: missing Iloc record for {key[0]}", file=sys.stderr)
            return 2

    print(
        "Wrote Finder layout metadata: background=picture(dmg-background.png), "
        f"{app_name}={APP_POSITION}, Applications={APPLICATIONS_POSITION}"
    )
    return 0


def _iloc(position: tuple[int, int]) -> bytes:
    # Byte layout must match ds_store.ILocCodec.encode (what Finder/dmgbuild
    # write): x, y, 0xFFFFFFFF, 0xFFFF0000 as big-endian u32s.
    x, y = position
    return struct.pack(">IIII", x, y, 0xFFFFFFFF, 0xFFFF0000)


if __name__ == "__main__":
    raise SystemExit(main())
