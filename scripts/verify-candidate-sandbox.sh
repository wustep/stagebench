#!/bin/sh
# Prove the StageBench candidate Codex profile can read the workspace and
# cannot read the parent repo, other projects, or STAGEBENCH_HOME. This is a
# harness check, not a candidate rerun.
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
profile_src="$repo_root/bench/codex-candidate.config.toml"

PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export PATH

if ! command -v codex >/dev/null 2>&1; then
  echo "verify-candidate-sandbox: codex is not on PATH" >&2
  exit 1
fi

cfg=$(mktemp -d "${TMPDIR:-/tmp}/stagebench-sandbox-cfg.XXXXXX")
ws=$(mktemp -d "${TMPDIR:-/tmp}/stagebench-sandbox-ws.XXXXXX")
trap 'rm -rf "$cfg" "$ws"' EXIT

cp "$profile_src" "$cfg/config.toml"
mkdir -p "$ws/candidate" "$ws/inputs"
printf 'inside-ok\n' > "$ws/inside.txt"
printf 'candidate-ok\n' > "$ws/candidate/file.txt"

run() {
  # shellcheck disable=SC2086
  CODEX_HOME="$cfg" codex sandbox -P candidate-isolated -C "$ws" -- "$@"
}

fail=0
expect_ok() {
  label=$1
  shift
  errfile=$(mktemp)
  if run "$@" >/dev/null 2>"$errfile"; then
    echo "PASS  $label"
  else
    echo "FAIL  $label (expected success):"
    sed 's/^/      /' "$errfile"
    fail=1
  fi
  rm -f "$errfile"
}

expect_denied() {
  label=$1
  shift
  errfile=$(mktemp)
  if run "$@" >/dev/null 2>"$errfile"; then
    echo "FAIL  $label (expected Operation not permitted)"
    fail=1
  elif grep -q "Operation not permitted" "$errfile"; then
    echo "PASS  $label (denied)"
  else
    echo "FAIL  $label (sandbox error, not a denial):"
    sed 's/^/      /' "$errfile"
    fail=1
  fi
  rm -f "$errfile"
}

nord_sample=""
if [ -d "$HOME/Projects/nordstage4" ]; then
  for cand in "$HOME/Projects/nordstage4/README.md" "$HOME/Projects/nordstage4/package.json"; do
    if [ -f "$cand" ]; then
      nord_sample=$cand
      break
    fi
  done
fi

echo "Codex $(codex --version 2>/dev/null || echo unknown)"
echo "workspace $ws"
echo

expect_ok "read file inside workspace" /bin/cat "$ws/inside.txt"
expect_ok "read file inside candidate/" /bin/cat "$ws/candidate/file.txt"
if [ -x /opt/homebrew/bin/node ]; then
  expect_ok "run Homebrew node" /opt/homebrew/bin/node -v
fi
if [ -x /opt/homebrew/bin/pnpm ]; then
  expect_ok "run Homebrew pnpm" /opt/homebrew/bin/pnpm -v
fi

expect_denied "read parent repo rubric" /bin/cat "$repo_root/bench/rubric.json"
expect_denied "list ~/Projects" /bin/ls "$HOME/Projects"
if [ -n "$nord_sample" ]; then
  expect_denied "read ~/Projects/nordstage4" /bin/cat "$nord_sample"
else
  echo "SKIP  read ~/Projects/nordstage4 (not present)"
fi
if [ -d "$HOME/.stagebench" ]; then
  expect_denied "list ~/.stagebench" /bin/ls "$HOME/.stagebench"
else
  echo "SKIP  list ~/.stagebench (not present)"
fi
if [ -d "$HOME/.codex-personal/sessions" ]; then
  expect_denied "list Codex sessions" /bin/ls "$HOME/.codex-personal/sessions"
else
  echo "SKIP  list Codex sessions (not present)"
fi

echo
if [ "$fail" -ne 0 ]; then
  echo "candidate sandbox verification failed"
  exit 1
fi
echo "candidate sandbox verification passed"
