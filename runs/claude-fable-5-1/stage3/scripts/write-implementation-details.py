#!/usr/bin/env python3
"""Regenerates IMPLEMENTATION_DETAILS.json from the bundled sample manifests and the model registry.

Run after `scripts/samples/build.py` changes the library. It never runs as part of pnpm build/test.
"""
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAMPLES = os.path.join(ROOT, 'public', 'samples')

index = json.load(open(os.path.join(SAMPLES, 'index.json')))
registry = open(os.path.join(ROOT, 'src', 'audio', 'pianoModels.ts')).read()
inventory = open(os.path.join(ROOT, 'src', 'hardware', 'controls.ts')).read()

# Every control id of the inventory (src/hardware/controls.ts): the helper calls, the object literals and the eight program buttons.
CONTROL_IDS = re.findall(r"\b(?:knob|dial|fader|drawbar|button|select|momentary)\('[a-z]+',\s*'([^']+)'", inventory)
CONTROL_IDS += [c for c in re.findall(r"\{ id: '([a-z][a-z0-9.-]+)', section:", inventory) if not c.endswith('.oled')]  # the DISPLAYS list is not a control
CONTROL_IDS += [f'program.button.{n}' for n in range(1, 9)]
CONTROL_IDS = sorted(set(CONTROL_IDS))
assert len(CONTROL_IDS) == 146, len(CONTROL_IDS)

# Spec-excluded (or optional and not claimed) controls: they move or press accessibly and change presentation state only.
UNSUPPORTED_CONTROLS = [
    {'id': 'program.morph.aftertouch', 'reason': 'Aftertouch is not a morph source: browser keyboards have no aftertouch; the A.T. button toggles its LED only.', 'spec': 'specs/nord-stage-4.programs.json scope.excluded (aftertouch morph source)'},
    {'id': 'program.preset-library.organ', 'reason': 'The Organ/Piano/Synth preset library is cut benchmark-wide; the button toggles its LED only (Shift: Single Layer preset, also cut).', 'spec': 'specs/nord-stage-4.programs.json scope.excluded (preset library, manual p. 41-42)'},
    {'id': 'program.preset-library.piano', 'reason': 'Preset library cut benchmark-wide; the button toggles its LED only.', 'spec': 'specs/nord-stage-4.programs.json scope.excluded (preset library)'},
    {'id': 'program.preset-library.synth', 'reason': 'Preset library cut benchmark-wide; the button toggles its LED only.', 'spec': 'specs/nord-stage-4.programs.json scope.excluded (preset library)'},
    {'id': 'program.prog-view', 'reason': 'Multi-view Prog View modes are optional and not implemented; the display keeps its one program view (Shift: Preset Name belongs to the cut preset library).', 'spec': 'specs/nord-stage-4.programs.json scope.optional (multi-view Prog View modes)'},
    {'id': 'program.solo', 'reason': 'Solo is optional and not implemented: the button toggles its LED only. Its Shift function UNDO (program change from an edited state) is implemented.', 'spec': 'specs/nord-stage-4.programs.json scope.optional (Solo; single-level undo)'},
    {'id': 'program.section-edit', 'reason': 'Section Edit and Layer Init (Shift) are excluded; the button toggles its LED only.', 'spec': 'specs/nord-stage-4.programs.json scope.excluded (Section Edit, Layer Init, manual p. 43-44)'},
    {'id': 'program.mon-copy', 'reason': 'Monitor / Copy / Paste are excluded; the momentary button presses only.', 'spec': 'specs/nord-stage-4.programs.json scope.excluded (Monitor/Copy/Paste, manual p. 43-44)'},
    {'id': 'organ.preset', 'reason': 'Preset / Drawbar Live modes and drawbar Sync (Shift) are physical-drawbar concepts: the virtual drawbars always show live values; the button toggles its LED only.', 'spec': 'specs/nord-stage-4.organ.json scope.excluded (Preset/Drawbar Live modes and drawbar sync)'},
    {'id': 'effects.delay.effect', 'reason': 'The delay feedback-loop effects (Chor/Vibe/Ens/Flam/Space) are excluded; the selector cycles its LEDs only and the display says so.', 'spec': 'specs/nord-stage-4.effects.json scope.excluded (delay feedback-loop effects, manual p. 51)'},
]
UNSUPPORTED_IDS = {u['id'] for u in UNSUPPORTED_CONTROLS}
FUNCTIONAL_IDS = [c for c in CONTROL_IDS if c not in UNSUPPORTED_IDS]

