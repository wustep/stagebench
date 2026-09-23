#!/usr/bin/env python3
"""Convert selected source samples to 24 kHz mono 16-bit onset-aligned WAVs + manifest."""
import json, os, re, subprocess, sys, wave
import numpy as np

S = os.path.dirname(os.path.abspath(__file__)) + "/samples"
DL = os.path.dirname(os.path.abspath(__file__)) + "/source_cache"
SR = 24000
MAXLEN = 4.0
FADE = 0.6
THR_DB = -50.0
PREROLL = int(0.0005 * SR)  # 0.5 ms before threshold crossing

NOTE = {'c': 0, 'c#': 1, 'db': 1, 'd': 2, 'd#': 3, 'eb': 3, 'e': 4, 'f': 5, 'f#': 6, 'gb': 6,
        'g': 7, 'g#': 8, 'ab': 8, 'a': 9, 'a#': 10, 'bb': 10, 'b': 11}


def note2midi(name):
    m = re.match(r'([A-Ga-g](?:#|b)?)(-?\d)$', name)
    return 12 * (int(m.group(2)) + 1) + NOTE[m.group(1).lower()]


def decode(path, tune_cents=0.0):
    """Decode to mono float32 at SR. tune_cents applies a playback-rate fine-tune correction."""
    info = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=sample_rate,channels',
                           '-of', 'csv=p=0', path], capture_output=True, text=True, check=True).stdout.strip().split(',')
    sr, ch = int(info[0]), int(info[1])
    af = []
    if ch == 2:
        af.append('pan=mono|c0=0.5*c0+0.5*c1')
    elif ch != 1:
        raise RuntimeError(f'{path}: {ch} channels')
    if tune_cents:
        af.append(f'asetrate={sr * 2 ** (tune_cents / 1200):.6f}')
    af.append(f'aresample={SR}:resampler=soxr:precision=28')
    out = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-af', ','.join(af), '-f', 'f32le', '-ac', '1', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype='<f4').astype(np.float64)


