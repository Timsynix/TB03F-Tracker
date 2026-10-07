#!/usr/bin/env python3
"""
Write a development catalog of SYNTHETIC images to web/dev-fixture/ so the web UI can be exercised
without real firmware. The images only mimic the layout (KNLT header, size field, key-slot marker,
CRC trailer); they are not firmware. index.json carries "dev": true, which disables flashing in the UI.

  python scripts/make_dev_fixture.py
  python scripts/make_standalone.py --catalog web/dev-fixture --out dist/TB03F-Flasher-DEV.html
"""

import argparse
import hashlib
import json
import struct
import sys
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fwpatch  # noqa: E402
import generate_firmware_variants as gen  # noqa: E402
import verify_bins  # noqa: E402



def synthetic_image(seed: str, size: int) -> bytes:
    stream = b""
    while len(stream) < size:
        stream += hashlib.sha256(f"{seed}/{len(stream)}".encode()).digest()
    data = bytearray(stream[:size - 4])
    data[0x08:0x0C] = b"KNLT"
    struct.pack_into("<I", data, 0x18, size - 4)
    slot = size - 4 - fwpatch.SLOT_LEN  # like real builds: public_keys is the last .data item before the CRC
    data[slot:slot + fwpatch.SLOT_LEN] = fwpatch.keyslot_marker()
    return bytes(data) + struct.pack(">I", zlib.crc32(data) & 0xFFFFFFFF)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=gen.ROOT / "web" / "dev-fixture")
    OUT = ap.parse_args(argv).out
    OUT.mkdir(parents=True, exist_ok=True)
    for stale in OUT.glob("*.bin"):
        stale.unlink()
    entries = []
    for cfg in gen.matrix_configs():
        # leave some combinations out so the UI's "(not built)" handling is visible
        if cfg["adv_interval_ms"] == 100 or (cfg["adv_interval_ms"] == 500 and cfg["power"] == "RF_POWER_P10p29dBm"):
            continue
        vid = fwpatch.variant_id(cfg)
        size = 22808 if cfg["send_battery"] else 22696
        (OUT / f"{vid}.bin").write_bytes(synthetic_image(vid, size))
        entries.append({"id": vid, "file": f"{vid}.bin", "config": cfg})

    manifest = OUT / "build-manifest.json"
    manifest.write_text(json.dumps({"source_commit": None, "variants": entries}, indent=2))
    index = verify_bins.build_index(manifest, fwpatch.keyslot_marker())
    index["dev"] = True
    (OUT / "index.json").write_text(json.dumps(index, indent=2) + "\n")
    print(f"wrote {len(entries)} synthetic images + index.json to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
