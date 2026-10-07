import base64
import gzip
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

import fwpatch  # noqa: E402
import make_dev_fixture  # noqa: E402
import make_standalone  # noqa: E402
import verify_bins  # noqa: E402


class StandaloneTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        cat = cls.tmp / "catalog"
        cat.mkdir()
        entries = []
        for i, adv in enumerate((1000, 2000)):
            cfg = {"adv_interval_ms": adv, "power": "RF_POWER_P0p04dBm", "send_battery": True,
                   "battery_days": 1, "rotation_min": 30}
            vid = fwpatch.variant_id(cfg)
            (cat / f"{vid}.bin").write_bytes(make_dev_fixture.synthetic_image(vid, 22808 - i * 112))
            entries.append({"id": vid, "file": f"{vid}.bin", "config": cfg})
        (cat / "build-manifest.json").write_text(json.dumps({"source_commit": "abc1234", "variants": entries}))
        verify_bins.main(["--manifest", str(cat / "build-manifest.json")])
        cls.out = make_standalone.build(cat, cls.tmp / "out.html")
        cls.html = cls.out.read_text(encoding="utf-8")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_self_contained(self):
        self.assertEqual(re.findall(r"__[A-Z_]+__|/\*__", self.html), [])
        self.assertIn("connect-src 'none'", self.html)
        self.assertEqual(re.findall(r'<(?:script|link)[^>]+(?:src|href)="(?!data:)', self.html), [])

    def test_bundle_is_valid_javascript(self):
        scripts = re.findall(r"<script>\n(.*?)</script>", self.html, re.S)
        self.assertEqual(len(scripts), 1)
        self.assertNotRegex(scripts[0], r"^\s*(import|export)\b")
        node = shutil.which("node")
        if node is None:
            self.skipTest("node not installed")
        js = self.tmp / "bundle.js"
        js.write_text(scripts[0], encoding="utf-8")
        subprocess.run([node, "--check", str(js)], check=True)

    def test_pack_round_trip(self):
        catalog = json.loads(re.search(r'id="fw-catalog">(.*?)</script>', self.html, re.S).group(1))
        pack_b64 = re.search(r'id="fw-pack">(.*?)</script>', self.html, re.S).group(1)
        pack = gzip.decompress(base64.b64decode("".join(pack_b64.split())))
        self.assertEqual(len(catalog["variants"]), 2)
        for v in catalog["variants"]:
            image = pack[v["pack_offset"]:v["pack_offset"] + v["size"]]
            self.assertEqual(hashlib.sha256(image).hexdigest(), v["sha256"])
            self.assertEqual(image.find(fwpatch.keyslot_marker()), v["key_offset"])


if __name__ == "__main__":
    unittest.main()