sample_sources = []
for entry in index['sets']:
    m = json.load(open(os.path.join(SAMPLES, entry['id'], 'manifest.json')))
    files = [f['file'] for f in m['files']]
    roots = sorted({f['root'] for f in m['files']})
    layers = [f"{l['name']} ({l['lovel']}-{l['hivel']})" for l in m['layers']]
    sample_sources.append({
        'name': f"{m['type']} · {m['model']}",
        'setId': m['id'],
        'kind': 'recorded-samples',
        'source': f"{m['source']['name']} — {m['source'].get('author', 'unknown author')} — {m['source'].get('url', '')}",
        'license': m['source']['license'],
        'licenseUrl': m['source'].get('licenseUrl'),
        'instrument': m['source'].get('instrument'),
        'recording': m['source'].get('recording'),
        'originalFiles': m['source'].get('files'),
        'format': f"{m['format']}, {m['sampleRate']} Hz, {m['channels']} channel",
        'velocityLayers': layers,
        'rootNotes': roots,
        'rootSpacingSemitones': max((b - a for a, b in zip(roots, roots[1:])), default=0),
        'fileCount': len(files),
        'bytes': entry['bytes'],
        'files': [f"public/samples/{m['id']}/{f}" for f in files],
        'fileDetails': [{'file': f['file'], 'root': f['root'], 'layer': f['layer'], 'seconds': f['seconds'], 'sourceFile': f.get('sourceFile')} for f in m['files']],
        'processing': m.get('processing'),
        'notes': m.get('notes', []),
        'attribution': 'public/samples/LICENSES.md',
    })

