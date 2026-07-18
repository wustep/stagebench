#!/bin/bash
# Compose a title card + one segment per run into a single comparison video.
# Reads <raw>/<slug>.meta.json written by record.mjs (crop, offset, title, metrics).
#
# Usage:
#   ./compose.sh --raw ./raw --order kimi-k3,claude-fable-5 [--phase 2] \
#     [--out ~/Desktop/foo.mp4] [--subtitle "Recreating the Nord Stage 4 …"]
#
# --out defaults to ~/Desktop/stagebench-<a>-vs-<b>-phase<N>.mp4. The deliverable
# must land somewhere openable, not in a sandboxed scratch path.
set -euo pipefail

RAW="./raw"; OUT=""; ORDER=""; PHASE="2"
SUBTITLE="Recreating the Nord Stage 4 as a browser instrument"
while [ $# -gt 0 ]; do
  case "$1" in
    --raw) RAW="$2"; shift 2;;
    --out) OUT="$2"; shift 2;;
    --order) ORDER="$2"; shift 2;;
    --subtitle) SUBTITLE="$2"; shift 2;;
    --phase) PHASE="$2"; shift 2;;
    *) echo "unknown arg: $1" >&2; exit 1;;
  esac
done

FF="${FF:-ffmpeg}"
# Set FFDEBUG=1 to see ffmpeg stderr instead of discarding it.
FFERR="/dev/null"; [ -n "${FFDEBUG:-}" ] && FFERR="/dev/stderr"
command -v "$FF" >/dev/null 2>&1 || { echo "ffmpeg not found; set FF=/path/to/ffmpeg" >&2; exit 1; }
FONT="${FONT:-/System/Library/Fonts/Helvetica.ttc}"
SEG="$RAW/seg"; mkdir -p "$SEG"

[ -n "$ORDER" ] || { echo "--order is required (comma-separated run ids)" >&2; exit 1; }
IFS=',' read -ra RUNS <<< "$ORDER"

# Default the finished video to the Desktop, named after what's in it. Raw captures
# belong in scratch; the deliverable must be somewhere the user can actually open.
if [ -z "$OUT" ]; then
  DEST="$HOME/Desktop"; [ -d "$DEST" ] || DEST="$PWD"
  if [ "${#RUNS[@]}" -le 3 ]; then
    NAME="$(IFS='|'; printf '%s' "${RUNS[*]}" | sed 's/|/-vs-/g')"
  else
    NAME="${#RUNS[@]}-models"
  fi
  OUT="$DEST/stagebench-$NAME-phase$PHASE.mp4"
fi
mkdir -p "$(dirname "$OUT")"

# Loudness matching. Artifacts ship wildly different output levels (a 27.7 dB
# spread has been measured across runs), which makes quiet ones inaudible next to
# loud ones and biases any A/B listening. We apply a single STATIC gain per
# segment — no compression, no limiting, no EQ — so pitch, timing and dynamics are
# untouched; it is exactly a volume knob. The gain is additionally clamped so true
# peak never exceeds PEAK_CEIL, meaning it can never clip: a segment that cannot
# reach the target without clipping simply lands below it and says so.
# Set LOUDNORM=0 to keep raw levels.
TARGET_LUFS="${TARGET_LUFS:--16}"
PEAK_CEIL="${PEAK_CEIL:--1.5}"

gain_for() { # audio-file -> "gain_db measured_lufs measured_peak"
  local f="$1" out i pk g
  out="$("$FF" -i "$f" -af ebur128=peak=true:framelog=quiet -f null - 2>&1)"
  i="$(printf '%s' "$out" | awk '/^ *I: /{v=$2} END{print v}')"
  pk="$(printf '%s' "$out" | awk '/^ *Peak: /{v=$2} END{print v}')"
  [ -n "$i" ] && [ -n "$pk" ] || { echo "0 n/a n/a"; return; }
  g="$(python3 -c "
i=float('$i'); pk=float('$pk')
want=$TARGET_LUFS - i          # gain to hit the loudness target
headroom=$PEAK_CEIL - pk       # gain we can apply before touching the ceiling
print(f'{min(want, headroom):.2f} {i} {pk}')")"
  echo "$g"
}

# ffmpeg drawtext needs these escaped inside the filter string.
esc() { printf '%s' "$1" | sed -e "s/\\\\/\\\\\\\\/g" -e "s/:/\\\\:/g" -e "s/'/\\\\\\\\\\\\'/g" -e "s/%/\\\\%/g"; }
jget() { python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get(sys.argv[2]) or '')" "$1" "$2"; }

