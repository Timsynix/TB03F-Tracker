#!/usr/bin/env bash
# Install the Telink tc32 GCC toolchain to /opt/tc32 (Linux). Used by the Dockerfile and CI.
#   TC32_URL     tarball URL (default: the one in the upstream firmware README)
#   TC32_SHA256  expected checksum; if empty the checksum is printed so it can be pinned
set -euo pipefail

TC32_URL="${TC32_URL:-http://shyboy.oss-cn-shenzhen.aliyuncs.com/readonly/tc32_gcc_v2.0.tar.bz2}"
TC32_SHA256="${TC32_SHA256:-}"
SUDO=$([ "$(id -u)" -eq 0 ] && echo "" || echo "sudo")

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

curl -fsSL --retry 3 "$TC32_URL" -o "$tmp/tc32.tar.bz2"
if [ -n "$TC32_SHA256" ]; then
  echo "$TC32_SHA256  $tmp/tc32.tar.bz2" | sha256sum -c -
else
  echo "WARNING: TC32_SHA256 not set; pin this checksum:"
  sha256sum "$tmp/tc32.tar.bz2"
fi
$SUDO tar -xjf "$tmp/tc32.tar.bz2" -C /opt

# Older tc32 releases are 32-bit x86 binaries; add the i386 runtime only if needed.
if file -L /opt/tc32/bin/tc32-elf-gcc | grep -q 'ELF 32-bit'; then
  $SUDO dpkg --add-architecture i386
  $SUDO apt-get update -qq
  $SUDO apt-get install -y -qq libc6:i386 libstdc++6:i386 zlib1g:i386
fi

# Fail early if the compiler cannot actually compile.
echo 'int main(void){return 0;}' > "$tmp/t.c"
/opt/tc32/bin/tc32-elf-gcc -c "$tmp/t.c" -o "$tmp/t.o"
/opt/tc32/bin/tc32-elf-gcc --version | head -1
