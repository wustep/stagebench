# Licenses of the sample pack

Pack `stagebench-raw-samples` version 2.0.0: 696 recordings, 501.1 MB, from 5 sources. Every
file is fetched from the pinned upstream commit below and checked against the sha256 in the manifest; none is
modified. Each source's own license statement is included beside its recordings.

## Salamander Grand Piano V3

- **What:** Yamaha C5 grand piano. 401 recordings, 357.2 MB. FLAC, 48 kHz, 24-bit, stereo (two AKG C414 in AB, about 12 cm above the strings).
- **Author:** Alexander Holm
- **License:** CC-BY-3.0 — https://creativecommons.org/licenses/by/3.0/
- **Upstream:** https://github.com/sfzinstruments/SalamanderGrandPiano at commit `3382bf9496bba2486f5ab0de55a264d1dfc38404` (project page: https://archive.org/details/SalamanderGrandPianoV3)
- **In the pack:** `grand/salamander-grand-v3/`. Eight of the sixteen velocity layers (v1, v2, v3, v4, v7, v10, v13, v16) for all 30 sampled notes (minor thirds, A0 to C8), plus every auxiliary recording: 88 hammer-release noises (rel*), 69 string-resonance recordings (harm*), and 4 pedal noises. v2 and v3 were added to the first six because the step from v1 to v4 (about 9 dB) was three times any other step between the kept layers; with them the largest step is under 5 dB. The other eight layers are left out to keep the pack a reasonable size; nothing that is included is altered.
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

## Rhodes Mark I, GM version (Discord SFZ GM Bank)

