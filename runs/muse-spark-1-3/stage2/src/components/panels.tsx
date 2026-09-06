/**
 * Phase 2 functional panels: the Piano strip and the Layer Effects strip.
 *
 * Every control here has a `p2-*` stable ID, real roles/values, keyboard
 * operation, and drives audible state through `usePianoFx` (no fake state).
 * Phase 1 decorative IDs (`piano-*`, `fx-*`, `perf-*`) are untouched — these
 * strips are separate nodes rendered after the inherited grids.
 */

import { usePianoFx } from '../state/pianoFx';
import { KB_TOUCH_OPTIONS, PIANO_TYPES, TIMBRE_OPTIONS, modelOf, type LayerId } from '../audio/pianoTypes';
import { AMP_TYPES, MOD1_TYPES, MOD2_TYPES, REVERB_TYPES, type ChainState } from '../state/fxTypes';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="p2-row">
      <span className="p2-rowlabel" aria-hidden="true">
        {label}
      </span>
      <div className="p2-rowctls" role="group" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

function Toggle({
  id,
  label,
  on,
  onFlip,
  flash,
}: {
  id: string;
  label: string;
  on: boolean;
  onFlip: () => void;
  flash?: boolean;
}) {
  return (
    <button
      type="button"
      id={id}
      data-testid={id}
      aria-label={label}
      aria-pressed={on}
      data-on={on ? 'true' : 'false'}
      data-flash={flash ? 'true' : 'false'}
      className={`p2-toggle${on ? ' on' : ''}${flash ? ' flash' : ''}`}
      onPointerDown={(e) => {
        e.preventDefault();
        onFlip();
      }}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          onFlip();
        }
      }}
    >
      {label}
    </button>
  );
}

function Stepper({
  id,
  label,
  value,
  min,
  max,
  format,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div
      id={id}
      data-testid={id}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={format(value)}
      data-value={value}
      className="p2-stepper"
      onPointerDown={(e) => {
        e.preventDefault();
        onChange(value >= max ? min : value + 1);
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault();
          onChange(Math.min(max, value + 1));
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          e.preventDefault();
          onChange(Math.max(min, value - 1));
        } else if (e.key === 'Home') {
          e.preventDefault();
          onChange(min);
        } else if (e.key === 'End') {
          e.preventDefault();
          onChange(max);
        }
      }}
    >
      <span className="p2-stepperval" aria-hidden="true">
        {format(value)}
      </span>
    </div>
  );
}