details = {
    '$schema': 'https://stagebench.local/schemas/implementation-details.schema.json',
    'version': 1,
    'phase': 3,
    'variant': 'stage-4-73',
    'audio': {
        'strategy': (
            'One AudioContext for the whole instrument. Piano notes are AudioBufferSourceNodes playing either recorded, bundled Ogg Vorbis '
            'one-shots (Grand, Upright, Electric, Clav, Digital, Misc models — decoded at runtime with @wasm-audio-decoders/ogg-vorbis) or '
            'generated buffers (the Additive Piano model and the fallback voice, rendered by src/audio/pianoRenderer.ts). '
            'The Organ (both layers, B3 / Vox / Farf / Pipe 1 / Pipe 2 / B3 Bass) and each Synth layer (A / B / C, Analog + FM-H) are LIVE '
            'SYNTHESIS: pure TypeScript DSP (src/dsp/organ.ts, src/dsp/synth.ts) hosted in AudioWorkletNodes that receive note events and '
            'the canonical program parameters — no samples, no recordings. Every source feeds its layer chain (LayerChain AudioWorkletNode: '
            'Timbre EQ, String Res, Mod 1, Mod 2, Delay, Amp Sim/EQ, Compressor, Reverb — src/dsp/) → level GainNode → optionally the one '
            'shared Rotary AudioWorkletNode (organ via the ORGAN button, piano / synth via To Rotary) → master GainNode (Master Level) → '
            'master limiter AudioWorkletNode → destination. If AudioWorklet is unavailable the same DSP classes run in a ScriptProcessorNode. '
            'Recorded samples, generated buffers and live synthesis are always labelled as what they are.'
        ),
        'graph': [
            'piano voice: AudioBufferSourceNode (+2 detuned copies through StereoPannerNode + GainNode for Unison) → voice GainNode → bus GainNode',
            'piano layer: bus GainNode → LayerChain processor (timbre → stringRes → mod1 → mod2 → delay → ampEq → compressor → reverb) → level GainNode',
            'organ: OrganUnit processor (both layers: per-layer model / drawbars / level / octave / vibrato, shared percussion and key click) → LayerChain processor (the one shared organ chain) → section GainNode',
            'synth: SynthLayerUnit processor per layer (oscillators, filter, envelopes, LFO, voice modes, arpeggiator/gate) → own LayerChain processor → level GainNode',
            'routing: level → master GainNode, or level → shared Rotary processor → master GainNode (ORGAN button for the organ, Amp Sim/EQ To Rotary for piano / synth layers)',
            'master: master GainNode (Master Level knob, 15 ms ramps) → MasterUnit processor (limiter, threshold 0.95) → AudioContext.destination',
            'notes: NoteBus → Performer (transpose, keyboard zones with Off/±6/±12 crossfades, Layer Scenes, Master Clock keyboard sync) → piano voices / organ events / synth events',
        ],
        'sampleSources': sample_sources,
        'generatedSources': [
            {
                'name': 'Additive Piano (Digital model "digital-additive") and the labelled fallback voice',
                'kind': 'generated-buffer',
                'generator': 'src/audio/pianoRenderer.ts (renderPianoNote)',
                'description': (
                    'Up to 28 inharmonic partials with a hammer-position comb filter, velocity-dependent brightness, two-stage exponential '
                    'decay, a 2 ms attack ramp and a 9 ms seeded-noise thump, rendered lazily per note and velocity layer into Float32 '
                    'AudioBuffers (LRU cache of 64). Generated by code at runtime; it is not a recording. It is selectable as the second '
                    'Digital model and is the playable fallback whenever a recorded set fails to load (status: fallback, "Piano not found").'
                ),
                'velocityLayers': 3,
                'layerRepresentativeVelocities': [32, 72, 112],
                'license': 'Original code written for this candidate; no third-party audio material.',
            },
            {
                'name': 'Fallback triangle tone',
                'kind': 'live-synthesis',
                'generator': 'src/audio/engine.ts (fallbackVoice, OscillatorNode)',
                'description': 'Only used when the generated renderer itself throws: a triangle OscillatorNode with a 5 ms attack and 2.5 s exponential decay through the same voice, layer and master path. Labelled "fallback oscillator" in the status strip and Program display.',
                'license': 'Original code written for this candidate.',
            },
            {
                'name': 'Effect processing (Mod 1, Mod 2, Delay, Amp Sim/EQ, Compressor, Reverb, Rotary, Timbre, String Res, master limiter)',
                'kind': 'live-synthesis',
                'generator': 'src/dsp/*.ts hosted by src/dsp/worklet.ts (AudioWorklet) or src/audio/browserProcessor.ts (ScriptProcessor fallback)',
                'description': (
                    'Algorithmic DSP written for this candidate: LFO / envelope modulators, modulated delay lines, all-pass phasers, a feedback delay with '
                    'in-loop filters, RBJ biquad EQ with documented amp / cabinet approximations (Twin, JC, Small) and 24 dB resonant filters, a '
                    'feed-forward compressor, comb/all-pass reverbs (Room, Booth, Stage, Hall, Cathedral) plus a dispersive spring model, a horn + '
                    'bass-rotor rotary with smooth acceleration, sympathetic-string comb resonators and a peak limiter. No impulse responses or '
                    'recordings are used; the same classes render offline in the tests.'
                ),
                'license': 'Original code written for this candidate.',
            },
            {
                'name': 'Organ engine (B3, B3 Bass, Vox, Farf, Pipe 1, Pipe 2)',
                'kind': 'live-synthesis',
                'generator': 'src/dsp/organ.ts (OrganUnit) hosted by the organ AudioWorkletNode (src/dsp/worklet.ts) or the ScriptProcessor fallback',
                'description': (
                    'Algorithmic organ synthesis written for this candidate, rendered live from note events and the nine drawbars: B3 = nine '
                    'tonewheel sine partials with foldback, 3 dB drawbar steps, key click, single-triggered / poly percussion (2nd or 3rd harmonic, '
                    'soft / fast) and a scanner vibrato / chorus (V1-V3 / C1-C3); B3 Bass reuses it with the 16 and 8 foot drawbars; Vox = seven partial '
                    'drawbars (16 8 4 2 II III IV) mixing a filtered flute and an unfiltered reed tone by the ninth drawbar; Farf = register switches '
                    '(pulled past half) over divide-down square generators with per-register voicing filters; Pipe 1 / Pipe 2 = flute and principal ranks '
                    'with breath chiff and, with vibrato / chorus, a less precisely tuned model. Both layers sum into one processor that feeds the shared '
                    'organ effect chain and, via the ORGAN button, the rotary. Deterministic and block-size independent; the same class renders offline in the tests.'
                ),
                'license': 'Original code written for this candidate; no third-party audio material.',
            },
            {
                'name': 'Synth engine (three layers, Analog waveforms and FM-H)',
                'kind': 'live-synthesis',
                'generator': 'src/dsp/synth.ts (SynthLayerUnit) hosted by one synth AudioWorkletNode per layer (src/dsp/worklet.ts) or the ScriptProcessor fallback',
                'description': (
                    'Algorithmic subtractive / FM synthesis written for this candidate, one processor per Synth layer: polyBLEP Pure waveforms '
                    '(Sine, Triangle, Saw, Square, Pulse 33, Pulse 10, White Noise), hard-synced Sync Saw / Sync Square, Multi Saw / Multi Saw 8ve, seven-oscillator '
                    'Super Saw / Super Square and a two-operator harmonic FM algorithm with the Partial ratio; Osc Ctrl acts per category. Per-voice SVF filters '
                    '(LP12, LP24, HP, BP) with keyboard tracking, resonance, drive and envelope amount; oscillator, filter and amplifier envelopes; one LFO '
                    '(Triangle, Saw down, Saw up, Square, S/H → pitch / Osc Ctrl / filter, Master Clock sync); Poly / Mono / Legato with note priority, glide, '
                    'unison and vibrato; a deterministic sample-clock arpeggiator / gate (rate, Master Clock subdivisions, range, direction, hold, run, KB sync). '
                    'Samples and Extern modes are unsupported: the selector positions are stored and labelled, the Analog engine keeps sounding. No samples or '
                    'recordings; the same class renders offline in the tests.'
                ),
                'license': 'Original code written for this candidate; no third-party audio material.',
            },
        ],
        'decoder': {
            'name': '@wasm-audio-decoders/ogg-vorbis 0.1.20',
            'license': 'MIT (libvorbis BSD-3-Clause)',
            'use': 'Decodes the bundled Ogg Vorbis samples in the browser (Web Worker) and in the Node test-suite; decoding is serialised on one instance.',
        },
        'notes': [
            'Web Audio is created lazily on the first key press or the Start audio button; the sample library starts loading on page load (no audio context needed) and the status strip / Program display report loading progress, ready, error (no AudioContext), and fallback (a set failed to load: the generated Additive Piano plays, labelled fallback, and the type LED flashes).',
            'Sustain (UI pedal button, Shift key, MIDI CC64) is honoured only while SUSTPED is on (Shift + Layer A toggles it). PSTICK (Shift + Layer B) lets the pitch stick bend the Piano section ±2 semitones.',
            'Polyphony is capped at 32 voices across both layers; the oldest sounding voice is stolen deterministically with a 20 ms release. Release is a 300 ms exponential ramp (550 ms with Soft Release; unchanged for Clav-type models), retriggered notes release in 30 ms, all-notes-off in 80 ms.',
            'Tests never touch real audio output, MIDI devices or the network: the audio context, DSP host, asset fetching, MIDI access and timers are injected (src/audio/boundaries.ts) and faked in tests (src/audio/fakeAudio.ts); rendered-audio relationships are proved on the real bundled files decoded from disk and on the real src/dsp classes (src/audio/offlinePiano.ts, src/dsp/offline.ts).',
            'Group mode (Shift + Piano / Synth focus) copies the focused layer\'s chain to every layer of that section and keeps further edits in sync; Global mode (Delay, Compressor, Reverb) shares one setting and on-state across all six chains (Piano A/B, Organ, Synth A/B/C).',
            'Programs: 32 slots (4 pages x 8) plus 8 Live slots, browsed with the program buttons, page buttons, the dial and the numeric list view (Shift + dial); Store auditions the destination and confirms on the second press, Store As names the program first; the E indicator compares the live program with the stored one; selecting another program discards edits and Shift + Solo (Undo) restores them. Live slots store every edit automatically (debounced 250 ms) through the storage boundary (localStorage in the browser, memory in tests).',
            'Splits: Low / Mid / High points at the 11 documented positions (C2 to C7) with Off / ±6 / ±12 crossfades, edited on the Keyboard Split page (hold SPLIT) or with SET KEY (Shift + Split, next key); KB ZONE (Shift + Octave) assigns any layer to contiguous zones; the Performer applies the resulting gains per note. Layer Scenes I / II store two enable configurations (sections and layers) and share every sound parameter.',
            'Morphs: hold (or tap to latch) WHEEL / CTRLPED and move a control from its stored value to the end value; the mod wheel, the on-screen Control Pedal slider and MIDI CC11 drive the sources; assigned knobs light a green morph LED, faders and drawbars show the morphed value on their LED graphs; Shift + source clears it. Master Clock: tap 4+ times or hold TAP/SET and dial (30-300 BPM, KB Sync); Shift + a Rate / Tempo knob clockwise syncs the delay, Mod 1, synth LFO and arpeggiator. Transpose ±6 semitones (hold + dial) affects every layer; PANIC (Shift + Transpose) sends All Notes Off and resets the held inputs.',
            'Hold gestures: SPLIT, MST CLK TAP/SET and TRANSP open their display page when held for 400 ms; a short press keeps its single-press meaning. Layer ON/OFF buttons are toggles (turning a layer on focuses it); pressing a lit FX FOCUS button again cycles the focused layer of that section.',
        ],
    },
    'controls': {
        'functional': FUNCTIONAL_IDS,
        'unsupported': UNSUPPORTED_CONTROLS,
        'shiftFunctions': [
            'piano.layer-a.on / organ.layer-a.on / synth.layer-a.on: SUSTPED; piano.layer-b.on / organ.layer-b.on / synth.layer-b.on: PSTICK (synth: focused layer)',
            'piano/organ/synth octave buttons: KB ZONE; effects.focus.piano / effects.focus.synth: GROUP; effects.delay.on / comp.on / reverb.on: GLOBAL; effects.comp.amount: FAST; effects.delay.filter: PING PONG',
            'effects.delay.tempo / effects.mod1.rate / synth.arp.rate / synth.lfo.rate turned clockwise: MST CLK sync (counter-clockwise: off)',
            'program.store: STORE AS; program.split: SET KEY; program.transpose: PANIC; program.solo: UNDO; program.morph.wheel / control-pedal: CLEAR MORPH; program.dial: LIST view',
            'synth.waveform: SOUND INIT; synth.osc.pitch: ENV TO PITCH; synth.osc.envelope / filter.envelope / amp.envelope: VELOCITY; synth.arp-run: KB SYNC; synth.voice.mode: LO / HI priority; organ.percussion.volume: POLY percussion',
            'excluded Shift functions consume the latch and only report: Info, Ped Noise, Analog delay, Variation / Chorale, Close Mic, Angle, Bank, Num Pad, Pedal Tap, scene Pedal, Exclude, Extern, Group (filter / LFO / arp), Layer Init, Paste, Single Layer, Preset Name, Sync, the System / Sound / Organize / Aux KB / Output / Pedal / MIDI / Extern menus, All FX Off (undocumented)',
        ],
        'shiftLatch': 'Pressing SHIFT (effects or program) arms a latch for the next panel press (8 s), so Shift functions are reachable with a single pointer or from the keyboard; holding SHIFT while pressing another button also works with touch. In an open page SHIFT is EXIT.',
        'caveats': [
            'synth.mode: only Analog sounds; the Samples and Extern positions are selectable and stored, the Synth display labels them unsupported and the Analog engine keeps sounding (synth spec: Analog mode only; Extern excluded; Samples optional, not claimed).',
            'synth.vibrato.mode: the Aftertouch position is selectable but inert (no aftertouch in a browser) and labelled; Delayed and Pedal (optional) are implemented.',
            'program.master-clock: the toggle LED beats at the Master Clock tempo; each press is a tap, holding opens the tempo page.',
        ],
    },
    'unsupported': [
        'Soft pedal (una corda) and sostenuto: not claimed, not simulated (piano spec optional; the only pedal is sustain).',
        'Pedal noise and half-pedalling (piano spec excluded): the PED NOISE LED stays off.',
        'Nord Triple Pedal modelling and pedal-type configuration (excluded).',
        'Piano size classes (Sml/Med/Lrg/XL), the INFO view (Shift + Piano Select) and the piano LIST view, Nord Sound Manager downloads (excluded).',
        'The Organ / Piano / Synth preset library and the three PRESET LIBRARY buttons (cut benchmark-wide); Single Layer presets; Preset Name.',
        'Banks beyond one (BANK = Shift + Page), the 512-program factory layout, Organize swap / move, Num Pad mode, Monitor / Copy / Paste / Swap, Section Edit, Layer Init, Aux KB, Extern, memory protection and every Shift menu (System / Sound / Organize / Output / Pedal / MIDI).',
        'Aftertouch as a morph source and as a synth vibrato source (browsers have no aftertouch): the A.T. button and the A.T. vibrato position are inert and labelled.',
        'External MIDI clock sync and Pedal Tap (Shift + Mst Clk); Layer Scene pedal switching.',
        'Solo and the multi-view Prog View modes (programs spec optional, not implemented; the buttons change presentation only). Program categories and alphabetic list sorting (optional, not implemented: the list view is numeric).',
        'Organ: Preset / Drawbar Live modes and drawbar Sync, the swell pedal, tonewheel wear modes, keyboard trigger point, Sound-menu rotary tuning and click level (fixed level). B3 Bass and Pipe 2 reuse the B3 / Pipe 1 engines as the spec allows (documented).',
        'Synth: Samples mode (optional, not claimed: the Analog engine keeps sounding), Extern mode and MIDI out, arpeggiator Pattern editing / zig-zag / accent / pan, KB Hold Exclude, Filter / LFO / Arp Group modes, LP M and LP+HP filters, the Sub Osc / Shape / Shape Sine / Misc / Wave categories and FM inharmonic algorithms (optional, not claimed).',
        'Per-type effect Variations and Reverb Chorale (Shift + selector reports and does not cycle); delay feedback-loop effects (Chor/Vibe/Ens/Flam/Space selector is decorative) and Analog delay mode (Shift + Tap); Mod 1 Pump / Wah pedal modes; rotary close mic and stop angle; global reverb placement after the rotary (reverb always precedes the rotary); All FX Off (Shift + Organ focus, undocumented in the manual pages provided).',
    ],
    'inputs': {
        'pointer': 'pointerdown/up/cancel with per-pointer tracking, glissando across keys, independent multi-touch, velocity from the strike position on the key',
        'computerKeyboard': "physical key codes A W S E D F T G Y H U J K O L P ; ' = C4..F5 (base shifts with Z/X, clamped to the keybed), Shift = sustain, auto-repeat suppressed, blur/visibility-hidden releases everything",
        'midi': 'Web MIDI note on/off with velocity on any channel, CC64 sustain, CC11 control pedal (morph source, Pedal vibrato), CC120/123 all notes off; unsupported / requesting / ready / denied / error / disconnected states, disconnect releases the device\'s notes',
    },
    'evidence': {
        'captureHarness': 'scripts/capture.mjs (playwright-core driving the locally installed Chrome; the parent capture harness was not available in this workspace)',
        'directory': 'evidence/',
        'files': ['evidence/stage3-desktop.png', 'evidence/stage3-narrow.png', 'evidence/stage3-capture.json', 'evidence/stage3-visual-audit.md', 'evidence/stage2-desktop.png', 'evidence/stage2-narrow.png', 'evidence/stage2-capture.json', 'evidence/stage2-visual-audit.md', 'evidence/stage1-desktop.png', 'evidence/stage1-narrow.png', 'evidence/stage1-capture.json', 'evidence/stage1-visual-audit.md'],
    },
    'samplePipeline': {
        'scripts': ['scripts/samples/fetch.sh', 'scripts/samples/build.py', 'scripts/samples/validate.py', 'scripts/samples/README.md'],
        'librarySizeBytes': sum(e['bytes'] for e in index['sets']),
        'attribution': 'public/samples/LICENSES.md',
    },
}

# every recorded model in the registry must have a bundled set
for set_id in re.findall(r"setId: '([a-z0-9-]+)'", registry):
    assert any(s['setId'] == set_id for s in sample_sources), f'registry set {set_id} has no bundled manifest'

with open(os.path.join(ROOT, 'IMPLEMENTATION_DETAILS.json'), 'w') as f:
    json.dump(details, f, indent=2, ensure_ascii=False)
    f.write('\n')
print('wrote IMPLEMENTATION_DETAILS.json with', len(sample_sources), 'sample sets')
