# web/firmware/

Generated. Do not edit. `scripts/generate_firmware_variants.py` (Linux / Docker / CI) writes:

- `<variant-id>.bin`: firmware images containing the 84-byte key-slot marker
- `build-manifest.json`: variant id, file name and build config, plus the upstream commit
- `index.json`: the catalog the web page loads (`scripts/verify_bins.py` writes it only if every image passes the checks)

Everything here except this README is git-ignored.
