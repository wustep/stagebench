# Licenses of the sample pack

Pack `stagebench-raw-samples` version 1.0.0: 579 recordings, 330.4 MB, from 3 sources. Every
file is fetched from the pinned upstream commit below and checked against the sha256 in the manifest; none is
modified. Each source's own `LICENSE` file is included beside its recordings.

## Salamander Grand Piano V3

- **What:** Yamaha C5 grand piano. 341 recordings, 278.6 MB. FLAC, 48 kHz, 24-bit, stereo (two AKG C414 in AB, about 12 cm above the strings).
- **Author:** Alexander Holm
- **License:** CC-BY-3.0 — https://creativecommons.org/licenses/by/3.0/
- **Upstream:** https://github.com/sfzinstruments/SalamanderGrandPiano at commit `3382bf9496bba2486f5ab0de55a264d1dfc38404` (project page: https://archive.org/details/SalamanderGrandPianoV3)
- **In the pack:** `grand/salamander-grand-v3/`. Six of the sixteen velocity layers (v1, v4, v7, v10, v13, v16) for all 30 sampled notes (minor thirds, A0 to C8), plus every auxiliary recording: 88 hammer-release noises (rel*), 69 string-resonance recordings (harm*), and 4 pedal noises. The other ten velocity layers are left out to keep the pack a reasonable size; nothing that is included is altered.
- **Attribution:** Salamander Grand Piano V3 by Alexander Holm, licensed under CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/). Source: https://archive.org/details/SalamanderGrandPianoV3

## Upright Piano KW

- **What:** Kawai upright piano, recorded in a living room. 66 recordings, 31.3 MB. FLAC, 44.1 kHz, 24-bit, stereo (Zoom H1 at the player position).
- **Author:** Gonzalo and Roberto (FreePats project)
- **License:** CC0-1.0 — https://creativecommons.org/publicdomain/zero/1.0/
- **Upstream:** https://github.com/freepats/upright-piano-KW at commit `570f6c60ed2eff67accad3b85d5b452e57a3ad28` (project page: https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html)
- **In the pack:** `upright/upright-piano-kw/`. The whole published sample set: 66 recordings in two dynamics (vL, vH), with the upstream README, LICENSE, and SFZ mapping.
- **Attribution:** Upright Piano KW by Gonzalo and Roberto, FreePats project, CC0 1.0 (public domain dedication). Source: https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html

## Greg Sullivan's E-Pianos

- **What:** Wurlitzer EP200 (reed), Hohner Pianet T (reed), Yamaha CP80 (electric grand). 172 recordings, 20.5 MB. FLAC, 44.1 kHz, 16-bit, mono.
- **Author:** Greg Sullivan
- **License:** CC-BY-3.0 — https://creativecommons.org/licenses/by/3.0/
- **Upstream:** https://github.com/sfzinstruments/GregSullivan.E-Pianos at commit `8c3e581acda3594b553948ff0222d4f84a698376` (project page: http://www.sullivang.net/)
- **In the pack:** `electric/greg-sullivan-e-pianos/`. The whole published set: all three instruments with their SFZ mappings, the upstream README, and LICENSE.
- **Attribution:** Wurlitzer EP200, Hohner Pianet T, and Yamaha CP80 samples by Greg Sullivan (http://www.sullivang.net/), licensed under CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/). Source: https://github.com/sfzinstruments/GregSullivan.E-Pianos

## What the licenses allow

| License | Use and redistribute | Adapt | Condition |
| --- | --- | --- | --- |
| CC BY 3.0 (Creative Commons Attribution 3.0 Unported) | Yes, including commercially | Yes | Credit the author, link the license, and say if changes were made |
| CC0 1.0 (public domain dedication) | Yes | Yes | None |

## Considered and left out

- **jRhodes3d** (1977 Rhodes Mark I, Jeff Learman): its samples are CC BY-NC 4.0 when redistributed in an
  application. Non-commercial terms are not permissive, so it is not in the pack. (This is why the pack's electric
  pianos are reed instruments and an electric grand, with no tine piano.)
- **Commercial and soundfont-derived libraries** (rendered General MIDI soundfonts, vendor sample libraries): not
  raw recordings, and often not redistributable.
- **The remaining ten Salamander velocity layers**: same license, left out for size only (the full set is 714 MB).
