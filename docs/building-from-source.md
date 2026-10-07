# Building from source

You only need this page if you want to change the firmware variants or the flasher itself. To build a tracker,
follow the [main guide](../README.md) and download the ready-made `TB03F-Flasher.html` from the releases.

## How the flasher file is made

`TB03F-Flasher.html` is a single offline file. It contains the page, its code and all 96 pre-built firmware variants,
and it makes no network requests.

1. `scripts/build_catalog.sh` clones the upstream
   [TB-03F-OpenHaystack-Firmware](https://github.com/stefexec/TB-03F-OpenHaystack-Firmware) at a pinned commit.
   It compiles one image per parameter combination into `web/firmware/`.
   - Each image carries an 84-byte placeholder (the "key slot") where the three public keys go.
   - `scripts/verify_bins.py` checks every image's header, size field, CRC trailer and key slot, then writes `index.json`.
2. `scripts/make_standalone.py` packs the images (gzip, about 38 KiB for all 96) together with `web/template.html`,
   `web/style.css` and `web/js/*.js` into `dist/TB03F-Flasher.html`.
3. In the browser, the page generates P-224 keys and writes the public keys over the key slot of the chosen image.
   It fixes the CRC and flashes the result over Web Serial.

## Technical notes

- **Image format:**
  - `KNLT` sits at offset 0x08.
  - The 32-bit little-endian value at 0x18 is the image size without the 4-byte trailer.
  - The last 4 bytes are the CRC-32 (zlib) of everything before them, big-endian.
  - `scripts/fwimage.py` and `web/js/firmware.js` check all of this.
- **Key slot:** in the firmware, `public_keys[3][28]` is initialised with an 84-byte marker: `"TB03F-KEYSLOT-v1"`
  followed by a SHA-256 chain.
  - Because the marker is non-zero, the array ends up in `.data`, which is stored in the flash image. An all-zero
    array would go to `.bss` and not be in the image at all.
  - The page replaces the marker with the three advertisement keys. Each is the 28-byte X coordinate of a P-224
    public key.
- **Flashing:** the Telink SWire protocol, bit-banged through the adapter's TX line. Every SWire bit is one UART byte.
  - The flasher halts the CPU, unlocks the SPI flash, erases 4 KiB sectors, programs 256-byte pages and soft-resets
    the chip.
  - Nothing is read back, so the result is checked over Bluetooth.
- **Firmware behaviour:**
  - The BLE address comes from the first key bytes, with the top two bits set.
  - The beacon is Apple's Offline Finding format.
  - The firmware rotates through keys 1 → 2 → 3 on a 2-minute timer tick.
  - It measures the battery voltage on PB7.

## Build the firmware variants (Linux or WSL)

You need the Telink tc32 toolchain in `/opt/tc32`, plus `make`, `git` and `python3`. `scripts/install_tc32.sh` installs
the toolchain on Debian/Ubuntu. Run this from the repository folder. In WSL, Windows drives are under `/mnt/`, e.g.
`/mnt/c/Users/<you>/TB03F-Tracker`:

```bash
bash scripts/build_catalog.sh
```

The result is `dist/TB03F-Flasher.html`. The parameter matrix is `MATRIX` in
`scripts/generate_firmware_variants.py`. `--list` prints it, and `--only <id>` builds a single variant.

Without WSL, the `Dockerfile` provides the same environment:

```bash
docker build -t tb03f-builder .
```

```bash
docker run --rm -v "${PWD}:/src" tb03f-builder bash scripts/build_catalog.sh
```

After changing only the page (`web/`), rebuild the HTML without recompiling. This also works on Windows:

```bash
python scripts/make_standalone.py
```

## Tests

```bash
npm test
```

```bash
python -m unittest discover -s test/py
```

`test/js/sws.test.mjs` runs pvvx's original flasher (`scripts/USBCOMFlashTx.html`) in a sandbox and checks that
`web/js/sws.js` sends exactly the same bytes, signals and delays. `test/js/p224.test.mjs` checks key generation against
vectors produced with the Python `cryptography` package.

`scripts/make_dev_fixture.py` creates a catalog of synthetic images, for trying the UI without real firmware. Build it with
`python scripts/make_standalone.py --catalog web/dev-fixture --out dist/TB03F-Flasher-DEV.html`. Flashing is disabled in
such a build.

## Releasing

Pushing a version tag builds the firmware in GitHub Actions and attaches `TB03F-Flasher.html` to a GitHub Release.
The download link in the main README always points to the latest release.

```bash
git tag v1.0.0
```

```bash
git push origin v1.0.0
```

## Repository layout

| Path | What it is |
|---|---|
| `web/template.html`, `web/style.css`, `web/js/*.js` | Page sources (ES modules); `make_standalone.py` inlines them |
| `web/js/p224.js`, `sha256.js` | Key generation (BigInt P-224, pure-JS SHA-256) |
| `web/js/firmware.js`, `catalog.js` | Key-slot patching, CRC trailer, embedded firmware pack |
| `web/js/sws.js`, `serial.js` | Telink SWire flasher over Web Serial |
| `scripts/fwpatch.py`, `fwimage.py`, `verify_bins.py` | `app.c` patching, image checks, catalog `index.json` |
| `scripts/generate_firmware_variants.py`, `build_catalog.sh` | Variant build (Linux/WSL) |
| `scripts/make_standalone.py` | Builds `dist/TB03F-Flasher.html` |
| `case/` | 3D-printable case (STL) |
