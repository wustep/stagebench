# Bundled piano samples

These files are recordings. Generated reverb impulses and the Clav, Digital, and Misc voices are not in this folder; they are declared as synthesis in `IMPLEMENTATION_DETAILS.json`.

Playback is offline. The engine reads `manifest.json` from this directory and decodes the MP3s. Nothing is fetched at runtime.

| Set | License | What it is |
| --- | --- | --- |
| Grand (`grand/`) | CC BY 3.0, Alexander Holm | Salamander Grand Piano V3, Yamaha C5. Layers 4 and 13 of 16, from npm `@audio-samples/piano-mp3-velocity4` and `piano-mp3-velocity13` @1.0.5. See `SALAMANDER-LICENSE.txt`. |
| Upright (`upright/`) | CC0 1.0, Versilian Studios LLC | VCSL Upright Piano, Yamaha, commit `sgossner/VCSL@c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e`. Soft layer is vl1 except C6, which has no vl1 and reuses vl2. `rootMidi` is the sounding pitch (the VCSL filename is one octave low). |
| Electric (`electric/`) | CC BY-NC 4.0, Jeff Learman | jRhodes3d, 1977 Rhodes Mark I Stage 73, commit `sfzinstruments/jlearman.jRhodes3d@6b9fbd0dbbdafbf4e46e891ba22154d11131ee9d`. Soft and hard takes. Non-commercial use requires attribution. |

Every file is a 2.4 second mono 22050 Hz MP3 trim of the source take. Zone roots, velocity layers, and original filenames are in `manifest.json`.
