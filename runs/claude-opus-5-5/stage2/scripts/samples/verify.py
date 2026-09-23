#!/usr/bin/env python3
"""Verify every WAV: 24 kHz mono 16-bit, non-silent, pitch near rootMidi (harmonic-sum estimator)."""
import json, os, wave, sys
import numpy as np

S = os.path.dirname(os.path.abspath(__file__)) + "/samples"


def est_offset(x, sr, root):
    """Return (best semitone offset in -6..+6, cents deviation) relative to root."""
    f_root = 440 * 2 ** ((root - 69) / 12)
    a, b = int(0.03 * sr), int(min(len(x), (3.0 if root < 48 else 1.2) * sr))
    seg = x[a:b] * np.hanning(b - a)
    N = 1 << 19
    spec = np.abs(np.fft.rfft(seg, N))
    freqs = np.fft.rfftfreq(N, 1 / sr)
    spec = spec / (spec.max() + 1e-12)
    lspec = np.log10(spec + 1e-4)  # compress

    def score(f0, tol_cents=35):
        s, n = 0.0, 0
        for h in range(1, 13):
            fh = f0 * h
            if fh > sr / 2 - 200:
                break
            lo, hi = fh * 2 ** (-tol_cents / 1200), fh * 2 ** (tol_cents / 1200) * (1 + 0.0004 * h * h)
            i0, i1 = np.searchsorted(freqs, [lo, hi])
            if i1 <= i0:
                continue
            s += lspec[i0:i1].max(); n += 1
        return s / max(n, 1)

    cands = [(score(f_root * 2 ** (k / 12)), k) for k in range(-6, 7)]
    best = max(cands)[1]
    # fine cents: precise frequency of the strongest of partials 1..3 (low partials, little inharmonicity)
    f0 = f_root * 2 ** (best / 12)
    bestc, bestamp = 0, -1
    for h in (1, 2, 3):
        fh = f0 * h
        if fh > sr / 2 - 200:
            break
        i0, i1 = np.searchsorted(freqs, [fh * 2 ** (-60 / 1200), fh * 2 ** (60 / 1200)])
        if i1 <= i0:
            continue
        j = i0 + int(np.argmax(spec[i0:i1]))
        if spec[j] > bestamp:
            bestamp, bestc = spec[j], int(round(1200 * np.log2(freqs[j] / fh)))
    return best, bestc


def main():
    man = json.load(open(f'{S}/manifest.json'))
    extra = json.load(open(f'{S}/manifest-extra.json'))
    total = 0; bad = []
    for inst, meta in list(man.items()) + list(extra.items()):
        files = set(os.listdir(f'{S}/{inst}'))
        listed = {z['file'] for z in meta['zones']}
        if files != listed:
            bad.append(f'{inst}: file set mismatch {files ^ listed}')
        offs = []
        for z in meta['zones']:
            p = f"{S}/{inst}/{z['file']}"
            total += os.path.getsize(p)
            w = wave.open(p)
            if (w.getframerate(), w.getnchannels(), w.getsampwidth()) != (24000, 1, 2):
                bad.append(f"{z['file']}: format {w.getparams()}")
            x = np.frombuffer(w.readframes(w.getnframes()), '<i2').astype(float) / 32768
            rms = 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)
            if rms < -60 or np.abs(x).max() < 0.003:
                bad.append(f"{z['file']}: near-silent rms {rms:.1f}")
            if w.getnframes() / 24000 > 4.0001:
                bad.append(f"{z['file']}: too long")
            k, c = est_offset(x, 24000, z['rootMidi'])
            offs.append((z['file'], k, c)); z['measuredCents'] = int(k * 100 + c)
            if k != 0 or abs(c) > 30:
                bad.append(f"{z['file']}: pitch offset {k:+d} st {c:+d} c vs root {z['rootMidi']}")
        cents = [c for _, k, c in offs if k == 0]
        print(f"{inst}: {len(offs)} files, semitone-exact {sum(1 for _, k, _ in offs if k == 0)}/{len(offs)}, "
              f"cents median {np.median(cents):+.0f}, range [{min(cents):+d},{max(cents):+d}]")
    if '--write' in sys.argv:
        for m, fn in ((man, 'manifest.json'), (extra, 'manifest-extra.json')):
            for meta in m.values():
                meta['measuredCentsNote'] = ('measuredCents: approximate deviation of the processed file from equal-tempered rootMidi '
                                             '(A4=440), estimated from partials 1-3; informational only')
            json.dump(m, open(f'{S}/{fn}', 'w'), indent=2, ensure_ascii=False)
    print(f'total WAV bytes: {total} ({total / 1048576:.2f} MiB)')
    print('ISSUES:' if bad else 'no issues', *bad, sep='\n  ')


main()
