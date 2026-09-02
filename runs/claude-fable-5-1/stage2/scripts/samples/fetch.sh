#!/usr/bin/env bash
# Fetches the raw, redistributable source recordings of the bundled piano sample library into one directory
# so that build.py can rebuild public/samples/ from scratch. Nothing in `pnpm build` / `pnpm test` runs this.
#
# Usage: scripts/samples/fetch.sh <sources-dir>
# Needs: curl, git (partial clones), python3 (xz extraction through the lzma module), ~1.2 GB of disk.
set -euo pipefail
dest="${1:?usage: fetch.sh <sources-dir>}"
mkdir -p "$dest"
cd "$dest"

# 1. Salamander Grand Piano V3 (Alexander Holm, CC-BY 3.0) — 44.1 kHz / 16-bit WAV archive from FreePats (412 MB).
if [ ! -d salamander ] || [ -z "$(ls salamander 2>/dev/null)" ]; then
  echo "== Salamander Grand Piano V3 (412 MB)"
  [ -f salamander44.tar.xz ] || curl -fL -o salamander44.tar.xz \
    "https://freepats.zenvoid.org/Piano/SalamanderGrandPiano/SalamanderGrandPianoV3+20161209_44khz16bit.tar.xz"
  mkdir -p salamander
  # Only the four velocity layers the library uses (v3, v7, v11, v15) are extracted.
  python3 - <<'PY'
import re, tarfile, os
want = re.compile(r'(^|/)([A-G]#?\d)v(3|7|11|15)\.wav$')
n = 0
with tarfile.open('salamander44.tar.xz', mode='r|xz') as tar:
    for m in tar:
        if m.isfile() and want.search(m.name):
            with tar.extractfile(m) as f, open(os.path.join('salamander', os.path.basename(m.name)), 'wb') as o:
                while True:
                    b = f.read(1 << 20)
                    if not b:
                        break
                    o.write(b)
            n += 1
print('extracted', n, 'Salamander files')
PY
fi

# 2. Upright Piano KW (FreePats, CC0 1.0) — FLAC samples straight from the FreePats repository.
if [ ! -d upright-piano-KW/samples ]; then
  echo "== Upright Piano KW"
  git clone --filter=blob:none --no-checkout https://github.com/freepats/upright-piano-KW upright-piano-KW
  git -C upright-piano-KW checkout HEAD -- samples LICENSE README.md UprightPianoKW-20220221.sfz
fi

# 3. Greg Sullivan's E-Pianos (CC-BY 3.0): Wurlitzer EP200, Hohner Pianet T, Yamaha CP80 (sfz + FLAC).
if [ ! -d GregSullivan.E-Pianos/CP80 ]; then
  echo "== Greg Sullivan's E-Pianos"
  git clone --filter=blob:none --no-checkout https://github.com/sfzinstruments/GregSullivan.E-Pianos GregSullivan.E-Pianos
  git -C GregSullivan.E-Pianos checkout HEAD -- "Wurlitzer EP200" "Pianet T" CP80 LICENSE README.md
fi

# 4. VCSL (Versilian Community Sample Library, CC0 1.0): TX81Z FM Piano, Flemish harpsichord, marimba.
if [ ! -d "VCSL/Idiophones/Struck Idiophones/Marimba" ]; then
  echo "== VCSL (sparse checkout, ~280 MB)"
  [ -d VCSL ] || git clone --filter=blob:none --no-checkout https://github.com/sgossner/VCSL VCSL
  git -C VCSL sparse-checkout init --cone
  git -C VCSL sparse-checkout set "Electrophones/TX81Z" "Chordophones/Zithers/Harpsichord, Flemish" "Idiophones/Struck Idiophones/Marimba"
  git -C VCSL checkout HEAD -- LICENSE README.md "Electrophones/TX81Z" "Chordophones/Zithers/Harpsichord, Flemish" "Idiophones/Struck Idiophones/Marimba"
fi

echo "sources ready in $dest"