- **What:** 1977 Rhodes Mark I Stage 73 (tine electric piano), recorded from the harp output. 15 recordings, 5.9 MB. WAV, 44.1 kHz, 16-bit, mono; shortened and looped by the author (loop points in each file's `smpl` chunk).
- **Author:** Jeff Learman
- **License:** CC0-1.0 — https://creativecommons.org/publicdomain/zero/1.0/
- **Upstream:** https://github.com/sfzinstruments/Discord-SFZ-GM-Bank at commit `7a9c478fe331f94f246d33332f0adedb25bbbe27`
- **In the pack:** `electric/learman-rhodes-gm/`. The whole instrument as its author published it in the bank (General MIDI program 5, Electric Piano 1): 15 recordings, one dynamic per note, a root every three to six semitones from F1 to C7, with its SFZ mappings and the bank README. The other instruments in the bank are not included.
- **Attribution:** Rhodes Mark I samples (jRhodes GM version) by Jeff Learman, CC0 1.0 (public domain dedication). Source: https://github.com/sfzinstruments/Discord-SFZ-GM-Bank
- **Why this license holds.** These recordings are a separate release from the author's jRhodes3c and jRhodes3d sets, which are CC BY-NC (see below). Three statements, all the author's or the bank's own:
  1. The instrument's SFZ, `Discord GM/Melodic/005-Electric Piano 1.sfz`, begins "Author: Jeff Learman … License: Creative Commons CC0, Jeff Learman … Mapped and relooped for GM by jlearman". The samples and that header were committed by the author's own GitHub account (`jlearman`, commits `05d5ed8befa0` in October 2020 and `945cca9cab6e` in October 2021).
  2. The bank's README: each instrument is licensed by its creator, its terms are in its `.sfz` file, and only CC0, CC BY, and equivalent licenses are allowed, so that the bank can be used in products.
  3. The author, on KVR Audio on 14 November 2022 (https://www.kvraudio.com/forum/viewtopic.php?p=8555554#p8555554): "the Discord GM sampleset … is all intended to be CC0, and each instrument has license information in the sfz file. The Rhodes and acoustic guitar are CC0 for sure because I released them."

  The jRhodes3c `LICENSE`, updated by the author in November 2025, still describes jRhodes3c alone; it does not mention the GM version, and a CC0 dedication cannot be withdrawn.

## VCSL Pipe Organ

- **What:** Pipe organ, two registrations on the third manual. 42 recordings, 86.2 MB. WAV, 44.1 kHz, 16-bit, stereo, about 12 s per note.
- **Author:** Simon Dalzell (Ivy Audio), for Versilian Studios
- **License:** CC0-1.0 — https://creativecommons.org/publicdomain/zero/1.0/
- **Upstream:** https://github.com/sgossner/VCSL at commit `c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e`
- **In the pack:** `organ/vcsl-pipe-organ/`. The two manual registrations, Loud (Rode_Man3Open_*) and Quiet (NT5_Man3Quiet_*), each with 21 notes in minor thirds from C1 to C6, plus the set's Info.txt and the library README and LICENSE. The two pedal registrations (22 recordings) and the blower noise are left out for size, as is the rest of the library.
- **Attribution:** Pipe organ samples by Simon Dalzell (Ivy Audio), from the Versilian Community Sample Library by Versilian Studios LLC, CC0 1.0 (public domain dedication). Source: https://github.com/sgossner/VCSL
- **The license, at the source.** The library's `LICENSE` is the CC0 1.0 legal code, and its README says the collection is CC0, usable in commercial software with no credit required. The set's `Info.txt` says it was sampled by Simon Dalzell of Ivy Audio in the winter of 2015–16 and that Versilian Studios grants the right to redistribute it; it asks for credit to both, which the attribution line gives. Versilian's VSCO 2 Community Edition (also CC0) carries the same set under `Keys/Organ/`, with the same `Info.txt`.

## What the licenses allow

| License | Use and redistribute | Adapt | Condition |
| --- | --- | --- | --- |
| CC BY 3.0 (Creative Commons Attribution 3.0 Unported) | Yes, including commercially | Yes | Credit the author, link the license, and say if changes were made |
| CC0 1.0 (public domain dedication) | Yes | Yes | None |

## Considered and left out

- **jRhodes3d and jRhodes3c** (1977 Rhodes Mark I, Jeff Learman): their samples are CC BY-NC 4.0 (3c: BY-NC-SA) when
  redistributed in an application. Non-commercial terms are not permissive, so they are not in the pack. The
  pack's tine piano is the author's separate CC0 release above: one dynamic and fifteen roots, where jRhodes3d
  has up to five dynamics and 92 MB.
- **FreePats Electric Organ and Church Organ** (CC0): renders of software synthesizers (the setBfree tonewheel
  emulator and the Aeolus pipe organ synthesizer), not recordings of an organ.
- **Discord GM Bank's other organs** (programs 17 to 20): placeholders with no samples.
- **The G-Town Church Sampling Project** (Tobias Marberger; has an organ): Creative Commons Sampling Plus 1.0,
  which allows redistribution of the whole work only for non-commercial purposes.
- **Orgue Eglise** (`sfzinstruments/OrgueEglise`): converted from a GigaSampler set by an unnamed author and
  published with no license.
- **Hammond M100 organ drones** (Chris Beckstrom, CC BY 4.0, archive.org): chords and clusters held down, not one
  note at a time, so not a playable sample set.
- **No recorded tonewheel (Hammond-style) or combo organ** with a permissive license and single-note samples was
  found on GitHub, archive.org, FreePats, or Wikimedia Commons. Musical Artifacts lists Hammond and Rhodes
  soundfonts marked CC BY or public domain, but they are already-mapped soundfonts whose recordings' origin their
  uploaders do not state, or renders of commercial instruments (Pianoteq, for one). Freesound's CC0 uploads need an
  account to download, so a pinned, verifiable fetch is not possible.
- **Commercial and soundfont-derived libraries** (rendered General MIDI soundfonts, renders of commercial software
  instruments, vendor sample libraries): not raw recordings, and often not redistributable.
- **The remaining eight Salamander velocity layers**: same license, left out for size only (the full set is 714 MB).
- **The rest of the VCSL Pipe Organ** (two pedal registrations and the blower noise, 52 MB as WAV) and **VCSL's
  Renaissance Organ** (8', 4', and full registrations, 139 MB as WAV): same license, left out for size.
