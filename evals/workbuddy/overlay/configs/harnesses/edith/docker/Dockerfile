# EDITH split-mount image: read-only /opt/edith layer mounted into task
# containers at run time. Ships the EDITH app, production node_modules, and a
# private Node runtime so task images need no compatible Node install.
#
# Build context must contain edith-src.tar.gz (generated from the EDITH
# working tree by evals/workbuddy/scripts/setup.sh / build-mount step).
ARG EDITH_VERSION
FROM node:22-bookworm-slim AS build
ARG EDITH_VERSION
ARG MOUNT_PATH=/opt/edith
LABEL org.edith.version=${EDITH_VERSION}

COPY edith-src.tar.gz /tmp/edith-src.tar.gz
RUN mkdir -p /out/app \
    && tar -xzf /tmp/edith-src.tar.gz -C /out/app \
    && rm /tmp/edith-src.tar.gz
WORKDIR /out/app
RUN npm ci --omit=dev && npm cache clean --force

# Private Node runtime (glibc, linux). The launcher falls back to a system
# `node` if this binary cannot run on the task image's libc.
RUN mkdir -p /out/node/bin && cp /usr/local/bin/node /out/node/bin/node

RUN mkdir -p /out/bin && printf '%s\n' \
    '#!/bin/sh' \
    'ROOT="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"' \
    'if "$ROOT/node/bin/node" --version >/dev/null 2>&1; then NODE="$ROOT/node/bin/node";' \
    'else NODE="$(command -v node || true)"; fi' \
    '[ -n "$NODE" ] || { echo "edith launcher: no usable node runtime" >&2; exit 127; }' \
    'export EDITH_TRUEFORGE_CLI="${EDITH_TRUEFORGE_CLI:-$ROOT/app/node_modules/@truefoundry/trueforge/dist/cli.js}"' \
    'exec "$NODE" "$ROOT/app/bin/edith.js" "$@"' \
    > /out/bin/edith && chmod +x /out/bin/edith

FROM scratch
COPY --from=build /out/ /
