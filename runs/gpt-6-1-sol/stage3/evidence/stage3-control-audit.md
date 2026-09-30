# Phase 3 control-binding audit

All 140 inherited physical controls retain their stable IDs, accessible roles/names, normalized presentation and keyboard/pointer input. Exactly three are excluded; 137 have canonical bindings. Tests audit every inventory ID, mutate all non-action bindings, exercise program actions, and render sonically meaningful settings through production DSP/native Web Audio.

Sources: `inputs/specs/nord-stage-4.visual.json`, `nord-stage-4.piano.json`, `nord-stage-4.effects.json`, `nord-stage-4.programs.json`, `nord-stage-4.organ.json`, `nord-stage-4.synth.json` and `benchmark-phases.json` (all under inputs/specs). Reference: Stage 4 73 photo. Bindings: src/panel.ts, src/phase3-panel.ts, src/audio.ts.

Pure Osc Ctrl deliberately changes the saved knob setting without altering Pure audio, exactly as the Synth spec requires. Piano Model Select has one model per type and explicitly reports that limitation. Physical aliases inherited from the compact surface are disclosed in UI notes. Exclusions are visible and movable; they never report functional success.

| Stable ID | Binding | Status / exclusion |
| --- | --- | --- |
| `performance-master-level` | master (runtime, excluded from programs) | Canonical |
| `performance-pitch-stick` | pitch, routed ±2 semitones | Canonical |
| `performance-modulation-wheel` | morphInput.Wheel; MIDI CC1 shares input | Canonical |
| `performance-rotary-drive` | rotary.drive | Canonical |
| `performance-rotary-on` | rotary.on | Canonical |
| `performance-rotary-slow-fast` | rotary.fast/speed, morph destination | Canonical |
| `performance-rotary-stop-mode` | rotary.stop with acceleration | Canonical |
| `performance-rotary-source` | rotary.organ (shared Organ chain) | Canonical |
| `organ-layer-a-level` | organ A level; focus follows; zones shown by LEDs | Canonical |
| `organ-layer-a-on` | organ A enabled; focus follows; zones shown by LEDs | Canonical |
| `organ-layer-b-level` | organ B level; focus follows; zones shown by LEDs | Canonical |
| `organ-layer-b-on` | organ B enabled; focus follows; zones shown by LEDs | Canonical |
| `organ-sustain-pedal` | focused organ sustped | Canonical |
| `organ-pitch-stick-routing` | focused organ pstick | Canonical |
| `organ-organ-model` | focused Organ layer model (six displayed models, four distinct engines) | Canonical |
| `organ-vibrato-chorus` | focused Organ vib selector C1–C3/V1–V3 | Canonical |
| `organ-vibrato-chorus-on` | focused Organ vibOn | Canonical |
| `organ-percussion-volume` | focused Organ soft | Canonical |
| `organ-percussion-decay` | focused Organ fast | Canonical |
| `organ-percussion-harmonic` | focused Organ third | Canonical |
| `organ-percussion-on` | focused Organ percussion | Canonical |
| `organ-preset` | Unsupported, decorative | Organ preset/physical drawbar modes excluded by organ spec |
| `organ-octave-shift` | focused organ octave −12/0/+12 | Canonical |
| `organ-drawbar-16` | focused Organ drawbars[0] 0…8; Farf threshold >4; live spectral update and morph range graph | Canonical |
| `organ-drawbar-51-3` | focused Organ drawbars[1] 0…8; Farf threshold >4; live spectral update and morph range graph | Canonical |
| `organ-drawbar-8` | focused Organ drawbars[2] 0…8; Farf threshold >4; live spectral update and morph range graph | Canonical |
| `organ-drawbar-4` | focused Organ drawbars[3] 0…8; Farf threshold >4; live spectral update and morph range graph | Canonical |
| `organ-drawbar-22-3` | focused Organ drawbars[4] 0…8; Farf threshold >4; live spectral update and morph range graph | Canonical |
| `organ-drawbar-2` | focused Organ drawbars[5] 0…8; Farf threshold >4; live spectral update and morph range graph | Canonical |
| `organ-drawbar-13-5` | focused Organ drawbars[6] 0…8; Farf threshold >4; live spectral update and morph range graph | Canonical |
| `organ-drawbar-11-3` | focused Organ drawbars[7] 0…8; Farf threshold >4; live spectral update and morph range graph | Canonical |
| `organ-drawbar-1` | focused Organ drawbars[8] 0…8; Farf threshold >4; live spectral update and morph range graph | Canonical |
| `piano-layer-a-level` | piano A level; focus follows; zones shown by LEDs | Canonical |
| `piano-layer-a-on` | piano A enabled; focus follows; zones shown by LEDs | Canonical |
| `piano-layer-b-level` | piano B level; focus follows; zones shown by LEDs | Canonical |
| `piano-layer-b-on` | piano B enabled; focus follows; zones shown by LEDs | Canonical |
| `piano-sustain-pedal` | focused piano sustped | Canonical |
| `piano-pitch-stick-routing` | focused piano pstick | Canonical |
| `piano-piano-type` | focused Piano type; six required families | Canonical |
| `piano-model-selector` | focused Piano modelPosition; one bundled model per type, disclosed | Canonical |
| `piano-kb-touch` | focused Piano touch | Canonical |
| `piano-dyn-comp` | focused Piano dynComp | Canonical |
| `piano-timbre` | focused Piano timbre | Canonical |
| `piano-unison` | focused Piano unison | Canonical |
| `piano-soft-release` | focused Piano softRelease | Canonical |
| `piano-string-resonance` | focused Piano stringRes | Canonical |
| `piano-octave-shift` | focused piano octave −12/0/+12 | Canonical |
| `piano-piano-on` | on (Piano section) | Canonical |
| `program-wheel-morph` | Wheel assignment hold/latch; Shift clears | Canonical |
| `program-aftertouch-morph` | Unsupported, decorative | Aftertouch morph excluded by programs spec |
| `program-control-pedal-morph` | Pedal assignment hold/latch; Shift clears | Canonical |
| `program-monitor` | Unsupported, decorative | Monitor/Copy/Paste/Swap excluded by programs spec |
| `program-store` | Store source → destination audition → confirm; Shift = naming or cancel | Canonical |
| `program-program-dial` | 32-slot browsing; Shift+Enter/pointer = numeric list; held MST CLK = BPM | Canonical |
| `program-page-previous` | previous page (8 slots) | Canonical |
| `program-page-next` | next page (8 slots) | Canonical |
| `program-live-mode` | 8 Live slots; automatic persistent edits | Canonical |
| `program-layer-scene` | scene I/II enable-only maps | Canonical |
| `program-program-1` | regular page button / Live slot / Store audition destination | Canonical |
| `program-program-2` | regular page button / Live slot / Store audition destination | Canonical |
| `program-program-3` | regular page button / Live slot / Store audition destination | Canonical |
| `program-program-4` | regular page button / Live slot / Store audition destination | Canonical |
| `program-program-5` | regular page button / Live slot / Store audition destination | Canonical |
| `program-program-6` | regular page button / Live slot / Store audition destination | Canonical |
| `program-program-7` | regular page button / Live slot / Store audition destination | Canonical |
| `program-program-8` | regular page button / Live slot / Store audition destination | Canonical |
| `program-split-on` | splits.on; long press opens point/width editing | Canonical |
| `program-split-set` | open canonical splits/zone editor | Canonical |
| `program-master-clock` | four-tap BPM, hold + Program dial edits BPM | Canonical |
| `program-transpose` | transpose −6…+6; Shift = Panic | Canonical |
| `synth-layer-a-level` | synth A level; focus follows; zones shown by LEDs | Canonical |
| `synth-layer-a-on` | synth A enabled; focus follows; zones shown by LEDs | Canonical |
| `synth-layer-b-level` | synth B level; focus follows; zones shown by LEDs | Canonical |
| `synth-layer-b-on` | synth B enabled; focus follows; zones shown by LEDs | Canonical |
| `synth-layer-c-level` | synth C level; focus follows; zones shown by LEDs | Canonical |
| `synth-layer-c-on` | synth C enabled; focus follows; zones shown by LEDs | Canonical |
| `synth-sustain-pedal` | focused synth sustped | Canonical |
| `synth-pitch-stick-routing` | focused synth pstick | Canonical |
| `synth-octave-shift` | focused synth octave −12/0/+12 | Canonical |
| `synth-synth-on` | synth.on | Canonical |
| `synth-layer-focus` | synth.focus A/B/C; follows into effects | Canonical |
| `synth-oscillator-mode` | required waveform category (Analog only) | Canonical |
| `synth-oscillator-select` | focused Synth wave (fourteen required waveforms) | Canonical |
| `synth-oscillator-control` | focused Synth ctrl; category-correct (Pure intentionally inactive) | Canonical |
| `synth-oscillator-mix` | focused Synth coarse pitch −24…+24 (disclosed alias) | Canonical |
| `synth-waveform` | cycles focused Synth wave | Canonical |
| `synth-oscillator-shape` | focused Synth oscEnv.amount −1…+1 (disclosed alias) | Canonical |
| `synth-lfo-rate` | focused Synth lfo.rate or synced division | Canonical |
| `synth-lfo-amount` | focused Synth lfo.amount | Canonical |
| `synth-lfo-waveform` | focused Synth lfo.wave | Canonical |
| `synth-arpeggiator-rate` | focused Synth arp.rate or synced division | Canonical |
| `synth-arpeggiator-range` | focused Synth arp.range / Gate hardness | Canonical |
| `synth-arpeggiator-on` | focused Synth arp.run | Canonical |
| `synth-arpeggiator-mode` | focused Synth arp.mode (Arp/Poly/Gate) | Canonical |
| `synth-arpeggiator-hold` | focused Synth arp.hold | Canonical |
| `synth-filter-frequency` | focused Synth cutoff | Canonical |
| `synth-filter-resonance` | focused Synth res | Canonical |
| `synth-filter-type` | focused Synth filter (LP12/LP24/HP/BP) | Canonical |
| `synth-filter-drive` | focused Synth drive 0…3 | Canonical |
| `synth-filter-envelope-amount` | focused Synth filterEnv.amount | Canonical |
| `synth-filter-velocity` | focused Synth filterEnv.velocity | Canonical |
| `synth-amp-attack` | focused Synth ampEnv.attack | Canonical |
| `synth-amp-decay` | focused Synth ampEnv.decay | Canonical |
| `synth-amp-sustain` | focused Synth ampEnv.velocity (disclosed alias) | Canonical |
| `synth-amp-release` | focused Synth ampEnv.release | Canonical |
| `synth-mod-attack` | focused Synth oscEnv.attack | Canonical |
| `synth-mod-decay` | focused Synth oscEnv.decay | Canonical |
| `synth-mod-sustain` | focused Synth oscEnv.velocity (disclosed alias) | Canonical |
| `synth-mod-release` | focused Synth oscEnv.release | Canonical |
| `synth-mono-legato` | focused Synth mode (Poly/Mono/Legato) | Canonical |
| `synth-unison` | focused Synth unison Off/1/2/3 | Canonical |
| `effects-organ-focus` | fxSection = Organ; uses canonical selected layer (Organ shared) | Canonical |
| `effects-piano-focus` | fxSection = Piano; uses canonical selected layer (Organ shared) | Canonical |
| `effects-synth-focus` | fxSection = Synth; uses canonical selected layer (Organ shared) | Canonical |
| `effects-effects-on` | effectsOn bypasses all six chains and Rotary | Canonical |
| `effects-mod-1-rate` | focused/group/global chain mod1.rate/division | Canonical |
| `effects-mod-1-amount` | focused/group/global chain mod1.amount | Canonical |
| `effects-mod-1-type` | focused/group/global chain mod1.type | Canonical |
| `effects-mod-1-on` | focused/group/global chain mod1.on/global | Canonical |
| `effects-mod-2-rate` | focused/group/global chain mod2.rate/division | Canonical |
| `effects-mod-2-amount` | focused/group/global chain mod2.amount | Canonical |
| `effects-mod-2-type` | focused/group/global chain mod2.type | Canonical |
| `effects-mod-2-on` | focused/group/global chain mod2.on | Canonical |
| `effects-eq-bass` | focused/group/global chain ampEq.bass | Canonical |
| `effects-eq-mid` | focused/group/global chain ampEq.mid | Canonical |
| `effects-eq-treble` | focused/group/global chain ampEq.treble | Canonical |
| `effects-amp-model` | focused/group/global chain ampEq.type | Canonical |
| `effects-amp-eq-on` | focused/group/global chain ampEq.on | Canonical |
| `effects-delay-time` | focused/group/global chain delay.rate/division | Canonical |
| `effects-delay-feedback` | focused/group/global chain delay.feedback | Canonical |
| `effects-delay-tap` | tapDelay updates focused/group/global delay time and master clock | Canonical |
| `effects-delay-on` | focused/group/global chain delay.on/global | Canonical |
| `effects-compressor-amount` | focused/group/global chain compressor.amount | Canonical |
| `effects-compressor-dry-wet` | focused/group/global chain compressor.wet | Canonical |
| `effects-compressor-mode` | focused/group/global chain compressor.fast | Canonical |
| `effects-compressor-on` | focused/group/global chain compressor.on/global | Canonical |
| `effects-reverb-amount` | focused/group/global chain reverb.wet | Canonical |
| `effects-reverb-tone` | focused/group/global chain reverb.tone | Canonical |
| `effects-reverb-type` | focused/group/global chain reverb.type | Canonical |
| `effects-reverb-on` | focused/group/global chain reverb.on/global | Canonical |

