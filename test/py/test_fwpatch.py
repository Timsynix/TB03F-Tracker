import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

import fwpatch  # noqa: E402
import generate_firmware_variants as gen  # noqa: E402

UPSTREAM_APP_C = ROOT / "build" / "upstream" / "app.c"   # cloned by scripts/build_catalog.sh

CFG = {"adv_interval_ms": 1000, "power": "RF_POWER_P0p04dBm", "send_battery": True,
       "battery_days": 7, "rotation_min": 10}


class MarkerTest(unittest.TestCase):
    def test_marker_shape(self):
        m = fwpatch.keyslot_marker()
        self.assertEqual(len(m), 84)
        self.assertTrue(m.startswith(b"TB03F-KEYSLOT-v1"))
        self.assertEqual(m, fwpatch.keyslot_marker())
        self.assertGreater(len(set(m)), 40)

    def test_adv_units(self):
        self.assertEqual(fwpatch.adv_units(100), 160)
        self.assertEqual(fwpatch.adv_units(2000), 3200)
        self.assertEqual(fwpatch.adv_units(625), 1000)


class ConfigTest(unittest.TestCase):
    def test_validation(self):
        for bad in ({"adv_interval_ms": 10}, {"rotation_min": 5}, {"battery_days": 91}, {"power": "10dBm"}):
            with self.assertRaises(ValueError):
                fwpatch.validate_config({**CFG, **bad})

    def test_variant_ids(self):
        self.assertEqual(fwpatch.variant_id(CFG), "adv1000_p0p04_bat7d_rot10")
        self.assertEqual(fwpatch.variant_id({**CFG, "send_battery": False}), "adv1000_p0p04_batoff_rot10")
        ids = [fwpatch.variant_id(c) for c in gen.matrix_configs()]
        self.assertEqual(len(ids), 96)
        self.assertEqual(len(set(ids)), 96)


@unittest.skipUnless(UPSTREAM_APP_C.exists(), "upstream firmware not checked out (run scripts/build_catalog.sh --list)")
class UpstreamPatchTest(unittest.TestCase):
    def setUp(self):
        self.pristine = UPSTREAM_APP_C.read_text()

    def test_config_applied(self):
        out = fwpatch.apply_config(self.pristine, CFG)
        self.assertIn("#define MY_ADV_INTERVAL       1600 /* 1000 ms */", out)
        self.assertIn("#define MY_RF_POWER_INDEX     RF_POWER_P0p04dBm", out)
        self.assertIn("#define BATTERY_UPDATE_DAYS   7", out)
        self.assertIn("#define KEY_ROTATION_MINUTES  10", out)
        self.assertNotIn("ADV_INTERVAL_2S", out)
        self.assertIn("++ble_update_counter < KEY_ROTATION_TICKS", out)
        self.assertIn("++battery_update_counter < BATTERY_UPDATE_TICKS", out)
        self.assertIn("#if !SEND_BATTERY_CHARGE", out)
        self.assertIn("PATCH: ADC power off", out)
        self.assertIn("PATCH: TX power after re-init", out)
        self.assertEqual(len(re.findall(r"#define\s+MY_RF_POWER_INDEX", out)), 1)
        self.assertNotIn("\r", out)

    def test_idempotent(self):
        other = {**CFG, "adv_interval_ms": 2000, "send_battery": False}
        once = fwpatch.apply_config(self.pristine, other)
        twice = fwpatch.apply_config(fwpatch.apply_config(self.pristine, CFG), other)
        self.assertEqual(once, twice)

    def test_keys_applied(self):
        marker = fwpatch.keyslot_marker()
        out = fwpatch.apply_keys(fwpatch.apply_config(self.pristine, CFG), marker)
        array = fwpatch.KEYS_RE.search(out).group(0)
        body = array.split("=", 1)[1]
        parsed = bytes(int(h, 16) for h in re.findall(r"0x([0-9a-f]{2})", body))
        self.assertEqual(parsed, marker)
        with self.assertRaises(ValueError):
            fwpatch.apply_keys(out, b"\x00" * 83)


if __name__ == "__main__":
    unittest.main()
