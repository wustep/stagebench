"""Build the KW and Rhodes instruments from the licensed workspace pack."""
import array
import json
import re
import struct
import subprocess
from pathlib import Path

PACK = Path('../inputs/samples')
MANIFEST = Path('IMPLEMENTATION_DETAILS.json')
RATE = 32000
PITCH_CLASSES = {'C': 0, 'D#': 3, 'F#': 6, 'A': 9, 'B': 11}


def sustain_loop(path, trim):
    """Translate the author's inclusive RIFF sample loop to seconds after trimming."""
    wav = path.read_bytes()
    index = 12
    while index + 8 <= len(wav):
        chunk, size = struct.unpack_from('<4sI', wav, index)
        start = index + 8
        if chunk == b'smpl':
            first, last = struct.unpack_from('<II', wav, start + 36 + 8)
            return {'loopStart': first / 44100 - trim, 'loopEnd': (last + 1) / 44100 - trim}
        index = start + size + (size % 2)
    raise ValueError(f'Missing sustain loop in {path}')


def encode(raw, family, root, dynamic):
    probe = ['sox', '-R', str(raw), '-t', 'raw', '-e', 'signed', '-b', '16',
             '-c', '1', '-r', str(RATE), '-', 'trim', '0', '8']
    pcm = array.array('h')
    pcm.frombytes(subprocess.check_output(probe, stderr=subprocess.DEVNULL))
    peak = max(map(abs, pcm))
    onset = next(i for i, value in enumerate(pcm) if abs(value) > peak * .008)
    start = max(0, onset - 48)
    gain = .8 * 32767 / peak
    trim = start / RATE
    duration = (len(pcm) - start) / RATE
    out = Path('public/samples') / f'{family}-{root}-{dynamic}.ogg'
    effects = ['remix', '-', 'trim', str(trim), str(duration), 'vol', str(gain)]
    loop = {}
    if family == 'electric':
        loop = sustain_loop(raw, trim)
    else:
        effects += ['fade', 't', '0', str(duration), str(min(.3, duration / 3))]
    subprocess.run(['sox', '-R', str(raw), '-c', '1', '-r', str(RATE), '-C', '6',
                    str(out), *effects], check=True, stderr=subprocess.DEVNULL)
    processing = (f'Mono sum, attack trim {trim:.6f} s, duration {duration:.4f} s, '
                  f'gain {gain:.5f}, 32 kHz Vorbis q6.')
    if not loop:
        processing += ' Linear end fade.'
    file = dict(path=str(out), origin='pack', packFile=str(raw.relative_to(PACK)),
                rootNote=root, velocityLayer=dynamic, processing=processing, **loop)
    zone = dict(type=2 if family == 'electric' else 1, root=root, high=dynamic == 'H',
                file=str(out.relative_to('public')), **loop)
    return file, zone


details = json.loads(MANIFEST.read_text())
audio = details['audio']
audio['files'] = [f for f in audio['files'] if f['path'].startswith('public/samples/grand-')]
sources = json.loads((PACK / 'sample-sources.json').read_text())['sampleSources']
audio['sampleSources'] = [s for s in sources if s['id'] in {
    'salamander-grand-v3', 'upright-piano-kw', 'learman-rhodes-gm'}]
zones = [dict(type=0, root=f['rootNote'], high=f['velocityLayer'] == 10,
              file=str(Path(f['path']).relative_to('public'))) for f in audio['files']]

for raw in sorted(PACK.glob('upright/*/samples/*.flac')):
    name, octave, dynamic = re.fullmatch(r'([A-G]#?)(\d)v([LH])', raw.stem).groups()
    root = (int(octave) + 1) * 12 + PITCH_CLASSES[name]
    if 24 <= root <= 103:
        file, zone = encode(raw, 'upright', root, dynamic)
        audio['files'].append(file)
        zones.append(zone)

for raw in sorted(PACK.glob('electric/learman*/**/*.wav')):
    root = int(raw.name.split('_')[1])
    file, zone = encode(raw, 'electric', root, 'single')
    audio['files'].append(file)
    zones.append(zone)

Path('src/zones.json').write_text(json.dumps(zones, indent=2) + '\n')
audio['strategy'] = ('Nearest recorded root at the touch-adjusted velocity. Grand selects v4/v10 '
                     'at MIDI velocity 70 and Upright switches from L to H above 80. Rhodes uses one '
                     'recorded dynamic, the original harp sustain loops, velocity-sensitive gain and '
                     'filtering. Clav, Digital, Misc and the fallback use live synthesis.')
audio['generatedSources'] = ['Live harmonic oscillators and decay envelopes',
                             'Sympathetic partials of undamped acoustic strings',
                             'Deterministic stereo reverb impulses generated in memory']
MANIFEST.write_text(json.dumps(details, indent=2) + '\n')