Supplemental canonical controls (stable IDs in SystemSettings.tsx and Settings.tsx): all three ADR envelopes/velocity/to-pitch; Synth fine/coarse/tracking/LFO destination/rate/sync/divisions/priority/glide/vibrato/arp direction; Organ section/focus/click/drawbars/Rotary continuous speed; every layer's contiguous zone range; three split positions/widths/enables; scene toggle; both morph input/assign/clear/range/remove controls; clock dial/keyboard sync/transpose/Panic; Store As native character insertion/deletion/name editor, Store destination/confirm/cancel and numeric list; every inherited effect parameter, grouping and global mode. Range and enum controls use canonical state paths; all UI aliases are named in the unsupported/scope disclosure.

Only source assignment latch and current input positions are transient. Assigned knobs light green; drawbar/fader LED graphs show start/end ranges and current level. Store naming/destination and numeric list are auxiliary dialogs outside the chassis. No additional primary OLEDs are created.

Evidence: src/phase3.test.ts (state, complete binding inventory, production audio distinctions); src/phase3-browser.test.ts (native six-chain/one-context rendering and Store/Live/split/scene/morph/Panic browser flow); inherited src/App.test.tsx and src/rendered-audio.test.ts (roles/inventory/reachability/desktop/narrow/input regression). No optional undo, sample mode, or excluded feature is claimed.
