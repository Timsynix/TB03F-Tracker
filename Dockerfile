# Linux build environment for the TB-03F firmware catalog (tc32 toolchain + make + python3).
#
#   docker build -t tb03f-builder .
#   docker run --rm -v "${PWD}:/src" tb03f-builder bash scripts/build_catalog.sh
FROM ubuntu:24.04

ARG TC32_URL=http://shyboy.oss-cn-shenzhen.aliyuncs.com/readonly/tc32_gcc_v2.0.tar.bz2
ARG TC32_SHA256=

RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends make python3 git curl ca-certificates bzip2 file \
 && rm -rf /var/lib/apt/lists/*

COPY scripts/install_tc32.sh /tmp/install_tc32.sh
RUN TC32_URL="$TC32_URL" TC32_SHA256="$TC32_SHA256" bash /tmp/install_tc32.sh && rm -rf /var/lib/apt/lists/*

# the bind-mounted repo is owned by another uid
RUN git config --global --add safe.directory '*'

ENV PATH=/opt/tc32/bin:$PATH
WORKDIR /src