function LayerBlock({ layer }: { layer: LayerId }) {
  const fx = usePianoFx();
  const piano = fx.snapshot.layers[layer];
  const model = modelOf(piano);
  const timbres = TIMBRE_OPTIONS[model.timbreFamily];
  return (
    <div className="p2-layer" data-testid={`p2-piano-layer-${layer}`} data-layer={layer} role="group" aria-label={`Piano layer ${layer}`}>
      <Row label={`Layer ${layer} enable and focus`}>
        <Toggle id={`p2-piano-${layer}-on`} label={`Piano layer ${layer} enable`} on={piano.enabled} onFlip={() => fx.setLayerEnabled(layer, !piano.enabled)} />
        <Toggle
          id={`p2-piano-${layer}-focus`}
          label={`Piano layer ${layer} focus`}
          on={fx.snapshot.layerFocus === layer}
          onFlip={() => fx.focusLayer(layer)}
        />
      </Row>
      <Row label={`Layer ${layer} instrument`}>
        <div
          id={`p2-piano-${layer}-type`}
          data-testid={`p2-piano-${layer}-type`}
          role="listbox"
          aria-label={`Piano layer ${layer} type`}
          className="p2-types"
        >
          {PIANO_TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="option"
              aria-selected={piano.type === t.id}
              data-testid={`p2-piano-${layer}-type-${t.id}`}
              data-active={piano.type === t.id ? 'true' : 'false'}
              className={piano.type === t.id ? 'p2-type on' : 'p2-type'}
              onPointerDown={(e) => {
                e.preventDefault();
                fx.setLayerType(layer, t.id);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <Stepper
          id={`p2-piano-${layer}-model`}
          label={`Piano layer ${layer} model`}
          value={Math.min(PIANO_TYPES.find((t) => t.id === piano.type)!.models.length - 1, piano.model)}
          min={0}
          max={PIANO_TYPES.find((t) => t.id === piano.type)!.models.length - 1}
          format={() => model.label}
          onChange={(v) => fx.setLayerModel(layer, v)}
        />
      </Row>
      <Row label={`Layer ${layer} level and octave`}>
        <Stepper
          id={`p2-piano-${layer}-level`}
          label={`Piano layer ${layer} level`}
          value={piano.level}
          min={0}
          max={10}
          format={(v) => `Level ${v}`}
          onChange={(v) => fx.setLayerLevel(layer, v)}
        />
        <Stepper
          id={`p2-piano-${layer}-octave`}
          label={`Piano layer ${layer} octave shift`}
          value={piano.octave}
          min={0}
          max={4}
          format={(v) => `Oct ${(v - 2) * 12 >= 0 ? '+' : ''}${(v - 2) * 12}`}
          onChange={(v) => fx.setLayerOctave(layer, v)}
        />
      </Row>
      <Row label={`Layer ${layer} pedal routing`}>
        <Toggle id={`p2-piano-${layer}-sustped`} label={`Piano layer ${layer} sustain pedal enable`} on={piano.sustPed} onFlip={() => fx.setSustPed(layer, !piano.sustPed)} />
        <Toggle id={`p2-piano-${layer}-pstick`} label={`Piano layer ${layer} pitch stick enable`} on={piano.pStick} onFlip={() => fx.setPStick(layer, !piano.pStick)} />
      </Row>
      <Row label={`Layer ${layer} touch and dynamics`}>
        <Stepper
          id={`p2-piano-${layer}-touch`}
          label={`Piano layer ${layer} KB Touch`}
          value={KB_TOUCH_OPTIONS.indexOf(piano.kbTouch)}
          min={0}
          max={2}
          format={(v) => KB_TOUCH_OPTIONS[v]}
          onChange={(v) => fx.setKbTouch(layer, KB_TOUCH_OPTIONS[v])}
        />
        <Stepper
          id={`p2-piano-${layer}-dyncomp`}
          label={`Piano layer ${layer} Dyn Comp`}
          value={piano.dynComp}
          min={0}
          max={3}
          format={(v) => (v === 0 ? 'Off' : `${v}`)}
          onChange={(v) => fx.setDynComp(layer, v)}
        />
        <Stepper
          id={`p2-piano-${layer}-unison`}
          label={`Piano layer ${layer} Unison`}
          value={piano.unison}
          min={0}
          max={3}
          format={(v) => (v === 0 ? 'Off' : `${v}`)}
          onChange={(v) => fx.setUnison(layer, v)}
        />
      </Row>
      <Row label={`Layer ${layer} timbre and acoustics`}>
        <Stepper
          id={`p2-piano-${layer}-timbre`}
          label={`Piano layer ${layer} timbre`}
          value={timbres.indexOf(piano.timbre as (typeof timbres)[number]) < 0 ? 0 : timbres.indexOf(piano.timbre as (typeof timbres)[number])}
          min={0}
          max={timbres.length - 1}
          format={(v) => timbres[v]}
          onChange={(v) => fx.setTimbre(layer, timbres[v])}
        />
        <Toggle id={`p2-piano-${layer}-softrel`} label={`Piano layer ${layer} Soft Release`} on={piano.softRelease} onFlip={() => fx.setSoftRelease(layer, !piano.softRelease)} />
        <Toggle id={`p2-piano-${layer}-stringres`} label={`Piano layer ${layer} String Resonance`} on={piano.stringRes} onFlip={() => fx.setStringRes(layer, !piano.stringRes)} />
      </Row>
    </div>
  );
}

export function PianoPanel({ loadFailed }: { loadFailed: string[] }) {
  const fx = usePianoFx();
  return (
    <div className="p2-panel" data-testid="p2-piano-panel" role="group" aria-label="Piano layers, functional">
      <div className="p2-panelhead" aria-hidden="true">
        PIANO · LAYERS A/B
      </div>
      <Toggle id="p2-piano-section-on" label="Piano section on" on={fx.snapshot.sectionOn} onFlip={() => fx.setSectionOn(!fx.snapshot.sectionOn)} />
      {loadFailed.length > 0 ? (
        <div className="p2-loadfail" data-testid="p2-piano-loadfail" role="alert">
          Sample fallback active ({loadFailed.slice(0, 3).join(', ') || 'assets missing'}): synth voices in use.
        </div>
      ) : null}
      <LayerBlock layer="A" />
      <LayerBlock layer="B" />
    </div>
  );
}

function ChainEditor({ layer }: { layer: LayerId }) {
  const fx = usePianoFx();
  const chain = fx.snapshot.chains[fx.snapshot.fx.pianoGroup ? 'A' : layer];
  return (
    <div className="p2-chain" data-testid={`p2-fx-chain-${layer}`} data-layer={layer} role="group" aria-label={`Effects chain ${layer}`}>
      <Row label={`Chain ${layer} Mod 1`}>
        <Toggle
          id={`p2-fx-${layer}-mod1-on`}
          label={`Chain ${layer} Mod 1 on`}
          on={chain.mod1.on}
          onFlip={() => fx.updateChain(layer, (c) => ({ ...c, mod1: { ...c.mod1, on: !c.mod1.on } }))}
        />
        <Stepper
          id={`p2-fx-${layer}-mod1-type`}
          label={`Chain ${layer} Mod 1 type`}
          value={chain.mod1.type === 'off' ? 0 : MOD1_TYPES.indexOf(chain.mod1.type) + 1}
          min={0}
          max={MOD1_TYPES.length}
          format={(v) => (v === 0 ? 'Off' : MOD1_TYPES[v - 1])}
          onChange={(v) =>
            fx.updateChain(layer, (c) => ({ ...c, mod1: { ...c.mod1, type: v === 0 ? 'off' : MOD1_TYPES[v - 1] } }))
          }
        />
        <Stepper id={`p2-fx-${layer}-mod1-rate`} label={`Chain ${layer} Mod 1 rate`} value={chain.mod1.rate} min={0} max={10} format={(v) => `${v}`} onChange={(v) => fx.updateChain(layer, (c) => ({ ...c, mod1: { ...c.mod1, rate: v } }))} />
        <Stepper id={`p2-fx-${layer}-mod1-amount`} label={`Chain ${layer} Mod 1 amount`} value={chain.mod1.amount} min={0} max={10} format={(v) => `${v}`} onChange={(v) => fx.updateChain(layer, (c) => ({ ...c, mod1: { ...c.mod1, amount: v } }))} />
      </Row>
      <Row label={`Chain ${layer} Mod 2`}>
        <Toggle
          id={`p2-fx-${layer}-mod2-on`}
          label={`Chain ${layer} Mod 2 on`}
          on={chain.mod2.on}
          onFlip={() => fx.updateChain(layer, (c) => ({ ...c, mod2: { ...c.mod2, on: !c.mod2.on } }))}
        />
        <Stepper
          id={`p2-fx-${layer}-mod2-type`}
          label={`Chain ${layer} Mod 2 type`}
          value={chain.mod2.type === 'off' ? 0 : MOD2_TYPES.indexOf(chain.mod2.type) + 1}
          min={0}
          max={MOD2_TYPES.length}
          format={(v) => (v === 0 ? 'Off' : MOD2_TYPES[v - 1])}
          onChange={(v) =>
            fx.updateChain(layer, (c) => ({ ...c, mod2: { ...c.mod2, type: v === 0 ? 'off' : MOD2_TYPES[v - 1] } }))
          }
        />
        <Stepper id={`p2-fx-${layer}-mod2-rate`} label={`Chain ${layer} Mod 2 rate`} value={chain.mod2.rate} min={0} max={10} format={(v) => `${v}`} onChange={(v) => fx.updateChain(layer, (c) => ({ ...c, mod2: { ...c.mod2, rate: v } }))} />
        <Stepper id={`p2-fx-${layer}-mod2-amount`} label={`Chain ${layer} Mod 2 amount`} value={chain.mod2.amount} min={0} max={10} format={(v) => `${v}`} onChange={(v) => fx.updateChain(layer, (c) => ({ ...c, mod2: { ...c.mod2, amount: v } }))} />
      </Row>
      <Row label={`Chain ${layer} Delay`}>
        <Toggle
          id={`p2-fx-${layer}-delay-on`}
          label={`Chain ${layer} Delay on`}
          on={chain.delay.on}
          onFlip={() => fx.updateChain(layer, (c) => ({ ...c, delay: { ...c.delay, on: !c.delay.on } }))}
        />
        <Stepper id={`p2-fx-${layer}-delay-time`} label={`Chain ${layer} Delay time`} value={Math.round((chain.delay.timeMs - 20) / 148)} min={0} max={10} format={() => `${chain.delay.timeMs}ms`} onChange={(v) => fx.updateChain(layer, (c) => ({ ...c, delay: { ...c.delay, timeMs: 20 + v * 148 } }))} />
        <Stepper id={`p2-fx-${layer}-delay-fb`} label={`Chain ${layer} Delay feedback`} value={chain.delay.feedback} min={0} max={10} format={(v) => `${v}`} onChange={(v) => fx.updateChain(layer, (c) => ({ ...c, delay: { ...c.delay, feedback: v } }))} />
        <Stepper id={`p2-fx-${layer}-delay-wet`} label={`Chain ${layer} Delay dry wet`} value={chain.delay.wet} min={0} max={10} format={(v) => `${v}`} onChange={(v) => fx.updateChain(layer, (c) => ({ ...c, delay: { ...c.delay, wet: v } }))} />
        <Stepper
          id={`p2-fx-${layer}-delay-filter`}
          label={`Chain ${layer} Delay feedback filter`}
          value={['off', 'lp', 'hp', 'bp'].indexOf(chain.delay.filter)}
          min={0}
          max={3}
          format={(v) => ['Off', 'LP', 'HP', 'BP'][v]}
          onChange={(v) => fx.updateChain(layer, (c) => ({ ...c, delay: { ...c.delay, filter: ['off', 'lp', 'hp', 'bp'][v] as ChainState['delay']['filter'] } }))}
        />
        <Toggle
          id={`p2-fx-${layer}-delay-global`}
          label={`Chain ${layer} Delay global`}
          on={chain.delay.global}
          onFlip={() => fx.updateChain(layer, (c) => ({ ...c, delay: { ...c.delay, global: !c.delay.global } }))}
        />
        <button
          type="button"
          id={`p2-fx-${layer}-delay-tap`}
          data-testid={`p2-fx-${layer}-delay-tap`}
          aria-label={`Chain ${layer} Delay tap tempo`}
          className="p2-toggle"
          onPointerDown={(e) => {
            e.preventDefault();
            fx.tapDelay(layer);
          }}
          onKeyDown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault();
              fx.tapDelay(layer);
            }
          }}
        >
          Tap
        </button>
      </Row>
      <Row label={`Chain ${layer} Amp EQ`}>
        <Toggle
          id={`p2-fx-${layer}-amp-on`}
          label={`Chain ${layer} Amp on`}
          on={chain.ampEq.on}
          onFlip={() => fx.updateChain(layer, (c) => ({ ...c, ampEq: { ...c.ampEq, on: !c.ampEq.on } }))}
        />
        <Stepper
          id={`p2-fx-${layer}-amp-type`}
          label={`Chain ${layer} Amp type`}
          value={AMP_TYPES.indexOf(chain.ampEq.type)}
          min={0}
          max={AMP_TYPES.length - 1}
          format={(v) => AMP_TYPES[v]}
          onChange={(v) => fx.updateChain(layer, (c) => ({ ...c, ampEq: { ...c.ampEq, type: AMP_TYPES[v] } }))}
        />
        <Stepper id={`p2-fx-${layer}-amp-drive`} label={`Chain ${layer} Amp drive`} value={chain.ampEq.drive} min={0} max={10} format={(v) => `${v}`} onChange={(v) => fx.updateChain(layer, (c) => ({ ...c, ampEq: { ...c.ampEq, drive: v } }))} />
        <Stepper id={`p2-fx-${layer}-amp-bass`} label={`Chain ${layer} Amp bass`} value={chain.ampEq.bass + 15} min={0} max={30} format={() => `${chain.ampEq.bass}dB`} onChange={(v) => fx.updateChain(layer, (c) => ({ ...c, ampEq: { ...c.ampEq, bass: v - 15 } }))} />
        <Stepper id={`p2-fx-${layer}-amp-mid`} label={`Chain ${layer} Amp mid`} value={chain.ampEq.mid + 15} min={0} max={30} format={() => `${chain.ampEq.mid}dB`} onChange={(v) => fx.updateChain(layer, (c) => ({ ...c, ampEq: { ...c.ampEq, mid: v - 15 } }))} />
        <Stepper id={`p2-fx-${layer}-amp-freq`} label={`Chain ${layer} Amp freq`} value={Math.round((chain.ampEq.freq - 200) / 780)} min={0} max={10} format={() => `${chain.ampEq.freq}Hz`} onChange={(v) => fx.updateChain(layer, (c) => ({ ...c, ampEq: { ...c.ampEq, freq: 200 + v * 780 } }))} />
        <Stepper id={`p2-fx-${layer}-amp-treble`} label={`Chain ${layer} Amp treble`} value={chain.ampEq.treble + 15} min={0} max={30} format={() => `${chain.ampEq.treble}dB`} onChange={(v) => fx.updateChain(layer, (c) => ({ ...c, ampEq: { ...c.ampEq, treble: v - 15 } }))} />
        <Toggle
          id={`p2-fx-${layer}-torotary`}
          label={`Chain ${layer} To Rotary`}
          on={chain.rotaryOn}
          onFlip={() =>
            fx.updateChain(layer, (c) => ({
              ...c,
              rotaryOn: !c.rotaryOn,
              ampEq: { ...c.ampEq, type: !c.rotaryOn ? 'to-rotary' : c.ampEq.type === 'to-rotary' ? 'eq' : c.ampEq.type },
            }))
          }
        />
      </Row>
      <Row label={`Chain ${layer} Compressor`}>
        <Toggle
          id={`p2-fx-${layer}-comp-on`}
          label={`Chain ${layer} Compressor on`}
          on={chain.comp.on}
          onFlip={() => fx.updateChain(layer, (c) => ({ ...c, comp: { ...c.comp, on: !c.comp.on } }))}
        />
        <Stepper id={`p2-fx-${layer}-comp-amount`} label={`Chain ${layer} Compressor amount`} value={chain.comp.amount} min={0} max={10} format={(v) => `${v}`} onChange={(v) => fx.updateChain(layer, (c) => ({ ...c, comp: { ...c.comp, amount: v } }))} />
        <Toggle
          id={`p2-fx-${layer}-comp-fast`}
          label={`Chain ${layer} Compressor fast`}
          on={chain.comp.fast}
          onFlip={() => fx.updateChain(layer, (c) => ({ ...c, comp: { ...c.comp, fast: !c.comp.fast } }))}
        />
        <Toggle
          id={`p2-fx-${layer}-comp-global`}
          label={`Chain ${layer} Compressor global`}
          on={chain.comp.global}
          onFlip={() => fx.updateChain(layer, (c) => ({ ...c, comp: { ...c.comp, global: !c.comp.global } }))}
        />
      </Row>
      <Row label={`Chain ${layer} Reverb`}>
        <Toggle
          id={`p2-fx-${layer}-reverb-on`}
          label={`Chain ${layer} Reverb on`}
          on={chain.reverb.on}
          onFlip={() => fx.updateChain(layer, (c) => ({ ...c, reverb: { ...c.reverb, on: !c.reverb.on } }))}
        />
        <Stepper
          id={`p2-fx-${layer}-reverb-type`}
          label={`Chain ${layer} Reverb type`}
          value={REVERB_TYPES.indexOf(chain.reverb.type)}
          min={0}
          max={REVERB_TYPES.length - 1}
          format={(v) => REVERB_TYPES[v]}
          onChange={(v) => fx.updateChain(layer, (c) => ({ ...c, reverb: { ...c.reverb, type: REVERB_TYPES[v] } }))}
        />
        <Stepper id={`p2-fx-${layer}-reverb-wet`} label={`Chain ${layer} Reverb dry wet`} value={chain.reverb.wet} min={0} max={10} format={(v) => `${v}`} onChange={(v) => fx.updateChain(layer, (c) => ({ ...c, reverb: { ...c.reverb, wet: v } }))} />
        <Toggle
          id={`p2-fx-${layer}-reverb-bright`}
          label={`Chain ${layer} Reverb bright`}
          on={chain.reverb.bright}
          onFlip={() => fx.updateChain(layer, (c) => ({ ...c, reverb: { ...c.reverb, bright: !c.reverb.bright } }))}
        />
        <Toggle
          id={`p2-fx-${layer}-reverb-global`}
          label={`Chain ${layer} Reverb global`}
          on={chain.reverb.global}
          onFlip={() => fx.updateChain(layer, (c) => ({ ...c, reverb: { ...c.reverb, global: !c.reverb.global } }))}
        />
      </Row>
    </div>
  );
}

