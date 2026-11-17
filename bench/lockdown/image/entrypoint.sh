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

# Playwright looks for browsers in one directory. The image's builds are
# read-only under /opt, so link them into the writable default cache: the
# pinned Chromium is found without a download, and a candidate that picks
# another Playwright version downloads its browser (through the mirror) into
# the home volume instead of into its own source tree.
if [ -d /opt/ms-playwright ] && [ -w "$HOME" ]; then
  mkdir -p "$HOME/.cache/ms-playwright"
  for build in /opt/ms-playwright/*; do
    [ -e "$HOME/.cache/ms-playwright/$(basename "$build")" ] || ln -s "$build" "$HOME/.cache/ms-playwright/$(basename "$build")"
  done
  unset PLAYWRIGHT_BROWSERS_PATH
fi

exec "$@"
