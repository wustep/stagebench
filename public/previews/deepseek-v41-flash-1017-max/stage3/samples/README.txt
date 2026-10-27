SAMPLE SET PROVENANCE — Nord Stage 4 (73) candidate, Phase 2

This directory contains audio derived from three separately licensed recordings.
Every file under grand/, upright/ and electric/ is a trimmed, mono, 44.1 kHz MP3
derivative of the corresponding original recording. No EQ, compression, reverb or
other tone shaping has been applied; see IMPLEMENTATION_DETAILS.json for the exact
per-file provenance, root notes and velocity layers.

------------------------------------------------------------------
1. Grand — Salamander Grand Piano V3 (Yamaha C5)
   Recorded by Alexander Holm.
   Source:  https://github.com/sfzinstruments/SalamanderGrandPiano
   Licence: CC BY 3.0 Unported — https://creativecommons.org/licenses/by/3.0/
   Full text: LICENSE-salamander.txt
   Files: grand/*.mp3

2. Upright — VSCO 2 Community Edition "Upright Piano"
   Recorded by Simon Dalzell of Ivy Audio, Winter 2015-16.
   Redistributed by Versilian Studios LLC.
   Source:  https://github.com/sgossner/VSCO-2-CE
   Licence: CC0 1.0 Universal (public domain dedication)
   Full text: LICENSE-vsco2.txt
   Files: upright/*.mp3

3. Electric — Greg Sullivan's E-Pianos, Yamaha CP80 Electric Grand
   Sampled by Greg Sullivan, SFZ mapping by kinwie.
   Source:  https://github.com/sfzinstruments/GregSullivan.E-Pianos
   Licence: CC BY 3.0 Unported — https://creativecommons.org/licenses/by/3.0/
   Full text: LICENSE-gregsullivan-epianos.txt
   Files: electric/cp80/*.mp3

------------------------------------------------------------------
Clav, Digital and Misc are NOT recordings. They are synthesised in
src/audio/pianoVoice.ts from the additive model in src/audio/pianoModel.ts, and are
labelled "(modelled)" wherever the instrument names them.

Reverb impulse responses are generated at runtime by src/audio/effectGraph.ts; no
recorded impulse responses are bundled.