export function FxPanel() {
  const fx = usePianoFx();
  const snap = fx.snapshot;
  return (
    <div className="p2-panel" data-testid="p2-fx-panel" role="group" aria-label="Layer effects, functional">
      <div className="p2-panelhead" aria-hidden="true">
        LAYER EFFECTS · PIANO CHAINS + ROTARY
      </div>
      <Row label="Effects focus">
        {(['organ', 'piano', 'synth'] as const).map((f) => (
          <Toggle
            key={f}
            id={`p2-fx-focus-${f}`}
            label={`Effects focus ${f}`}
            on={snap.fx.focus === f}
            onFlip={() => fx.setFxFocus(f, true)}
          />
        ))}
        <Toggle
          id="p2-fx-focus-follow"
          label="Effects focus follow layer"
          on={!snap.fx.manual}
          onFlip={() => fx.setFxFocus('piano', false)}
        />
      </Row>
      <Row label="Group and bypass">
        <Toggle id="p2-fx-piano-group" label="Piano effect group" on={snap.fx.pianoGroup} onFlip={() => fx.setPianoGroup(!snap.fx.pianoGroup)} />
        <Toggle id="p2-fx-all-bypass" label="All effects bypass" on={snap.fx.allBypass} onFlip={() => fx.setAllBypass(!snap.fx.allBypass)} />
      </Row>
      <Row label={`Rotary ${snap.rotarySpeed}, drive ${snap.rotaryDrive} (see Performance: bridged speed and drive)`}>
        <div data-testid="p2-rotary-readout" aria-hidden="true" className="p2-programline">
          {`${snap.rotarySpeed} · drive ${snap.rotaryDrive}`}
        </div>
      </Row>
      <ChainEditor layer="A" />
      <ChainEditor layer="B" />
    </div>
  );
}

/**
 * Pitch bend readout mirror: the hardware stick (`perf-pitch-stick`, bridged)
 * is the control; this readout shows the same bend in semitones so panel
 * feedback and sound agree without a second competing control.
 */
export function MasterStrip() {
  const fx = usePianoFx();
  const bend = Math.round(fx.snapshot.pitchBendSt * 10) / 10;
  return (
    <div className="p2-panel p2-master" data-testid="p2-master-panel" role="group" aria-label={`Master and pitch readouts, bend ${bend} semitones`}>
      <div data-testid="p2-pitch-readout" aria-hidden="true" className="p2-programline">
        {`Bend ${bend >= 0 ? '+' : ''}${bend} st`}
      </div>
    </div>
  );
}
