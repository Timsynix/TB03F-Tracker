#!/usr/bin/env python3
"""
Build the standalone flasher: ONE .html file with the CSS, the JavaScript and every firmware image
inlined. It needs no server and makes no network requests (CSP connect-src 'none'); open it straight
from disk in Chrome, Edge or Opera. Pure Python, runs on Windows or WSL.

  python3 scripts/make_standalone.py                     # web/firmware -> dist/TB03F-Flasher.html
  python3 scripts/make_standalone.py --catalog web/dev-fixture --out dist/TB03F-Flasher-DEV.html
"""

import argparse
import base64
import datetime
import gzip
import json
import re
import sys
import textwrap
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fwimage  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
# dependency order; each module may only import from modules listed before it
MODULES = ["bytes", "crc32", "sha256", "p224", "firmware", "catalog", "exports", "sws", "serial", "app"]
IMPORT_RE = re.compile(r"^import\s*\{([^}]*)\}\s*from\s*'\./([\w-]+)\.js';[ \t]*$", re.M)
EXPORT_RE = re.compile(r"^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)", re.M)
PLACEHOLDER_RE = re.compile(r"/\*__(CSS|JS)__\*/|__(CATALOG_JSON|FIRMWARE_PACK|BUILD_INFO)__")


def bundle_js() -> str:
    """Wrap each ES module in its own function scope and wire imports to the earlier modules' exports."""
    defined, parts = set(), []
    for name in MODULES:
        src = (WEB / "js" / f"{name}.js").read_text(encoding="utf-8")
        exports = EXPORT_RE.findall(src)

        def wire_import(m, name=name):
            if m.group(2) not in defined:
                raise SystemExit(f"{name}.js imports {m.group(2)}.js, which is not bundled before it")
            names = ", ".join(n.strip() for n in m.group(1).split(",") if n.strip())
            return f"const {{ {names} }} = modules.{m.group(2)};"

        body = re.sub(r"^export\s+", "", IMPORT_RE.sub(wire_import, src), flags=re.M)
        if re.search(r"^\s*(import|export)\b", body, re.M):
            raise SystemExit(f"{name}.js uses an import/export form the bundler does not handle")
        parts.append(f"modules.{name} = (() => {{\n{body}\nreturn {{ {', '.join(exports)} }};\n}})();")
        defined.add(name)
    js = "(() => {\n'use strict';\nconst modules = {};\n" + "\n".join(parts) + "\n})();\n"
    if "</script" in js.lower():
        raise SystemExit("bundled JavaScript contains '</script'")
    return js


def build_catalog(catalog_dir: Path):
    index = json.loads((catalog_dir / "index.json").read_text())
    marker = bytes.fromhex(index["marker_hex"])
    blob, variants = bytearray(), []
    for v in index["variants"]:
        data = (catalog_dir / v["file"]).read_bytes()
        info = fwimage.inspect(data, marker)
        problems = fwimage.problems(info)
        if info["sha256"] != v["sha256"]:
            problems.append("SHA-256 differs from index.json")
        if info["marker_offsets"] != [v["key_offset"]]:
            problems.append("key slot offset differs from index.json")
        if problems:
            raise SystemExit(f"{v['file']}: {'; '.join(problems)}")
        variants.append({**{k: v[k] for k in ("id", "config", "size", "sha256", "key_offset")}, "pack_offset": len(blob)})
        blob += data
    catalog = {k: v for k, v in index.items() if k != "variants"}
    catalog.update(variants=variants, built_at=datetime.date.today().isoformat())
    pack = gzip.compress(bytes(blob), compresslevel=9, mtime=0)
    return catalog, pack, len(blob)


def build(catalog_dir: Path, out: Path) -> Path:
    catalog, pack, raw_size = build_catalog(catalog_dir)
    css = (WEB / "style.css").read_text(encoding="utf-8")
    if "</style" in css.lower():
        raise SystemExit("style.css contains '</style'")
    commit = (catalog.get("source_commit") or "")[:7]
    values = {
        "CSS": css,
        "JS": bundle_js(),
        "CATALOG_JSON": json.dumps(catalog, separators=(",", ":")).replace("</", "<\\/"),
        "FIRMWARE_PACK": "\n" + "\n".join(textwrap.wrap(base64.b64encode(pack).decode("ascii"), 120)) + "\n",
        "BUILD_INFO": f"make_standalone.py {catalog['built_at']} upstream {commit or 'n/a'}",
    }
    template = (WEB / "template.html").read_text(encoding="utf-8")
    html = PLACEHOLDER_RE.sub(lambda m: values[m.group(1) or m.group(2)], template)

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8", newline="\n")
    print(f"wrote {out}  ({len(html) // 1024} KiB: {len(catalog['variants'])} images, "
          f"{raw_size // 1024} KiB raw -> {len(pack) // 1024} KiB gzip)")
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--catalog", type=Path, default=WEB / "firmware", help="folder with index.json + .bin files")
    ap.add_argument("--out", type=Path, default=ROOT / "dist" / "TB03F-Flasher.html")
    args = ap.parse_args(argv)
    if not (args.catalog / "index.json").exists():
        raise SystemExit(f"{args.catalog / 'index.json'} not found - build the firmware first (scripts/build_catalog.sh)")
    build(args.catalog, args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
