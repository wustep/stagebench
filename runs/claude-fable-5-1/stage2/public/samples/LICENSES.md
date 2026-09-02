# Sample library licences and attribution

Every recorded sample set bundled under `public/samples/` is redistributable. This file reproduces the
attribution each source asks for. In every set the recordings were changed the same way (see each
`manifest.json` → `processing`): stereo recordings were down-mixed to mono, the silence before the attack
was trimmed, the tail was cut at the natural end or at 7 / 5 / 3.5 s (bass / mid / treble) with a 0.4 s fade,
one gain per set was applied for level consistency, and the result was encoded as 44.1 kHz Ogg Vorbis (q 3).
Where a source SFZ carried per-region tuning, start offsets, end points or volume, those were applied. No
source material was described as anything other than a recording, and nothing in the library is synthesized.

## Salamander Grand Piano V3 — `grand-salamander`

- Title: Salamander Grand Piano V3 (SalamanderGrandPianoV3+20161209, 44.1 kHz / 16-bit edition)
- Author: Alexander Holm (axeldenstore at gmail dot com)
- Source: https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html (FreePats mirror of the original release)
- Licence: Creative Commons Attribution 3.0 Unported (CC-BY 3.0), http://creativecommons.org/licenses/by/3.0/
- Instrument: Yamaha C5 grand piano, recorded with two AKG C414 in an AB pair about 12 cm above the strings, 16 velocity
  layers sampled in minor thirds from A0.
- Changes: only velocity layers v3, v7, v11 and v15 of the sustain samples are bundled (no release, pedal or string
  resonance samples); mono down-mix, trimming, per-set gain and Vorbis encoding as described above.

## Upright Piano KW — `upright-kw`

- Title: Upright Piano KW (version 2022-02-21)
- Authors: recorded by Gonzalo (humanogonzalo at gmail dot com) and Roberto (roberto at zenvoid dot org) for the FreePats
  project, January 2017; edited by Roberto with free software.
- Source: https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html#UprightKW and
  https://github.com/freepats/upright-piano-KW
- Licence: Creative Commons CC0 1.0 Universal public domain dedication, http://creativecommons.org/publicdomain/zero/1.0/
- Instrument: Kawai upright piano in a living room, Zoom H1 recorder on a tripod at the player's head position, two
  velocity layers in minor thirds.
- Changes: the source's bass-note loops are not used (one-shots, capped); mono down-mix, trimming, per-set gain and
  Vorbis encoding as described above.

## Greg Sullivan's E-Pianos — `electric-wurlitzer-200`, `electric-pianet-t`, `electric-cp80`

- Titles: Wurlitzer EP200 Electric Piano v1.1 (16 May 1999); Hohner Pianet T (type 2) v1.3 (24 Sep 2004); Yamaha CP80
  Electric Grand Piano v1.3 (29 Sep 2004)
- Author: Greg Sullivan, http://www.sullivang.net/ — shared with the author's permission with the request for
  attribution; SFZ mapping and FLAC conversion by kinwie for the sfzinstruments organisation.
- Source: https://github.com/sfzinstruments/GregSullivan.E-Pianos
- Licence: Creative Commons Attribution 3.0 Unported (CC-BY 3.0), http://creativecommons.org/licenses/by/3.0/
- Changes: the SFZ's per-region tune (cents), start offset, end point and volume were baked into the bundled files; the
  Pianet's release samples are not bundled; a sample the SFZ reuses for several velocity bands is bundled once per band;
  mono down-mix (the recordings are mono/stereo as supplied), trimming, per-set gain and Vorbis encoding as described above.

## Versilian Community Sample Library (VCSL) — `digital-tx81z-fm`, `clav-harpsichord`, `misc-marimba`

- Title: Versilian Community Sample Library (VCSL)
- Author: Versilian Studios LLC (Samuel Gossner) and the VCSL contributors
- Source: https://github.com/sgossner/VCSL — folders `Electrophones/TX81Z/FM Piano` (a Yamaha TX81Z FM synthesizer
  sampled from the hardware with a user-created "FM Piano" patch; a recorded digital piano sound), `Chordophones/Zithers/
  Harpsichord, Flemish/Sustains/Low` and `Idiophones/Struck Idiophones/Marimba`
- Licence: Creative Commons CC0 1.0 Universal public domain dedication, http://creativecommons.org/publicdomain/zero/1.0/
  ("you can do whatever you want with these sounds … no royalties, no credit, no special terms")
- Changes: the harpsichord and marimba file names follow the C3 = 60 octave convention, so their roots were corrected by
  one octave after pitch verification; velocity splits (1-42 / 43-84 / 85-127 for three layers, 1-127 for the single
  harpsichord layer) were assigned here; first round robin only; mono down-mix, trimming, per-set gain and Vorbis encoding
  as described above.
