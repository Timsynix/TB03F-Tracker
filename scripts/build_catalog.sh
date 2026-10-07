#!/usr/bin/env bash
# Build all firmware variants (web/firmware/) and the standalone flasher dist/TB03F-Flasher.html
# on Linux/WSL with /opt/tc32 (or inside the Docker image / CI).
# Uses its own LF checkout of the upstream firmware at a pinned commit (a Windows checkout has CRLF
# makefiles, which GNU make on Linux cannot run). Extra arguments go to generate_firmware_variants.py,
# e.g. --list or --only <id>.
set -euo pipefail
cd "$(dirname "$0")/.."

UPSTREAM_REPO="${UPSTREAM_REPO:-https://github.com/stefexec/TB-03F-OpenHaystack-Firmware}"
UPSTREAM_COMMIT="${UPSTREAM_COMMIT:-c96e672914bf6e0f55426baf6425f219ec818939}"
UPSTREAM_DIR=build/upstream

if [ ! -d "$UPSTREAM_DIR/.git" ]; then
  git clone --quiet -c core.autocrlf=false "$UPSTREAM_REPO" "$UPSTREAM_DIR"
fi
git -C "$UPSTREAM_DIR" -c advice.detachedHead=false checkout --quiet "$UPSTREAM_COMMIT"

python3 scripts/generate_firmware_variants.py --upstream "$UPSTREAM_DIR" "$@"
case " $* " in *" --list "*|*" --patch-only "*) exit 0 ;; esac
python3 scripts/make_standalone.py
