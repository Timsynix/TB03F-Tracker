"""
Telink TLSR825x firmware image checks (pure Python, runs on Windows).

Image layout, as produced by tc32-elf-objcopy + SDK/make/tl_firmware_tools.py add_crc:
  0x08      b"KNLT" boot marker
  0x18      u32 LE image size excluding the CRC trailer (= file length - 4)
  len-4     CRC-32 (zlib) of bytes [0, len-4), stored big-endian
"""

import hashlib
import re
import struct
import zlib
from pathlib import Path

MAGIC = b"KNLT"
MAGIC_OFFSET = 0x08
SIZE_OFFSET = 0x18


def crc_trailer(data: bytes) -> bytes:
    return struct.pack(">I", zlib.crc32(data[:-4]) & 0xFFFFFFFF)


def find_all(data: bytes, needle: bytes) -> list:
    hits, start = [], 0
    while (i := data.find(needle, start)) != -1:
        hits.append(i)
        start = i + 1
    return hits


def inspect(data: bytes, marker: bytes | None = None) -> dict:
    info = {
        "size": len(data),
        "magic_ok": len(data) >= 0x20 and data[MAGIC_OFFSET:MAGIC_OFFSET + 4] == MAGIC,
        "size_field": struct.unpack_from("<I", data, SIZE_OFFSET)[0] if len(data) >= 0x1C else None,
        "crc_ok": len(data) > 4 and data[-4:] == crc_trailer(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }
    info["size_ok"] = info["size_field"] == len(data) - 4
    if marker is not None:
        info["marker_offsets"] = find_all(data, marker)
    return info


def problems(info: dict) -> list:
    out = []
    if not info["magic_ok"]:
        out.append("no KNLT marker at 0x08")
    if not info["size_ok"]:
        out.append(f"size field {info['size_field']} != file length - 4 ({info['size'] - 4})")
    if not info["crc_ok"]:
        out.append("CRC-32 trailer mismatch")
    offsets = info.get("marker_offsets")
    if offsets is not None and len(offsets) != 1:
        out.append("key-slot marker not found (zero-key build? public_keys in .bss)" if not offsets
                   else f"key-slot marker found {len(offsets)} times")
    return out


def public_keys_section(lst_text: str) -> str | None:
    """Section of the public_keys symbol in a tc32-elf-objdump -x listing ('.data', '.bss', ...)."""
    m = re.search(r"^[0-9a-f]+\s+l\s+O\s+(\S+)\s+[0-9a-f]+\s+public_keys\s*$", lst_text, re.M)
    return m.group(1) if m else None


def check_variant(bin_path: Path, marker: bytes, lst_path: Path | None = None) -> dict:
    data = bin_path.read_bytes()
    info = inspect(data, marker)
    errs = problems(info)
    if lst_path is not None and lst_path.exists():
        section = public_keys_section(lst_path.read_text(errors="replace"))
        info["public_keys_section"] = section
        if section != ".data":
            errs.append(f"public_keys is in {section!r}, expected '.data'")
    info["problems"] = errs
    return info
