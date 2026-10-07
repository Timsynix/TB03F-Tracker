#!/usr/bin/env python3
"""
Verify TB-03F firmware images and (optionally) write the web catalog index.json.
Pure Python; safe to run on Windows.

  # check any .bin files / folders (header, size field, CRC trailer, key-slot marker)
  python scripts/verify_bins.py web/firmware

  # CI: turn the generator's build-manifest.json into web/firmware/index.json
  python scripts/verify_bins.py --manifest web/firmware/build-manifest.json --write-index web/firmware/index.json
"""

import argparse
import datetime
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fwimage  # noqa: E402
import fwpatch  # noqa: E402

CATALOG_SCHEMA = 1
PARAM_KEYS = ("adv_interval_ms", "power", "battery", "rotation_min")


def iter_bins(paths):
    for p in map(Path, paths):
        if p.is_dir():
            yield from sorted(p.rglob("*.bin"))
        else:
            yield p


def scan(paths, marker) -> int:
    failed = 0
    for bin_path in iter_bins(paths):
        info = fwimage.check_variant(bin_path, marker)
        status = "OK  " if not info["problems"] else "FAIL"
        failed += bool(info["problems"])
        slot = info["marker_offsets"][0] if len(info["marker_offsets"]) == 1 else "-"
        print(f"{status} {bin_path}  size={info['size']} slot={slot}  {'; '.join(info['problems'])}")
    print(f"\n{failed} failing image(s)")
    return 1 if failed else 0


def battery_param(cfg):
    return cfg["battery_days"] if cfg["send_battery"] else "off"


def build_index(manifest_path: Path, marker: bytes) -> dict:
    manifest = json.loads(manifest_path.read_text())
    base = manifest_path.parent
    variants, errors = [], []
    for entry in manifest["variants"]:
        bin_path = base / entry["file"]
        info = fwimage.check_variant(bin_path, marker)
        if info["problems"]:
            errors.append(f"{entry['file']}: {'; '.join(info['problems'])}")
            continue
        cfg = entry["config"]
        variants.append({
            "id": entry["id"],
            "file": entry["file"],
            "config": {
                "adv_interval_ms": cfg["adv_interval_ms"],
                "power": cfg["power"],
                "send_battery": cfg["send_battery"],
                "battery_days": cfg["battery_days"] if cfg["send_battery"] else None,
                "rotation_min": cfg["rotation_min"],
            },
            "size": info["size"],
            "sha256": info["sha256"],
            "key_offset": info["marker_offsets"][0],
        })
    if errors:
        raise SystemExit("index.json not written, invalid images:\n  " + "\n  ".join(errors))

    def values(fn):
        return sorted({fn(v["config"]) for v in variants}, key=lambda x: (isinstance(x, str), x))

    return {
        "schema": CATALOG_SCHEMA,
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "source_commit": manifest.get("source_commit"),
        "marker_hex": marker.hex(),
        "key_len": fwpatch.KEY_LEN,
        "num_keys": fwpatch.NUM_KEYS,
        "params": {
            "adv_interval_ms": values(lambda c: c["adv_interval_ms"]),
            "power": values(lambda c: c["power"]),
            "battery": values(battery_param),
            "rotation_min": values(lambda c: c["rotation_min"]),
        },
        "variants": variants,
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="*", help=".bin files or folders to check")
    ap.add_argument("--manifest", type=Path, help="build-manifest.json written by generate_firmware_variants.py")
    ap.add_argument("--write-index", type=Path, help="where to write the catalog index.json")
    ap.add_argument("--marker-hex", help="override the key-slot marker (default: fwpatch.keyslot_marker())")
    args = ap.parse_args(argv)

    marker = bytes.fromhex(args.marker_hex) if args.marker_hex else fwpatch.keyslot_marker()

    if args.manifest:
        index = build_index(args.manifest, marker)
        out = args.write_index or args.manifest.with_name("index.json")
        out.write_text(json.dumps(index, indent=2) + "\n")
        print(f"wrote {out} ({len(index['variants'])} variants)")
        return 0
    if not args.paths:
        ap.error("give .bin paths to check, or --manifest")
    return scan(args.paths, marker)


if __name__ == "__main__":
    sys.exit(main())