TITLES=""; LOUDLOG=""
for id in "${RUNS[@]}"; do
  slug="$(printf '%s' "$id" | tr -c 'a-zA-Z0-9' '-')"
  meta="$RAW/$slug.meta.json"
  [ -f "$meta" ] || { echo "missing $meta — run record.mjs first" >&2; exit 1; }

  title="$(jget "$meta" title)"
  metrics="$(jget "$meta" metrics)"
  offms="$(jget "$meta" offsetMs)"
  seconds="$(jget "$meta" segmentSeconds)"; seconds="${seconds:-16.5}"
  # Crop is per-artifact so every model fills the frame equally (see SKILL.md).
  cropf="$(python3 -c "
import json,sys
c=json.load(open(sys.argv[1])).get('crop')
print('crop=%d:%d:%d:%d,'%(c['w'],c['h'],c['x'],c['y']) if c else '')" "$meta")"
  # Trim the lead-in so the segment starts ~1s before the first note.
  start="$(python3 -c "print(max(0, $offms/1000 - 1.0))")"

  gainf=""
  if [ "${LOUDNORM:-1}" != "0" ]; then
    read -r GDB GI GPK <<< "$(gain_for "$RAW/$slug.audio.webm")"
    if [ "$GI" != "n/a" ]; then
      gainf="volume=${GDB}dB,"
      SHORT="$(python3 -c "
g=float('$GDB'); i=float('$GI')
print('' if abs((i+g) - ($TARGET_LUFS)) < 0.1 else f\" (peak-limited, lands at {i+g:.1f})\")")"
      echo "  loudness: $slug measured ${GI} LUFS / peak ${GPK} dBFS -> ${GDB} dB gain${SHORT}"
      LOUDLOG="${LOUDLOG}${LOUDLOG:+$'\n'}  $slug: ${GI} LUFS -> $TARGET_LUFS target, ${GDB} dB applied"
    fi
  fi

  "$FF" -y -ss "$start" -i "$RAW/$slug.webm" -i "$RAW/$slug.audio.webm" \
    -filter_complex "
[0:v]trim=0:$seconds,setpts=PTS-STARTPTS,${cropf}scale=1920:1080,
drawtext=fontfile=$FONT:text='$(esc "$title")':fontcolor=white:fontsize=64:x=64:y=52:box=1:boxcolor=black@0.55:boxborderw=18,
drawtext=fontfile=$FONT:text='$(esc "$metrics")':fontcolor=0x9fdcff:fontsize=38:x=64:y=150:box=1:boxcolor=black@0.55:boxborderw=14
[v];
[1:a]aresample=48000,${gainf}adelay=1000|1000,apad,atrim=0:$seconds,asetpts=PTS-STARTPTS[a]" \
    -map "[v]" -map "[a]" -t "$seconds" -r 30 \
    -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p \
    -c:a aac -b:a 192k -ar 48000 -ac 2 "$SEG/$slug.mp4" 2>"$FFERR"
  echo "  segment: $slug.mp4  ($title — $metrics)"
  TITLES="${TITLES:+$TITLES  ·  }$title"
done

PHASE_LABEL="Phase $PHASE"
"$FF" -y -f lavfi -i "color=c=0x141414:s=1920x1080:d=2.4,format=yuv420p" \
  -f lavfi -i "anullsrc=r=48000:cl=stereo" \
  -filter_complex "
[0:v]
drawtext=fontfile=$FONT:text='Stagebench':fontcolor=white:fontsize=84:x=(w-text_w)/2:y=360,
drawtext=fontfile=$FONT:text='$(esc "$SUBTITLE")':fontcolor=0xbbbbbb:fontsize=38:x=(w-text_w)/2:y=490,
drawtext=fontfile=$FONT:text='$(esc "$PHASE_LABEL")':fontcolor=0x9fdcff:fontsize=34:x=(w-text_w)/2:y=560,
drawtext=fontfile=$FONT:text='$(esc "$TITLES")':fontcolor=0xdddddd:fontsize=40:x=(w-text_w)/2:y=630
[v]" \
  -map "[v]" -map 1:a -t 2.4 -r 30 -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p \
  -c:a aac -b:a 192k -ar 48000 -ac 2 "$SEG/title.mp4" 2>"$FFERR"
echo "  segment: title.mp4"

{ echo "file 'title.mp4'"; for id in "${RUNS[@]}"; do
    printf "file '%s.mp4'\n" "$(printf '%s' "$id" | tr -c 'a-zA-Z0-9' '-')"; done; } > "$SEG/list.txt"
"$FF" -y -f concat -safe 0 -i "$SEG/list.txt" -c copy "$OUT" 2>"$FFERR"
echo "wrote $OUT"
if [ -n "${LOUDLOG:-}" ]; then
  echo "loudness matched to $TARGET_LUFS LUFS (static gain only — no compression/limiting):"
  echo "$LOUDLOG"
  echo "Disclose this if the video is published alongside claims about output level."
fi
