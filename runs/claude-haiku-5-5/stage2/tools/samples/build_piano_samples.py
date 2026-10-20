#!/usr/bin/env python3
"""Builds the bundled piano sample sets from their upstream archives.

Run once, by hand, from the candidate directory. The output is committed under public/samples/,
so the app never needs the network or this script at runtime.

Inputs (extracted or downloaded by the operator; see IMPLEMENTATION_DETAILS.json for URLs and hashes):
  --salamander DIR   SalamanderGrandPianoV3_44.1khz16bit/ (Alexander Holm, CC-BY 3.0)
  --upright DIR      UprightPianoKW-SFZ+FLAC-20220221/ (Kawai upright, FreePats, CC0 1.0)
  --jrhodes DIR      jRhodes3d-wav/jRhodes3d-mono-wav (Jeff Learman, CC BY-NC 4.0 samples)
  --out DIR          output directory, normally public/samples

Requires ffmpeg on PATH for the MP3 encodes.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import wave
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

# Salamander: sampled every minor third from A0 (MIDI 21). Keep every third root from D#1 to D#7
# (27..99) so no note is shifted more than 1.5 semitones. Four velocity layers are kept from the
# sixteen published ones: v3, v7, v11, v15, with velocity ranges that cover 1..127 without gaps.
SALAMANDER_ROOTS = list(range(27, 100, 3))
SALAMANDER_LAYERS = [(3, 1, 47), (7, 48, 79), (11, 80, 106), (15, 107, 127)]
SALAMANDER_SECONDS = 10.0
SALAMANDER_FADE = 1.5
ELECTRIC_SECONDS = 10.0
ELECTRIC_FADE = 1.5

MP3_BITRATE = '80k'


def ffmpeg(args):
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', *args], check=True)


def encode_mp3(src: Path, dst: Path, seconds: float | None, fade: float):
    args = ['-i', str(src)]
    if seconds is not None:
        args += ['-t', str(seconds)]
        if fade > 0:
            args += ['-af', f'afade=t=out:st={seconds - fade}:d={fade}']
    args += ['-c:a', 'libmp3lame', '-b:a', MP3_BITRATE, str(dst)]
    ffmpeg(args)


def build_grand(src_dir: Path, out: Path, licenses: Path) -> dict:
    root_dir = next(src_dir.glob('SalamanderGrandPianoV3_44.1khz16bit'), src_dir)
    audio_dir = root_dir / '44.1khz16bit'
    zones = []
    dest = out / 'grand'
    dest.mkdir(parents=True, exist_ok=True)
    for root in SALAMANDER_ROOTS:
        name = note_name(root)
        for layer, lo, hi in SALAMANDER_LAYERS:
            src = audio_dir / f'{name}v{layer}.wav'
            if not src.exists():
                raise SystemExit(f'missing Salamander sample {src}')
            file = f'r{root:03d}-v{layer:02d}.mp3'
            encode_mp3(src, dest / file, SALAMANDER_SECONDS, SALAMANDER_FADE)
            zones.append({'file': f'grand/{file}', 'root': root, 'cents': 0, 'lovel': lo, 'hivel': hi,
                          'loopStart': None, 'loopEnd': None})
    shutil.copy(root_dir / 'README', licenses / 'salamander-grand-README.txt')
    return {
        'id': 'grand',
        'label': 'Grand',
        'set': 'Salamander Grand Piano V3 (Yamaha C5, 44.1 kHz/16-bit WAV, re-encoded to MP3)',
        'license': 'CC-BY-3.0',
        'licenseNotice': 'Salamander Grand Piano V3 by Alexander Holm, licensed CC BY 3.0. Attribution required.',
        'licenseFile': 'licenses/salamander-grand-README.txt',
        'zones': zones,
    }


def note_name(midi: int) -> str:
    names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    return f'{names[midi % 12]}{midi // 12 - 1}'


def parse_sfz_regions(text: str):
    """Returns one opcode dict per <region>, with <group> and <global> opcodes merged in (SFZ inheritance)."""
    regions = []
    global_ops: dict = {}
    group_ops: dict = {}
    current = None
    target = None
    for raw in text.splitlines():
        line = raw.split('//')[0].strip()
        while line:
            if line.startswith('<'):
                tag, _, line = line.partition('>')
                line = line.strip()
                if tag == '<global':
                    target, global_ops, group_ops = 'global', {}, {}
                elif tag == '<group':
                    target, group_ops = 'group', {}
                elif tag == '<region':
                    current = dict(global_ops)
                    current.update(group_ops)
                    regions.append(current)
                    target = 'region'
                continue
            tokens = re.match(r'(\w+)=(\S+)\s*(.*)', line)
            if not tokens:
                break
            key, value, line = tokens.group(1), tokens.group(2), tokens.group(3)
            if target == 'region':
                current[key] = value
            elif target == 'group':
                group_ops[key] = value
            elif target == 'global':
                global_ops[key] = value
    for region in regions:
        if 'key' in region:
            region.setdefault('pitch_keycenter', region['key'])
    return regions


def build_upright(src_dir: Path, out: Path, licenses: Path) -> dict:
    root_dir = next(src_dir.glob('UprightPianoKW-SFZ+FLAC-*'), src_dir)
    sfz = next(root_dir.glob('*.sfz'))
    regions = [r for r in parse_sfz_regions(sfz.read_text(encoding='utf-8', errors='replace')) if 'sample' in r]
    missing = [r for r in regions if 'pitch_keycenter' not in r]
    if missing:
        raise SystemExit(f'{len(missing)} upright regions have no pitch_keycenter')
    if not regions:
        raise SystemExit('no regions parsed from upright SFZ')
    dest = out / 'upright'
    dest.mkdir(parents=True, exist_ok=True)
    zones = []
    for region in regions:
        flac = root_dir / region['sample']
        layer = 'vL' if flac.stem.endswith('vL') else 'vH'
        lo, hi = (1, 80) if layer == 'vL' else (81, 127)  # the SFZ splits the soft and loud layers at 80/81
        root = int(region['pitch_keycenter'])
        file = f'r{root:03d}-{layer}.mp3'
        encode_mp3(flac, dest / file, None, 0)
        zones.append({'file': f'upright/{file}', 'root': root, 'cents': 0, 'lovel': lo, 'hivel': hi,
                      'loopStart': None, 'loopEnd': None})
    shutil.copy(root_dir / 'cc0.txt', licenses / 'upright-cc0.txt')
    shutil.copy(root_dir / 'readme.txt', licenses / 'upright-readme.txt')
    return {
        'id': 'upright',
        'label': 'Upright',
        'set': 'UprightPianoKW (Kawai upright, FreePats, 2022-02-21 SFZ+FLAC, re-encoded to MP3)',
        'license': 'CC0-1.0',
        'licenseNotice': 'Public domain dedication (CC0 1.0). No attribution required.',
        'licenseFile': 'licenses/upright-cc0.txt',
        'zones': zones,
    }


def midi_from_name(name: str) -> int:
    """'F1' -> 29, 'Ab4' -> 68, with C4 = 60 (the convention the jRhodes sample file indices use)."""
    m = re.fullmatch(r'([A-Ga-g])([#b]?)(-?\d+)', name.strip())
    if not m:
        raise ValueError(f'not a note name: {name}')
    base = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}[m.group(1).upper()]
    shift = {'': 0, '#': 1, 'b': -1}[m.group(2)]
    return (int(m.group(3)) + 1) * 12 + base + shift


def build_electric(src_dir: Path, out: Path, licenses: Path) -> dict:
    """jRhodes3d (Jeff Learman, 1977 Rhodes Mark I Stage 73): no-crossfade mono mapping, five velocity layers."""
    sfz = src_dir / '_jRhodes3d-mono-no-xfade-wav.sfz'
    regions = [r for r in parse_sfz_regions(sfz.read_text(encoding='utf-8', errors='replace')) if 'sample' in r]
    if not regions:
        raise SystemExit('no regions parsed from the jRhodes3d SFZ')
    dest = out / 'electric'
    dest.mkdir(parents=True, exist_ok=True)
    zones = []
    seen = set()
    for region in regions:
        key = (region['sample'], int(region['lovel']), int(region['hivel']))
        if key in seen:
            continue
        seen.add(key)
        wav = src_dir / region['sample']
        root = midi_from_name(region['pitch_keycenter'])
        layer = int(region['lovel'])
        file = f'r{root:03d}-v{layer:03d}.mp3'
        encode_mp3(wav, dest / file, ELECTRIC_SECONDS, ELECTRIC_FADE)
        zones.append({'file': f'electric/{file}', 'root': root, 'cents': 0, 'lovel': int(region['lovel']),
                      'hivel': int(region['hivel']), 'loopStart': None, 'loopEnd': None, 'source': wav.name})
    shutil.copy(src_dir.parent / 'LICENSE', licenses / 'jrhodes3d-LICENSE.txt')
    shutil.copy(src_dir.parent / 'README.md', licenses / 'jrhodes3d-README.md')
    return {
        'id': 'electric',
        'label': 'Electric',
        'set': 'jRhodes3d, 1977 Rhodes Mark I Stage 73 (Jeff Learman), no-crossfade mono WAV mapping, re-encoded to MP3',
        'license': 'CC-BY-NC-4.0',
        'licenseNotice': 'jRhodes samples by Jeff Learman, licensed CC BY-NC 4.0 (attribution required; non-commercial use only; commercial use needs the author\'s permission).',
        'licenseFile': 'licenses/jrhodes3d-LICENSE.txt',
        'zones': zones,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--salamander', type=Path, required=True)
    ap.add_argument('--upright', type=Path, required=True)
    ap.add_argument('--jrhodes', type=Path, required=True, help='jRhodes3d-wav/jRhodes3d-mono-wav directory (LICENSE and README one level up)')
    ap.add_argument('--out', type=Path, required=True)
    args = ap.parse_args()
    out = args.out
    licenses = out / 'licenses'
    licenses.mkdir(parents=True, exist_ok=True)
    sets = [
        build_grand(args.salamander, out, licenses),
        build_upright(args.upright, out, licenses),
        build_electric(args.jrhodes, out, licenses),
    ]
    for s in sets:
        (out / s['id'] / 'manifest.json').write_text(json.dumps(s, indent=2) + '\n')
        print(s['id'], len(s['zones']), 'zones')


if __name__ == '__main__':
    main()
