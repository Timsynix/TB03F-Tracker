#!/usr/bin/env python3
"""
Build the TB-03F firmware variant catalog for the web flasher (Linux + tc32 toolchain).

Every variant is compiled from the pristine upstream app.c with:
  - the BUILD_CONFIG transformation in scripts/fwpatch.py (parameters + power fixes),
  - a non-zero 84-byte key-slot marker in public_keys, so the array stays in .data
    (= in the flash image) and the browser can find and replace it,
  - MY_ADV_INTERVAL = round(ms / 0.625).

Output (default web/firmware/): <id>.bin, build-manifest.json, index.json.

  python3 scripts/generate_firmware_variants.py --list         # print the matrix, no build (safe anywhere)
  python3 scripts/generate_firmware_variants.py --patch-only   # write patched app.c per variant, no make
  python3 scripts/generate_firmware_variants.py                # full build (Linux, /opt/tc32/bin)
"""

import argparse
import itertools
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fwimage  # noqa: E402
import fwpatch  # noqa: E402
import verify_bins  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
BUILD_TREE_SENTINEL = ".tb03f-build-tree"

# battery: None = no battery status in the advertisement, N = measure every N days
MATRIX = {
    "adv_interval_ms": [100, 500, 1000, 2000],
    "power": ["RF_POWER_P10p29dBm", "RF_POWER_P0p04dBm"],
    "battery": [None, 1, 7, 14],
    "rotation_min": [2, 10, 30],
}


def matrix_configs():
    for adv, power, battery, rot in itertools.product(*MATRIX.values()):
        yield fwpatch.validate_config({
            "adv_interval_ms": adv,
            "power": power,
            "send_battery": battery is not None,
            "battery_days": battery or 1,   # unused when battery is off; fixed so builds are reproducible
            "rotation_min": rot,
        })


def prepare_build_tree(upstream: Path, build_dir: Path):
    if build_dir.exists():
        if not (build_dir / BUILD_TREE_SENTINEL).exists():
            raise SystemExit(f"{build_dir} exists and is not a generated build tree; refusing to delete it")
        shutil.rmtree(build_dir)
    shutil.copytree(upstream, build_dir, ignore=shutil.ignore_patterns(".git", ".vscode", "out", "output"))
    (build_dir / BUILD_TREE_SENTINEL).write_text("created by generate_firmware_variants.py\n")


def source_commit(upstream: Path):
    try:
        return subprocess.run(["git", "-C", str(upstream), "rev-parse", "HEAD"],
                              capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def build_one(build_dir: Path, app_c: str, toolchain: str) -> Path:
    (build_dir / "app.c").write_text(app_c, newline="\n")
    out = build_dir / "out"
    for name in ("app.o", "FindMy.elf", "FindMy.bin", "FindMy.lst"):
        (out / name).unlink(missing_ok=True)
    env = dict(os.environ, PATH=f"{toolchain}{os.pathsep}{os.environ.get('PATH', '')}")
    # serial make: the SDK's "all: pre-build main-build" creates out/ subdirs in pre-build, which -j would race
    result = subprocess.run(["make"], cwd=build_dir, env=env, capture_output=True, text=True)
    if result.returncode != 0:
        tail = "\n".join((result.stdout + result.stderr).splitlines()[-40:])
        raise RuntimeError(f"make failed:\n{tail}")
    return out / "FindMy.bin"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--upstream", type=Path, default=ROOT / "build" / "upstream",
                    help="pristine TB-03F-OpenHaystack-Firmware checkout (default: build/upstream, "
                         "cloned by scripts/build_catalog.sh)")
    ap.add_argument("--build-dir", type=Path, default=ROOT / "build" / "tb03f")
    ap.add_argument("--out", type=Path, default=ROOT / "web" / "firmware")
    ap.add_argument("--toolchain", default="/opt/tc32/bin")
    ap.add_argument("--only", nargs="+", metavar="ID", help="build only these variant ids")
    ap.add_argument("--list", action="store_true", help="print the variant matrix and exit")
    ap.add_argument("--patch-only", action="store_true",
                    help="write patched app.c per variant to <build-dir>/patched/ without running make")
    args = ap.parse_args(argv)

    configs = list(matrix_configs())
    if args.only:
        wanted = set(args.only)
        configs = [c for c in configs if fwpatch.variant_id(c) in wanted]
        missing = wanted - {fwpatch.variant_id(c) for c in configs}
        if missing:
            raise SystemExit(f"unknown variant id(s): {', '.join(sorted(missing))}")

    if args.list:
        for cfg in configs:
            print(f"{fwpatch.variant_id(cfg):32s} MY_ADV_INTERVAL={fwpatch.adv_units(cfg['adv_interval_ms'])}")
        print(f"{len(configs)} variants")
        return 0

    pristine = (args.upstream / "app.c").read_text()
    marker = fwpatch.keyslot_marker()

    if args.patch_only:
        patched_dir = args.build_dir / "patched"
        patched_dir.mkdir(parents=True, exist_ok=True)
        for cfg in configs:
            text = fwpatch.apply_keys(fwpatch.apply_config(pristine, cfg), marker)
            (patched_dir / f"{fwpatch.variant_id(cfg)}.c").write_text(text, newline="\n")
        print(f"wrote {len(configs)} patched sources to {patched_dir}")
        return 0

    prepare_build_tree(args.upstream, args.build_dir)
    args.out.mkdir(parents=True, exist_ok=True)
    for stale in [*args.out.glob("*.bin"), args.out / "index.json", args.out / "build-manifest.json"]:
        stale.unlink(missing_ok=True)

    entries, failures = [], []
    for i, cfg in enumerate(configs, 1):
        vid = fwpatch.variant_id(cfg)
        print(f"[{i}/{len(configs)}] {vid}", flush=True)
        try:
            text = fwpatch.apply_keys(fwpatch.apply_config(pristine, cfg), marker)
            bin_path = build_one(args.build_dir, text, args.toolchain)
            info = fwimage.check_variant(bin_path, marker, bin_path.with_suffix(".lst"))
            if info.get("public_keys_section") is None:
                info["problems"].append("FindMy.lst missing or has no public_keys symbol")
            if info["problems"]:
                raise RuntimeError("; ".join(info["problems"]))
            shutil.copy2(bin_path, args.out / f"{vid}.bin")
            entries.append({"id": vid, "file": f"{vid}.bin", "config": cfg})
            print(f"    {info['size']} bytes, key slot at 0x{info['marker_offsets'][0]:X}")
        except Exception as e:  # keep going so one bad config doesn't hide the others
            failures.append(vid)
            print(f"    FAILED: {e}", file=sys.stderr)

    manifest = {"source_commit": source_commit(args.upstream), "variants": entries}
    manifest_path = args.out / "build-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    if failures:
        print(f"\n{len(failures)} variant(s) failed: {', '.join(failures)}", file=sys.stderr)
        return 1
    return verify_bins.main(["--manifest", str(manifest_path), "--write-index", str(args.out / "index.json")])


if __name__ == "__main__":
    sys.exit(main())
