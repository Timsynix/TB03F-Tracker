import struct
import sys
import unittest
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

import fwimage  # noqa: E402
import fwpatch  # noqa: E402


def synthetic_image(body_len=4000, marker_at=3000, marker=None):
    """Header + filler + marker + CRC trailer, laid out like a tc32 image (not real firmware)."""
    marker = marker or fwpatch.keyslot_marker()
    data = bytearray((i * 7 + 3) & 0xFF for i in range(body_len))
    data[0x08:0x0C] = b"KNLT"
    data[marker_at:marker_at + len(marker)] = marker
    struct.pack_into("<I", data, 0x18, body_len)
    return bytes(data) + struct.pack(">I", zlib.crc32(data) & 0xFFFFFFFF)


class InspectTest(unittest.TestCase):
    def test_valid_image(self):
        info = fwimage.inspect(synthetic_image(), fwpatch.keyslot_marker())
        self.assertEqual(fwimage.problems(info), [])
        self.assertEqual(info["marker_offsets"], [3000])

    def test_bad_crc_and_size(self):
        img = bytearray(synthetic_image())
        img[100] ^= 0xFF
        struct.pack_into("<I", img, 0x18, 1)
        probs = fwimage.problems(fwimage.inspect(bytes(img), fwpatch.keyslot_marker()))
        self.assertTrue(any("CRC" in p for p in probs))
        self.assertTrue(any("size field" in p for p in probs))

    def test_marker_count(self):
        marker = fwpatch.keyslot_marker()
        img = bytearray(synthetic_image())
        img[200:200 + len(marker)] = marker
        probs = fwimage.problems(fwimage.inspect(bytes(img[:-4]) + fwimage.crc_trailer(bytes(img)), marker))
        self.assertIn("key-slot marker found 2 times", probs)

    def test_lst_section_parse(self):
        self.assertEqual(fwimage.public_keys_section("00844a80 l     O .bss\t00000054 public_keys\n"), ".bss")
        self.assertEqual(fwimage.public_keys_section("00841f00 l     O .data\t00000054 public_keys\n"), ".data")
        self.assertIsNone(fwimage.public_keys_section("nothing here"))

    def test_zero_key_build_is_rejected(self):
        img = synthetic_image(marker=bytes(84))   # all-zero "keys": what a zero-initialised build would contain
        probs = fwimage.problems(fwimage.inspect(img, fwpatch.keyslot_marker()))
        self.assertEqual(probs, ["key-slot marker not found (zero-key build? public_keys in .bss)"])


if __name__ == "__main__":
    unittest.main()