def process(x):
    peak = np.max(np.abs(x))
    thr = peak * 10 ** (THR_DB / 20)
    # noise-floor aware onset: some sources (Salamander) have a -40..-50 dB pre-attack noise bed,
    # so find the -30 dB crossing and walk back while the envelope is still clearly above the
    # lead-in noise (and above -50 dB re peak).
    H = 12  # 0.5 ms hops
    nh = len(x) // H
    env = np.abs(x[:nh * H]).reshape(nh, H).max(axis=1)
    noise = np.median(env[:4])
    i = int(np.argmax(env > peak * 10 ** (-30 / 20)))
    floor = max(thr, noise * 2.5)
    while i > 0 and env[i - 1] > floor:
        i -= 1
    seg = np.abs(x[i * H:(i + 1) * H])
    idx = i * H + (int(np.argmax(seg > floor)) if np.any(seg > floor) else 0)
    # never keep more than 1.5 ms of sub -30 dB lead-in before the -30 dB crossing
    i30 = int(np.argmax(np.abs(x) > peak * 10 ** (-30 / 20)))
    idx = max(idx, i30 - int(0.0015 * SR))
    start = max(0, idx - PREROLL)
    y = x[start:start + int(MAXLEN * SR)].copy()
    # tiny fade-in over the sub-threshold pre-roll only (never touches the attack)
    pre = max(idx - start, int(0.001 * SR)) if idx > 0 else 0  # <= -30 dB region only
    if pre > 1:
        y[:pre] *= 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, pre))
    n = len(y)
    nf = min(int(FADE * SR), n // 2)
    y[n - nf:] *= np.linspace(1.0, 0.0, nf)
    return y, start / SR, idx / SR


def write_wav(path, y):
    pcm = np.clip(np.round(y * 32767), -32768, 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def ranges(n):
    """Split 1..127 evenly into n ranges."""
    edges = [round(1 + i * 127 / n) for i in range(n + 1)]
    return [[edges[i], edges[i + 1] - 1 if i < n - 1 else 127] for i in range(n)]


# ---------------------------------------------------------------- job lists
def grand_jobs():
    base = 'SalamanderGrandPianoV3_44.1khz16bit/44.1khz16bit'
    sfz = open(f'{DL}/sal/SalamanderGrandPianoV3_44.1khz16bit/SalamanderGrandPianoV3.sfz').read()
    layers = [('v1', 4), ('v2', 8), ('v3', 15)]
    # Per-note equal-temperament corrections from the distribution's own SalamanderGrandPianoV3Retuned.sfz
    # (retuning by Markus Fiedler). C8 is overridden: its samples measure ~+95..100 cents (a C#8), which the
    # retuned SFZ (-38) does not fix, so we apply -100 cents (measured, see verify.py).
    rt = open(f'{DL}/sal/SalamanderGrandPianoV3_44.1khz16bit/SalamanderGrandPianoV3Retuned.sfz').read()
    retune = {m.group(1): float(m.group(2)) for m in re.finditer(r'44\.1khz16bit\\(\S+\.wav)[^\n<]*?tune=(-?\d+)', rt)}
    retune.update({f'C8v{v}.wav': -100.0 for v in range(1, 17)})
    rr = ranges(len(layers))
    jobs = []
    names = ['A0'] + [f'{n}{o}' for o in range(1, 8) for n in ('C', 'D#', 'F#', 'A')] + ['C8']
    for li, (lay, sv) in enumerate(layers):
        for nm in names:
            fn = f'{nm}v{sv}.wav'
            m = re.search(r'<region> sample=44\.1khz16bit\\' + re.escape(fn) + r' lokey=(\d+) hikey=(\d+) lovel=(\d+) hivel=(\d+)(?: pitch_keycenter=(\d+))?', sfz)
            assert m, fn
            lo, hi = int(m.group(1)), int(m.group(2))
            root = note2midi(nm)
            kc = int(m.group(5)) if m.group(5) else 60  # SFZ default keycenter
            if m.group(5) is None:
                # regions without pitch_keycenter: sample is played unshifted across lokey..hikey only if root in range
                assert lo <= root <= hi, (fn, lo, hi)
            else:
                assert kc == root, (fn, kc, root)
            jobs.append(dict(src=f'{DL}/sal/{base}/{fn}', originalFile=f'{base}/{fn}', rootMidi=root, layer=lay,
                             sourceVelocityLabel=f'v{sv} of 16 (source SFZ vel {m.group(3)}-{m.group(4)})',
                             velocityRange=rr[li], tune=retune.get(fn, 0.0)))
    return jobs


def upright_jobs():
    base = 'UprightPianoKW-SFZ+FLAC-20220221'
    sfz = open(f'{DL}/up/{base}/UprightPianoKW-20220221.sfz').read()
    regions = {}
    for r in sfz.split('<region>')[1:]:
        d = dict(re.findall(r'(\w+)=(\S+)', r))
        if 'pitch_keycenter' in d:
            regions[d['sample'].split('/')[-1]] = d
    jobs = []
    grid = ['A0'] + [f'{n}{o}' for o in range(1, 8) for n in ('C', 'D#', 'F#', 'A')] + ['C8']
    subs_H = {'A2': 'B2', 'C4': 'B3', 'C8': 'B7'}  # vH missing/unmapped in source -> nearest mapped vH sample
    for lay, tag, lab, vr in (('v1', 'L', 'vL (source SFZ vel 1-80)', [1, 80]),
                              ('v2', 'H', 'vH (source SFZ vel 81-127)', [81, 127])):
        for nm in grid:
            use = nm
            if tag == 'H' and nm in subs_H:
                use = subs_H[nm]
            fn = f'{use}v{tag}.flac'
            d = regions[fn]
            root = note2midi(use)
            assert int(d['pitch_keycenter']) == root, (fn, d)
            jobs.append(dict(src=f'{DL}/up/{base}/samples/{fn}', originalFile=f'{base}/samples/{fn}', rootMidi=root,
                             layer=lay, sourceVelocityLabel=lab, velocityRange=vr, tune=float(d.get('tune', 0)) ))
    return jobs


def wurli_jobs():
    sfz = open(f'{DL}/wurli/Wurlitzer_EP200.sfz').read()
    groups = sfz.split('<group>')[1:]
    layer_of = {'pp': 'v1', 'mp': 'v2', 'f': 'v3', 'ff': 'v4'}
    jobs = []
    for g in groups:
        lovel = int(re.search(r'lovel=(\d+)', g).group(1)); hivel = int(re.search(r'hivel=(\d+)', g).group(1))
        glab = re.search(r'group_label=(\w+)', g).group(1)
        seen = set()
        for line in g.splitlines():
            if not line.startswith('<region>'):
                continue
            d = dict(re.findall(r'(\w+)=(\S+)', line))
            fn = d['sample'].replace('.$EXT', '.flac')
            if fn in seen:
                continue
            seen.add(fn)
            root = int(d['pitch_keycenter'])
            nm = re.match(r'([a-g]b?\d)', fn).group(1)
            assert note2midi(nm) == root, (fn, root)
            srclayer = re.match(r'[a-g]b?\d(\w+)\.flac', fn).group(1)
            jobs.append(dict(src=f'{DL}/wurli/{fn}', originalFile=f'Wurlitzer EP200/Samples/{fn}', rootMidi=root,
                             layer=layer_of[glab],
                             sourceVelocityLabel=f'{glab} group (source SFZ vel {lovel}-{hivel}); sample recorded at {srclayer}',
                             velocityRange=[lovel, hivel], tune=float(d.get('tune', 0))))
    return jobs


def rhodes_jobs():
    sfz = open(f'{DL}/rhodes/005-Electric_Piano_1.sfz').read()
    jobs = []
    for m in re.finditer(r'sample=005-Electric Piano 1/(A_(\d+)__\w+?_(\d)\.wav) lokey=\d+ hikey=\d+ pitch_keycenter=(\d+)', sfz):
        fn, root, lay5, kc = m.group(1), int(m.group(2)), m.group(3), int(m.group(4))
        assert root == kc
        jobs.append(dict(src=f'{DL}/rhodes/{fn}', originalFile=f'Discord GM/Melodic/005-Electric Piano 1/{fn}',
                         rootMidi=root, layer='v1', sourceVelocityLabel=f'jRhodes3 velocity layer {lay5} of 5',
                         velocityRange=[1, 127], tune=0.0))
    return jobs


META = {
    'grand': dict(
        name='Salamander Grand Piano V3', author='Alexander Holm',
        source='https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html',
        download='https://freepats.zenvoid.org/Piano/SalamanderGrandPiano/SalamanderGrandPianoV3+20161209_44khz16bit.tar.xz',
        license='CC-BY-3.0', licenseUrl='http://creativecommons.org/licenses/by/3.0/',
        attribution='Salamander Grand Piano V3 by Alexander Holm (CC BY 3.0, https://creativecommons.org/licenses/by/3.0/). '
                    'Samples converted to 24 kHz mono, trimmed and faded.',
        recordedInstrument='Yamaha C5 grand piano (two AKG C414, AB pair)',
        notes='Layers: v1=source v4 (p), v2=source v8 (mp/mf), v3=source v15 (ff) of 16. Relative level between layers preserved. '
              'Pitch: per-note fine-tune from the distribution\'s SalamanderGrandPianoV3Retuned.sfz baked in (fineTuneAppliedCents); '
              'C8 samples measured ~1 semitone sharp (≈C#8) so -100 cents was applied instead.'),
    'upright': dict(
        name='Upright Piano KW (2022-02-21)', author='FreePats project (recorded by Gonzalo and Roberto, edited by Roberto <roberto@zenvoid.org>)',
        source='https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html#UprightKW',
        download='https://freepats.zenvoid.org/Piano/UprightPianoKW/UprightPianoKW-SFZ+FLAC-20220221.7z',
        license='CC0-1.0', licenseUrl='https://creativecommons.org/publicdomain/zero/1.0/',
        attribution='Upright Piano KW from the FreePats project (CC0 1.0; attribution not required).',
        recordedInstrument='Kawai upright piano (Zoom H1, player position)',
        notes='Layers: v1=vL, v2=vH (the only two source layers; source split at velocity 80/81). Source files are individually '
              'peak-normalized (vL and vH both peak near 0 dBFS), so velocity loudness must come from the engine\'s velocity->gain curve. '
              'vH is missing/unmapped for A2, C4, C8 in the source; B2vH, B3vH, B7vH are used instead (roots 47, 59, 107). '
              'Upper notes are naturally short in the source (0.4-3 s above A4). Tuning left as recorded: bass (A0-C2) measures ~30-45 cents flat '
              '(stretched/aged tuning), see measuredCents.'),
    'electric': dict(
        name='Wurlitzer EP200 Electric Piano v1.1 (Greg Sullivan E-Pianos, SFZ port by kinwie)', author='Greg Sullivan',
        source='https://github.com/sfzinstruments/GregSullivan.E-Pianos',
        download='https://github.com/sfzinstruments/GregSullivan.E-Pianos/tree/8c3e581acda3594b553948ff0222d4f84a698376/Wurlitzer%20EP200/Samples',
        license='CC-BY-3.0', licenseUrl='http://creativecommons.org/licenses/by/3.0/',
        attribution='Wurlitzer EP200 samples by Greg Sullivan (http://www.sullivang.net/), SFZ/FLAC edition by kinwie / sfzinstruments, '
                    'licensed CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/). Samples converted to 24 kHz, fine-tuned per source SFZ, trimmed and faded.',
        recordedInstrument='Wurlitzer 200 (EP200) reed electric piano',
        notes='Four layers exactly as the source SFZ groups: v1=pp [1-37], v2=mp [38-65], v3=f [66-89], v4=ff [90-127]. Roots differ per layer '
              '(source samples every ~3-6 semitones, A1..Ab6, the EP200 range is A1-C7). Where the source SFZ reuses a sample from another '
              'layer (pp uses mp samples above Db5; ff uses f samples for Db6/Ab6) the file is duplicated so each layer covers the full range. '
              'Source files are individually peak-normalized, so velocity loudness must come from the engine. Source SFZ tune offsets are baked in. '
              'Samples are short/decaying (0.4-4 s), no loops.'),
}
META_EXTRA = {
    'electric_rhodes': dict(
        name='jRhodes3 GM subset (Discord SFZ GM Bank, 005-Electric Piano 1)', author='Jeff Learman',
        source='https://github.com/sfzinstruments/Discord-SFZ-GM-Bank',
        download='https://github.com/sfzinstruments/Discord-SFZ-GM-Bank/tree/7a9c478fe331f94f246d33332f0adedb25bbbe27/Discord%20GM/Melodic/005-Electric%20Piano%201',
        license='CC0-1.0', licenseUrl='https://creativecommons.org/publicdomain/zero/1.0/',
        attribution='Rhodes samples by Jeff Learman (jRhodes3, GM subset from the Discord SFZ GM Bank), CC0 1.0; attribution not required.',
        recordedInstrument='1977 Rhodes Mark I Stage 73 (recorded from harp connector, with EQ)',
        notes='Optional alternate electric piano (Rhodes). Only ONE velocity layer (jRhodes layer 3 of 5 below F4, layer 4 of 5 above) and roots every '
              '~5 semitones (F1..C7) are CC0; the full 5-layer jRhodes3c/3d sets are CC BY-NC 4.0 and were NOT used.'),
}

JOBS = {'grand': grand_jobs, 'upright': upright_jobs, 'electric': wurli_jobs, 'electric_rhodes': rhodes_jobs}


def build(inst, gain=1.0):
    outdir = f'{S}/{inst}'
    os.makedirs(outdir, exist_ok=True)
    for f in os.listdir(outdir):
        os.remove(f'{outdir}/{f}')
    zones = []
    for j in JOBS[inst]():
        x = decode(j['src'], j['tune']) * gain
        y, trim, onset = process(x)
        fname = f"{inst}_{j['rootMidi']:03d}_{j['layer']}.wav"
        assert not os.path.exists(f'{outdir}/{fname}'), fname
        write_wav(f'{outdir}/{fname}', y)
        z = dict(file=fname, originalFile=j['originalFile'], rootMidi=j['rootMidi'], layer=j['layer'],
                 sourceVelocityLabel=j['sourceVelocityLabel'], velocityRange=j['velocityRange'])
        if j['tune']:
            z['fineTuneAppliedCents'] = j['tune']
        z['durationSec'] = round(len(y) / SR, 3)
        z['leadingTrimSec'] = round(trim, 4)
        z['peakDbfs'] = round(20 * np.log10(np.max(np.abs(y)) + 1e-12), 2)
        zones.append(z)
    zones.sort(key=lambda z: (z['layer'], z['rootMidi']))
    return zones


if __name__ == '__main__':
    gains = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
    man, extra = {}, {}
    for inst in ('grand', 'upright', 'electric', 'electric_rhodes'):
        g = float(gains.get(inst, 1.0))
        zones = build(inst, g)
        meta = dict((META | META_EXTRA)[inst])
        meta['instrumentGain'] = g
        meta['processing'] = ('mono (stereo sources mixed (L+R)/2), fine-tune (fineTuneAppliedCents) via rate change, soxr resample to 24000 Hz, '
                              '16-bit PCM; onset: first sample above max(-50 dB re file peak, 2.5x lead-in noise) walking back from the -30 dB '
                              'crossing, capped at 1.5 ms before that crossing, minus 0.5 ms pre-roll with 1 ms raised-cosine fade-in; '
                              'max 4.0 s; linear fade-out over final 0.6 s (or half the length if shorter); no per-file normalization; '
                              'instrumentGain applied uniformly')
        meta['zones'] = zones
        (man if inst in META else extra)[inst] = meta
        pk = max(z['peakDbfs'] for z in zones)
        print(f'{inst}: {len(zones)} zones, max peak {pk} dBFS, layers {sorted(set(z["layer"] for z in zones))}')
    json.dump(man, open(f'{S}/manifest.json', 'w'), indent=2)
    json.dump(extra, open(f'{S}/manifest-extra.json', 'w'), indent=2)
