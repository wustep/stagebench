#!/bin/sh
# Candidate container entrypoint. The only setup that has to happen inside the
# box: learn to trust the gateway's per-session CA, so TLS to the inspected
# model API hosts verifies. Paths are fixed, and the launcher points the usual
# CA environment variables at them.
set -u

if [ -n "${STAGEBENCH_GATEWAY:-}" ]; then
  ca=/tmp/stagebench-gateway-ca.pem
  bundle=/tmp/stagebench-ca-bundle.pem
  attempt=0
  while [ "$attempt" -lt 20 ]; do
    if curl -fsS --noproxy '*' --max-time 3 "http://${STAGEBENCH_GATEWAY}:4873/ca.pem" -o "$ca" 2>/dev/null; then
      break
    fi
    rm -f "$ca"
    # 404 means the gateway is up but inspects nothing; stop waiting.
    code=$(curl -s --noproxy '*' --max-time 3 -o /dev/null -w '%{http_code}' "http://${STAGEBENCH_GATEWAY}:4873/healthz" 2>/dev/null || true)
    [ "$code" = "200" ] && break
    attempt=$((attempt + 1))
    sleep 0.5
  done
  if [ -s "$ca" ]; then
    cat /etc/ssl/certs/ca-certificates.crt "$ca" > "$bundle"
  else
    cp /etc/ssl/certs/ca-certificates.crt "$bundle"
    : > "$ca"
  fi
fi

# The npm registry a protocol-3 box installs from: a loopback server over the
# tarballs baked into this image (see npm-mirror.mjs). It has no upstream, so
# there is nothing behind it to read. A box that is not given the offline
# registry (STAGEBENCH_OFFLINE_REGISTRY=0) does not start it.
if [ "${STAGEBENCH_OFFLINE_REGISTRY:-1}" = "1" ] && [ -d /opt/stagebench/npm-mirror ]; then
  node /opt/stagebench/npm-mirror.mjs serve > /tmp/stagebench-registry.log 2>&1 &
  attempt=0
  while [ "$attempt" -lt 50 ]; do
    curl -fsS --noproxy '*' --max-time 1 http://127.0.0.1:4874/-/ping > /dev/null 2>&1 && break
    attempt=$((attempt + 1))
    sleep 0.1
  done
fi
# pnpm reads the registry from .npmrc in a few places where it ignores the
# environment, so say it there too. Never overwrites one that is already there.
if [ -n "${STAGEBENCH_REGISTRY:-}" ] && [ -w "$HOME" ] && [ ! -e "$HOME/.npmrc" ]; then
  printf 'registry=%s\n' "$STAGEBENCH_REGISTRY" > "$HOME/.npmrc"
fi

# Playwright looks for browsers in one directory. The image's builds are
# read-only under /opt, so link them into the writable default cache: the
# pinned Chromium is found without a download. (The offline mirror carries
# only the Playwright version these builds belong to.)
if [ -d /opt/ms-playwright ] && [ -w "$HOME" ]; then
  mkdir -p "$HOME/.cache/ms-playwright"
  for build in /opt/ms-playwright/*; do
    [ -e "$HOME/.cache/ms-playwright/$(basename "$build")" ] || ln -s "$build" "$HOME/.cache/ms-playwright/$(basename "$build")"
  done
  unset PLAYWRIGHT_BROWSERS_PATH
fi

exec "$@"
