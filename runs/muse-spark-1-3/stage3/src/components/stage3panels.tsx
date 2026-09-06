/**
 * Phase 3 functional panels: Program strip (slots/pages/dial/list, Store and
 * Store As with naming, dirty E, undo, Live), Split editor (points/positions/
 * crossfades, zone assignment), Scene + Morph + Clock/Transpose/Panic strip,
 * Organ strip (2 layers, models, drawbars with LED graphs, percussion, click,
 * vibrato/chorus), and Synth strip (3 layers, waves, filters, envelopes, LFO,
 * voice, arp/gate, chains).
 *
 * Every control has a `p3-*` stable ID, real roles/values, pointer+keyboard
 * operation, and drives canonical instrument state (no fake state). Phase 1–2
 * IDs above them are untouched — these strips are separate nodes rendered
 * after the inherited grids.
 */

import { useInstrument } from '../state/instrument';
import {
  LIVE_SLOTS,
  MORPH_TARGET_INFO,
  PROGRAM_SLOTS,
  SPLIT_POSITIONS,
  UNSUPPORTED_CONTROLS,
  slotLabel,
  type MorphSource,
} from '../state/program';
import { ORGAN_MODELS, VIB_CHORUS_POSITIONS, type OrganLayerId, type OrganModelId } from '../audio/organTypes';
import {
  ALL_WAVES,
  LFO_DESTS,
  LFO_WAVES,
  SYNTH_FILTERS,
  waveCategory,
  type SynthLayerId,
} from '../audio/synthTypes';
import type { ChainState } from '../state/fxTypes';
import { AMP_TYPES, MOD1_TYPES, MOD2_TYPES, REVERB_TYPES } from '../state/fxTypes';

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
}: {
  id: string;
  label: string;
  on: boolean;
  onFlip: () => void;
}) {
  return (
    <button
      type="button"
      id={id}
      data-testid={id}
      aria-label={label}
      aria-pressed={on}
      data-on={on ? 'true' : 'false'}
      className={`p2-toggle${on ? ' on' : ''}`}
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

// --- Program ---------------------------------------------------------------

export function ProgramPanel() {
  const fx = useInstrument();
  const snap = fx.snapshot;
  const draft = snap.storeDraft;
  const pageSlots = Array.from({ length: 8 }, (_, i) => (snap.page - 1) * 8 + i);
  return (
    <div className="p2-panel" data-testid="p3-program-panel" role="group" aria-label="Programs, functional">
      <div className="p2-panelhead" aria-hidden="true">
        PROGRAMS · 32 SLOTS + LIVE
      </div>
      <div className="p2-programline" data-testid="p3-program-display" role="status" aria-label="Current program">
        {fx.displayText()}
      </div>
      {snap.storeFlash ? (
        <div className="p2-programline" data-testid="p3-store-flash" role="status" aria-label="Store message">
          {snap.storeFlash}
        </div>
      ) : null}
      <Row label={`Program page ${snap.page} of 4`}>
        {[1, 2, 3, 4].map((p) => (
          <Toggle key={p} id={`p3-program-page-${p}`} label={`Program page ${p}`} on={snap.page === p} onFlip={() => fx.setPage(p)} />
        ))}
        <Stepper
          id="p3-program-dial"
          label="Program dial"
          value={snap.liveMode ? snap.liveSlot : snap.slot}
          min={0}
          max={snap.liveMode ? LIVE_SLOTS - 1 : PROGRAM_SLOTS - 1}
          format={(v) => (snap.liveMode ? `Live ${v + 1}` : slotLabel(v))}
          onChange={(v) => {
            if (draft) fx.setStoreDest(v, draft.liveDest !== null ? v : null);
            else if (snap.liveMode) fx.selectLive(v);
            else fx.selectSlot(v);
          }}
        />
      </Row>
      <Row label={snap.liveMode ? 'Live slots' : `Program slots page ${snap.page}`}>
        {(snap.liveMode ? Array.from({ length: LIVE_SLOTS }, (_, i) => i) : pageSlots).map((s) => (
          <Toggle
            key={s}
            id={snap.liveMode ? `p3-live-${s + 1}` : `p3-slot-${s}`}
            label={snap.liveMode ? `Live slot ${s + 1} ${fx.stores.live[s].name}` : `Program ${slotLabel(s)} ${fx.stores.programs[s].name}`}
            on={snap.liveMode ? snap.liveSlot === s : snap.slot === s}
            onFlip={() => {
              if (draft) fx.setStoreDest(s, draft.liveDest !== null ? s : null);
              else if (snap.liveMode) fx.selectLive(s);
              else fx.selectSlot(s);
            }}
          />
        ))}
      </Row>
      <Row label="Live mode, list view, store">
        <Toggle id="p3-live-mode" label="Live Mode" on={snap.liveMode} onFlip={() => fx.setLiveMode(!snap.liveMode)} />
        <Toggle id="p3-list-view" label="Program list view" on={snap.listView} onFlip={() => fx.setListView(!snap.listView)} />
        <Toggle id="p3-store" label="Store" on={!!draft && !draft.naming} onFlip={() => (draft ? fx.confirmStore() : fx.beginStore(false))} />
        <Toggle id="p3-store-as" label="Store As with naming" on={!!draft?.naming} onFlip={() => (draft ? fx.confirmStore() : fx.beginStore(true))} />
        {draft ? <Toggle id="p3-store-cancel" label="Cancel store" on={false} onFlip={() => fx.cancelStore()} /> : null}
        {snap.undoLabel ? <Toggle id="p3-undo" label={`Undo ${snap.undoLabel}`} on={false} onFlip={() => fx.undo()} /> : null}
      </Row>
      {draft?.naming ? (
        <Row label="Store As naming">
          <input
            id="p3-store-name"
            data-testid="p3-store-name"
            aria-label="Program name"
            value={draft.name}
            maxLength={16}
            onChange={(e) => fx.setStoreName(e.target.value)}
          />
          <Stepper
            id="p3-store-char"
            label="Program name character"
            value={0}
            min={0}
            max={36}
            format={(v) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 '[v] ?? 'A'}
            onChange={(v) => fx.setStoreName(`${draft.name}${'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 '[v] ?? ''}`)}
          />
          <Toggle
            id="p3-store-del"
            label="Delete last character"
            on={false}
            onFlip={() => fx.setStoreName(draft.name.slice(0, -1))}
          />
        </Row>
      ) : null}
      {snap.listView ? (
        <div className="p2-chain" data-testid="p3-program-list" role="listbox" aria-label="Numeric program list">
          {Array.from({ length: PROGRAM_SLOTS }, (_, s) => (
            <button
              key={s}
              type="button"
              role="option"
              aria-selected={snap.slot === s}
              data-testid={`p3-program-list-${s}`}
              className={snap.slot === s ? 'p2-type on' : 'p2-type'}
              onPointerDown={(e) => {
                e.preventDefault();
                fx.selectSlot(s);
              }}
            >
              {`${slotLabel(s)} ${fx.stores.programs[s].name}${s === snap.slot && snap.dirty ? ' E' : ''}`}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// --- Split / zones -----------------------------------------------------------

const ZONE_KEYS = [
  { key: 'pianoA', label: 'Piano A' },
  { key: 'pianoB', label: 'Piano B' },
  { key: 'organA', label: 'Organ A' },
  { key: 'organB', label: 'Organ B' },
  { key: 'synthA', label: 'Synth A' },
  { key: 'synthB', label: 'Synth B' },
  { key: 'synthC', label: 'Synth C' },
] as const;

export function SplitPanel() {
  const fx = useInstrument();
  const split = fx.snapshot.program.split;
  return (
    <div className="p2-panel" data-testid="p3-split-panel" role="group" aria-label="Splits and zones, functional">
      <div className="p2-panelhead" aria-hidden="true">
        SPLIT · ZONES · XFADE
      </div>
      <Row label="Split on">
        <Toggle id="p3-split-on" label="Split on" on={split.on} onFlip={() => fx.setSplitOn(!split.on)} />
      </Row>
      {(['low', 'mid', 'high'] as const).map((which) => {
        const pt = split[which];
        return (
          <Row label={`Split point ${which}`} key={which}>
            <Toggle
              id={`p3-split-${which}-active`}
              label={`Split point ${which} active`}
              on={pt.active}
              onFlip={() => fx.setSplitPoint(which, { active: !pt.active })}
            />
            <Stepper
              id={`p3-split-${which}-pos`}
              label={`Split point ${which} position`}
              value={SPLIT_POSITIONS.findIndex((p) => p.id === pt.pos)}
              min={0}
              max={SPLIT_POSITIONS.length - 1}
              format={(v) => SPLIT_POSITIONS[v].id}
              onChange={(v) => fx.setSplitPoint(which, { pos: SPLIT_POSITIONS[v].id })}
            />
            <Stepper
              id={`p3-split-${which}-xfade`}
              label={`Split point ${which} crossfade`}
              value={pt.xfade === 0 ? 0 : pt.xfade === 6 ? 1 : 2}
              min={0}
              max={2}
              format={(v) => (v === 0 ? 'Off' : v === 1 ? '±6' : '±12')}
              onChange={(v) => fx.setSplitPoint(which, { xfade: (v === 0 ? 0 : v === 1 ? 6 : 12) as 0 | 6 | 12 })}
            />
          </Row>
        );
      })}
      {ZONE_KEYS.map(({ key, label }) => {
        const z = fx.snapshot.program.zones[key.split(/(?=[A-C]$)/)[0] as 'piano' | 'organ' | 'synth'][key.slice(-1) as never] as unknown as { lo: number; hi: number };
        return (
          <Row label={`${label} zone`} key={key}>
            <Stepper
              id={`p3-zone-${key}-lo`}
              label={`${label} zone low`}
              value={z.lo}
              min={0}
              max={3}
              format={(v) => `Z${v + 1}`}
              onChange={(v) => fx.setZone(key, { lo: v, hi: Math.max(v, z.hi) })}
            />
            <Stepper
              id={`p3-zone-${key}-hi`}
              label={`${label} zone high`}
              value={z.hi}
              min={0}
              max={3}
              format={(v) => `Z${v + 1}`}
              onChange={(v) => fx.setZone(key, { lo: Math.min(z.lo, v), hi: v })}
            />
          </Row>
        );
      })}
    </div>
  );
}

/** Split-point LEDs above the keybed: active positions. */
export function SplitLeds() {
  const fx = useInstrument();
  if (!fx) return null;
  const split = fx.snapshot.program.split;
  const active = new Set(
    split.on ? [split.low, split.mid, split.high].filter((p) => p.active).map((p) => p.pos) : [],
  );
  return (
    <div className="p2-programline" data-testid="p3-split-leds" role="status" aria-label={`Active split points: ${[...active].join(', ') || 'none'}`}>
      {SPLIT_POSITIONS.map((p) => (
        <span key={p.id} data-testid={`p3-split-led-${p.id}`} data-on={active.has(p.id) ? 'true' : 'false'} aria-hidden="true">
          {active.has(p.id) ? '●' : '○'}
          {p.id}
        </span>
      ))}
    </div>
  );
}

// --- Scenes / morphs / clock ---------------------------------------------------

export function SceneMorphPanel() {
  const fx = useInstrument();
  const snap = fx.snapshot;
  const p = snap.program;
  const enables = p.scenes[snap.scene];
  const setEnable = (key: keyof typeof enables) => {
    fx.setSceneEnables(snap.scene, (m) => {
      const next = { ...m, [key]: !m[key] };
      // Scene I/II toggles layer enable state without duplicating sound.
      return next;
    });
  };
  return (
    <div className="p2-panel" data-testid="p3-scene-panel" role="group" aria-label="Scenes, morphs, clock, functional">
      <div className="p2-panelhead" aria-hidden="true">
        SCENES · MORPHS · CLOCK
      </div>
      <Row label="Layer scenes I and II">
        <Toggle id="p3-scene-1" label="Layer Scene I" on={snap.scene === 'I'} onFlip={() => fx.setScene('I')} />
        <Toggle id="p3-scene-2" label="Layer Scene II" on={snap.scene === 'II'} onFlip={() => fx.setScene('II')} />
        <Toggle id="p3-solo" label="Solo audition" on={snap.solo} onFlip={() => fx.setSolo(!snap.solo)} />
      </Row>
      <Row label={`Scene ${snap.scene} layer enables`}>
        {(['pianoA', 'pianoB', 'organA', 'organB', 'synthA', 'synthB', 'synthC'] as const).map((k) => (
          <Toggle key={k} id={`p3-scene-${snap.scene}-${k}`} label={`Scene ${snap.scene} ${k} enable`} on={!!enables[k]} onFlip={() => setEnable(k)} />
        ))}
      </Row>
      <Row label="Wheel and Control Pedal morphs">
        {(['wheel', 'pedal'] as MorphSource[]).map((source) => {
          const assigns = p.morphs[source];
          return (
            <div key={source} className="p2-chain" data-testid={`p3-morph-${source}`} role="group" aria-label={`${source} morph`}>
              <Toggle
                id={`p3-morph-${source}-arm`}
                label={`${source === 'wheel' ? 'Wheel' : 'Control Pedal'} morph assign${fx.morphArmed === source ? ' (latched, move a destination)' : ''}`}
                on={fx.morphArmed === source}
                onFlip={() => {
                  if (fx.morphArmed === source) fx.endMorphCapture(source);
                  else fx.beginMorphCapture(source);
                }}
              />
              <span className="p2-programline" data-testid={`p3-morph-${source}-count`} aria-hidden="true">
                {assigns.length} destinations
              </span>
              <Toggle
                id={`p3-morph-${source}-clear`}
                label={`Clear ${source} morph`}
                on={false}
                onFlip={() => fx.clearMorph(source)}
              />
            </div>
          );
        })}
      </Row>
      <Row label="Master Clock">
        <Stepper id="p3-clock-bpm" label="Master Clock tempo" value={p.clockBpm} min={30} max={300} format={(v) => `${v} BPM`} onChange={(v) => fx.setClockBpm(v)} />
        <Toggle id="p3-clock-tap" label="Master Clock tap tempo" on={false} onFlip={() => fx.tapClock(Date.now())} />
        <Toggle id="p3-clock-kbsync" label="Keyboard Sync" on={p.kbSync} onFlip={() => fx.setKbSync(!p.kbSync)} />
      </Row>
      <Row label="Transpose and Panic">
        <Stepper id="p3-transpose" label="Transpose semitones" value={p.transpose + 6} min={0} max={12} format={() => `${p.transpose >= 0 ? '+' : ''}${p.transpose} st`} onChange={(v) => fx.setTranspose(v - 6)} />
        <Toggle id="p3-panic" label="Panic all notes off" on={false} onFlip={() => fx.setTranspose(p.transpose)} />
      </Row>
      <div className="p2-programline" data-testid="p3-transpose-readout" role="status" aria-label={`Transpose ${p.transpose} semitones`}>
        {`Transpose ${p.transpose >= 0 ? '+' : ''}${p.transpose} · Clock ${p.clockBpm} BPM${p.kbSync ? ' · KB Sync' : ''}`}
      </div>
    </div>
  );
}

// --- Organ ---------------------------------------------------------------------

const FOOTAGES = ["16'", "5 1/3'", "8'", "4'", "2 2/3'", "2'", "1 3/5'", "1 1/3'", "1'"];

function OrganLayerBlock({ layer }: { layer: OrganLayerId }) {
  const fx = useInstrument();
  const st = fx.snapshot.program.organ.layers[layer];
  const focus = fx.snapshot.program.organ.focus === layer;
  const edit = (patch: Partial<typeof st>) => {
    fx.edit((p) => ({ ...p, organ: { ...p.organ, layers: { ...p.organ.layers, [layer]: { ...p.organ.layers[layer], ...patch } } } }));
  };
  const morphTarget = (t: string, value: number) => {
    if (fx.morphArmed) fx.captureMorphControl(fx.morphArmed, t, value);
  };
  return (
    <div className="p2-layer" data-testid={`p3-organ-layer-${layer}`} role="group" aria-label={`Organ layer ${layer}`}>
      <Row label={`Organ layer ${layer} enable and focus`}>
        <Toggle
          id={`p3-organ-${layer}-on`}
          label={`Organ layer ${layer} enable`}
          on={st.enabled}
          onFlip={() => {
            edit({ enabled: !st.enabled });
            morphTarget(`organ.${layer}.level`, st.level);
          }}
        />
        <Toggle
          id={`p3-organ-${layer}-focus`}
          label={`Organ layer ${layer} focus`}
          on={focus}
          onFlip={() => fx.edit((p) => ({ ...p, organ: { ...p.organ, focus: layer } }))}
        />
      </Row>
      <Row label={`Organ layer ${layer} model`}>
        <div id={`p3-organ-${layer}-model`} data-testid={`p3-organ-${layer}-model`} role="listbox" aria-label={`Organ layer ${layer} model`} className="p2-types">
          {ORGAN_MODELS.map((m: OrganModelId) => (
            <button
              key={m}
              type="button"
              role="option"
              aria-selected={st.model === m}
              data-testid={`p3-organ-${layer}-model-${m.replace(/ /g, '-')}`}
              data-active={st.model === m ? 'true' : 'false'}
              className={st.model === m ? 'p2-type on' : 'p2-type'}
              onPointerDown={(e) => {
                e.preventDefault();
                edit({ model: m });
              }}
            >
              {m}
            </button>
          ))}
        </div>
      </Row>
      <Row label={`Organ layer ${layer} drawbars`}>
        {st.drawbars.map((v, i) => (
          <div key={i} className="ctl" data-testid={`p3-organ-${layer}-drawbar-wrap-${i + 1}`}>
            <div
              id={`p3-organ-${layer}-drawbar-${i + 1}`}
              data-testid={`p3-organ-${layer}-drawbar-${i + 1}`}
              role="slider"
              tabIndex={0}
              aria-label={`Organ layer ${layer} drawbar ${i + 1} ${FOOTAGES[i]}`}
              aria-valuemin={0}
              aria-valuemax={8}
              aria-valuenow={v}
              data-value={v}
              data-morph={fx.snapshot.program.morphs.wheel.some((a) => a.target === `organ.drawbar.${i + 1}`) || fx.snapshot.program.morphs.pedal.some((a) => a.target === `organ.drawbar.${i + 1}`) ? 'true' : 'false'}
              className="p2-stepper"
              onPointerDown={(e) => {
                e.preventDefault();
                const next = v >= 8 ? 0 : v + 1;
                const drawbars = [...st.drawbars];
                drawbars[i] = next;
                edit({ drawbars });
                morphTarget(`organ.drawbar.${i + 1}`, next);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  const drawbars = [...st.drawbars];
                  drawbars[i] = Math.min(8, v + 1);
                  edit({ drawbars });
                  morphTarget(`organ.drawbar.${i + 1}`, drawbars[i]);
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
                  e.preventDefault();
                  const drawbars = [...st.drawbars];
                  drawbars[i] = Math.max(0, v - 1);
                  edit({ drawbars });
                  morphTarget(`organ.drawbar.${i + 1}`, drawbars[i]);
                }
              }}
            >
              <span className="ctl-leds" aria-hidden="true">
                {Array.from({ length: 9 }, (_, led) => (
                  <i key={led} className={led <= v ? 'on' : ''} />
                ))}
              </span>
              <span className="p2-stepperval" aria-hidden="true">
                {`${FOOTAGES[i]}:${v}`}
              </span>
            </div>
          </div>
        ))}
      </Row>
      <Row label={`Organ layer ${layer} level and octave`}>
        <Stepper id={`p3-organ-${layer}-level`} label={`Organ layer ${layer} level`} value={st.level} min={0} max={10} format={(v) => `Level ${v}`} onChange={(v) => { edit({ level: v }); morphTarget(`organ.${layer}.level`, v); }} />
        <Stepper id={`p3-organ-${layer}-octave`} label={`Organ layer ${layer} octave shift`} value={st.octave} min={0} max={4} format={(v) => `Oct ${(v - 2) * 12 >= 0 ? '+' : ''}${(v - 2) * 12}`} onChange={(v) => edit({ octave: v })} />
      </Row>
      <Row label={`Organ layer ${layer} percussion`}>
        <Toggle id={`p3-organ-${layer}-perc-on`} label={`Organ layer ${layer} percussion on`} on={st.percussion.on} onFlip={() => edit({ percussion: { ...st.percussion, on: !st.percussion.on } })} />
        <Toggle id={`p3-organ-${layer}-perc-soft`} label={`Organ layer ${layer} percussion soft`} on={st.percussion.soft} onFlip={() => edit({ percussion: { ...st.percussion, soft: !st.percussion.soft } })} />
        <Toggle id={`p3-organ-${layer}-perc-fast`} label={`Organ layer ${layer} percussion decay fast`} on={st.percussion.fast} onFlip={() => edit({ percussion: { ...st.percussion, fast: !st.percussion.fast } })} />
        <Toggle id={`p3-organ-${layer}-perc-third`} label={`Organ layer ${layer} percussion harmonic third`} on={st.percussion.third} onFlip={() => edit({ percussion: { ...st.percussion, third: !st.percussion.third } })} />
        <Toggle id={`p3-organ-${layer}-click`} label={`Organ layer ${layer} key click`} on={st.keyClick} onFlip={() => edit({ keyClick: !st.keyClick })} />
      </Row>
      <Row label={`Organ layer ${layer} vibrato chorus`}>
        <Toggle id={`p3-organ-${layer}-vib-on`} label={`Organ layer ${layer} vibrato chorus on`} on={st.vibOn} onFlip={() => edit({ vibOn: !st.vibOn })} />
        <div id={`p3-organ-${layer}-vib`} data-testid={`p3-organ-${layer}-vib`} role="listbox" aria-label={`Organ layer ${layer} vibrato chorus type`} className="p2-types">
          {VIB_CHORUS_POSITIONS.map((pos) => (
            <button
              key={pos}
              type="button"
              role="option"
              aria-selected={st.vibChorus === pos}
              data-testid={`p3-organ-${layer}-vib-${pos}`}
              data-active={st.vibChorus === pos ? 'true' : 'false'}
              className={st.vibChorus === pos ? 'p2-type on' : 'p2-type'}
              onPointerDown={(e) => {
                e.preventDefault();
                edit({ vibChorus: pos });
              }}
            >
              {pos}
            </button>
          ))}
        </div>
      </Row>
      <Row label={`Organ layer ${layer} pedal routing`}>
        <Toggle id={`p3-organ-${layer}-sustped`} label={`Organ layer ${layer} sustain pedal enable`} on={st.sustPed} onFlip={() => edit({ sustPed: !st.sustPed })} />
        <Toggle id={`p3-organ-${layer}-pstick`} label={`Organ layer ${layer} pitch stick enable`} on={st.pStick} onFlip={() => edit({ pStick: !st.pStick })} />
      </Row>
    </div>
  );
}

export function OrganPanel() {
  const fx = useInstrument();
  const organ = fx.snapshot.program.organ;
  return (
    <div className="p2-panel" data-testid="p3-organ-panel" role="group" aria-label="Organ layers, functional">
      <div className="p2-panelhead" aria-hidden="true">
        ORGAN · LAYERS A/B · SHARED CHAIN
      </div>
      <Row label="Organ section">
        <Toggle id="p3-organ-section-on" label="Organ section on" on={organ.sectionOn} onFlip={() => fx.edit((p) => ({ ...p, organ: { ...p.organ, sectionOn: !p.organ.sectionOn } }))} />
        <Toggle id="p3-organ-rotary" label="Organ route to rotary" on={organ.organRotary} onFlip={() => fx.edit((p) => ({ ...p, organ: { ...p.organ, organRotary: !p.organ.organRotary } }))} />
      </Row>
      <OrganLayerBlock layer="A" />
      <OrganLayerBlock layer="B" />
      <OrganChainEditor />
    </div>
  );
}

function OrganChainEditor() {
  const fx = useInstrument();
  const chain = fx.snapshot.program.organ.chain;
  const update = (patch: (c: ChainState) => ChainState) => {
    fx.edit((p) => ({ ...p, organ: { ...p.organ, chain: patch(p.organ.chain) } }));
  };
  return (
    <div className="p2-chain" data-testid="p3-organ-chain" role="group" aria-label="Organ shared effects chain">
      <Row label="Organ chain Mod 1">
        <Toggle id="p3-organ-fx-mod1-on" label="Organ chain Mod 1 on" on={chain.mod1.on} onFlip={() => update((c) => ({ ...c, mod1: { ...c.mod1, on: !c.mod1.on } }))} />
        <Stepper id="p3-organ-fx-mod1-type" label="Organ chain Mod 1 type" value={chain.mod1.type === 'off' ? 0 : MOD1_TYPES.indexOf(chain.mod1.type) + 1} min={0} max={MOD1_TYPES.length} format={(v) => (v === 0 ? 'Off' : MOD1_TYPES[v - 1])} onChange={(v) => update((c) => ({ ...c, mod1: { ...c.mod1, type: v === 0 ? 'off' : MOD1_TYPES[v - 1] } }))} />
        <Stepper id="p3-organ-fx-mod1-rate" label="Organ chain Mod 1 rate" value={chain.mod1.rate} min={0} max={10} format={(v) => `${v}`} onChange={(v) => update((c) => ({ ...c, mod1: { ...c.mod1, rate: v } }))} />
        <Stepper id="p3-organ-fx-mod1-amount" label="Organ chain Mod 1 amount" value={chain.mod1.amount} min={0} max={10} format={(v) => `${v}`} onChange={(v) => update((c) => ({ ...c, mod1: { ...c.mod1, amount: v } }))} />
        <Toggle id="p3-organ-fx-mod1-sync" label="Organ chain Mod 1 clock sync" on={chain.mod1.sync} onFlip={() => update((c) => ({ ...c, mod1: { ...c.mod1, sync: !c.mod1.sync } }))} />
      </Row>
      <Row label="Organ chain Mod 2">
        <Toggle id="p3-organ-fx-mod2-on" label="Organ chain Mod 2 on" on={chain.mod2.on} onFlip={() => update((c) => ({ ...c, mod2: { ...c.mod2, on: !c.mod2.on } }))} />
        <Stepper id="p3-organ-fx-mod2-type" label="Organ chain Mod 2 type" value={chain.mod2.type === 'off' ? 0 : MOD2_TYPES.indexOf(chain.mod2.type) + 1} min={0} max={MOD2_TYPES.length} format={(v) => (v === 0 ? 'Off' : MOD2_TYPES[v - 1])} onChange={(v) => update((c) => ({ ...c, mod2: { ...c.mod2, type: v === 0 ? 'off' : MOD2_TYPES[v - 1] } }))} />
        <Stepper id="p3-organ-fx-mod2-amount" label="Organ chain Mod 2 amount" value={chain.mod2.amount} min={0} max={10} format={(v) => `${v}`} onChange={(v) => update((c) => ({ ...c, mod2: { ...c.mod2, amount: v } }))} />
      </Row>
      <Row label="Organ chain Delay">
        <Toggle id="p3-organ-fx-delay-on" label="Organ chain Delay on" on={chain.delay.on} onFlip={() => update((c) => ({ ...c, delay: { ...c.delay, on: !c.delay.on } }))} />
        <Stepper id="p3-organ-fx-delay-time" label="Organ chain Delay time" value={Math.round((chain.delay.timeMs - 20) / 148)} min={0} max={10} format={() => `${chain.delay.timeMs}ms`} onChange={(v) => update((c) => ({ ...c, delay: { ...c.delay, timeMs: 20 + v * 148 } }))} />
        <Stepper id="p3-organ-fx-delay-fb" label="Organ chain Delay feedback" value={chain.delay.feedback} min={0} max={10} format={(v) => `${v}`} onChange={(v) => update((c) => ({ ...c, delay: { ...c.delay, feedback: v } }))} />
        <Stepper id="p3-organ-fx-delay-wet" label="Organ chain Delay dry wet" value={chain.delay.wet} min={0} max={10} format={(v) => `${v}`} onChange={(v) => update((c) => ({ ...c, delay: { ...c.delay, wet: v } }))} />
        <Toggle id="p3-organ-fx-delay-sync" label="Organ chain Delay clock sync" on={chain.delay.sync} onFlip={() => update((c) => ({ ...c, delay: { ...c.delay, sync: !c.delay.sync } }))} />
        <Toggle id="p3-organ-fx-delay-global" label="Organ chain Delay global" on={chain.delay.global} onFlip={() => update((c) => ({ ...c, delay: { ...c.delay, global: !c.delay.global } }))} />
      </Row>
      <Row label="Organ chain Amp EQ">
        <Toggle id="p3-organ-fx-amp-on" label="Organ chain Amp on" on={chain.ampEq.on} onFlip={() => update((c) => ({ ...c, ampEq: { ...c.ampEq, on: !c.ampEq.on } }))} />
        <Stepper id="p3-organ-fx-amp-type" label="Organ chain Amp type" value={AMP_TYPES.indexOf(chain.ampEq.type)} min={0} max={AMP_TYPES.length - 1} format={(v) => AMP_TYPES[v]} onChange={(v) => update((c) => ({ ...c, ampEq: { ...c.ampEq, type: AMP_TYPES[v] } }))} />
        <Stepper id="p3-organ-fx-amp-drive" label="Organ chain Amp drive" value={chain.ampEq.drive} min={0} max={10} format={(v) => `${v}`} onChange={(v) => update((c) => ({ ...c, ampEq: { ...c.ampEq, drive: v } }))} />
      </Row>
      <Row label="Organ chain Compressor">
        <Toggle id="p3-organ-fx-comp-on" label="Organ chain Compressor on" on={chain.comp.on} onFlip={() => update((c) => ({ ...c, comp: { ...c.comp, on: !c.comp.on } }))} />
        <Stepper id="p3-organ-fx-comp-amount" label="Organ chain Compressor amount" value={chain.comp.amount} min={0} max={10} format={(v) => `${v}`} onChange={(v) => update((c) => ({ ...c, comp: { ...c.comp, amount: v } }))} />
        <Toggle id="p3-organ-fx-comp-global" label="Organ chain Compressor global" on={chain.comp.global} onFlip={() => update((c) => ({ ...c, comp: { ...c.comp, global: !c.comp.global } }))} />
      </Row>
      <Row label="Organ chain Reverb">
        <Toggle id="p3-organ-fx-reverb-on" label="Organ chain Reverb on" on={chain.reverb.on} onFlip={() => update((c) => ({ ...c, reverb: { ...c.reverb, on: !c.reverb.on } }))} />
        <Stepper id="p3-organ-fx-reverb-type" label="Organ chain Reverb type" value={REVERB_TYPES.indexOf(chain.reverb.type)} min={0} max={REVERB_TYPES.length - 1} format={(v) => REVERB_TYPES[v]} onChange={(v) => update((c) => ({ ...c, reverb: { ...c.reverb, type: REVERB_TYPES[v] } }))} />
        <Stepper id="p3-organ-fx-reverb-wet" label="Organ chain Reverb dry wet" value={chain.reverb.wet} min={0} max={10} format={(v) => `${v}`} onChange={(v) => update((c) => ({ ...c, reverb: { ...c.reverb, wet: v } }))} />
        <Toggle id="p3-organ-fx-reverb-global" label="Organ chain Reverb global" on={chain.reverb.global} onFlip={() => update((c) => ({ ...c, reverb: { ...c.reverb, global: !c.reverb.global } }))} />
      </Row>
    </div>
  );
}

// --- Synth ---------------------------------------------------------------------

function SynthLayerBlock({ layer }: { layer: SynthLayerId }) {
  const fx = useInstrument();
  const st = fx.snapshot.program.synth.layers[layer];
  const focus = fx.snapshot.program.synth.focus === layer;
  const edit = (patch: Partial<typeof st>) => {
    fx.edit((p) => {
      const applyTo: SynthLayerId[] = p.synth.group ? ['A', 'B', 'C'] : [layer];
      const layers = { ...p.synth.layers };
      for (const l of applyTo) layers[l] = { ...layers[l], ...patch };
      return { ...p, synth: { ...p.synth, layers } };
    });
  };
  const morphTarget = (t: string, value: number) => {
    if (fx.morphArmed) fx.captureMorphControl(fx.morphArmed, t, value);
  };
  const cat = waveCategory(st.wave);
  return (
    <div className="p2-layer" data-testid={`p3-synth-layer-${layer}`} role="group" aria-label={`Synth layer ${layer} (${cat})`}>
      <Row label={`Synth layer ${layer} enable and focus`}>
        <Toggle id={`p3-synth-${layer}-on`} label={`Synth layer ${layer} enable`} on={st.enabled} onFlip={() => edit({ enabled: !st.enabled })} />
        <Toggle id={`p3-synth-${layer}-focus`} label={`Synth layer ${layer} focus`} on={focus} onFlip={() => fx.edit((p) => ({ ...p, synth: { ...p.synth, focus: layer } }))} />
      </Row>
      <Row label={`Synth layer ${layer} waveform (${cat})`}>
        <div id={`p3-synth-${layer}-wave`} data-testid={`p3-synth-${layer}-wave`} role="listbox" aria-label={`Synth layer ${layer} waveform`} className="p2-types">
          {ALL_WAVES.map((w) => (
            <button
              key={w}
              type="button"
              role="option"
              aria-selected={st.wave === w}
              data-testid={`p3-synth-${layer}-wave-${w.replace(/[^a-z0-9]+/gi, '-')}`}
              data-active={st.wave === w ? 'true' : 'false'}
              data-category={waveCategory(w)}
              className={st.wave === w ? 'p2-type on' : 'p2-type'}
              onPointerDown={(e) => {
                e.preventDefault();
                edit({ wave: w });
              }}
            >
              {w}
            </button>
          ))}
        </div>
      </Row>
      <Row label={`Synth layer ${layer} oscillator`}>
        <Stepper id={`p3-synth-${layer}-oscctrl`} label={`Synth layer ${layer} Osc Ctrl`} value={st.oscCtrl} min={0} max={10} format={(v) => `${v}`} onChange={(v) => { edit({ oscCtrl: v }); morphTarget(`synth.${layer}.oscCtrl`, v); }} />
        <Stepper id={`p3-synth-${layer}-coarse`} label={`Synth layer ${layer} coarse semitones`} value={st.coarse + 24} min={0} max={48} format={() => `${st.coarse >= 0 ? '+' : ''}${st.coarse} st`} onChange={(v) => edit({ coarse: v - 24 })} />
        <Stepper id={`p3-synth-${layer}-fine`} label={`Synth layer ${layer} fine cents`} value={st.fine + 50} min={0} max={100} format={() => `${st.fine >= 0 ? '+' : ''}${st.fine} ct`} onChange={(v) => edit({ fine: v - 50 })} />
        <Stepper id={`p3-synth-${layer}-level`} label={`Synth layer ${layer} level`} value={st.level} min={0} max={10} format={(v) => `Level ${v}`} onChange={(v) => { edit({ level: v }); morphTarget(`synth.${layer}.level`, v); }} />
        <Stepper id={`p3-synth-${layer}-octave`} label={`Synth layer ${layer} octave shift`} value={st.octave} min={0} max={4} format={(v) => `Oct ${(v - 2) * 12 >= 0 ? '+' : ''}${(v - 2) * 12}`} onChange={(v) => edit({ octave: v })} />
      </Row>
      <Row label={`Synth layer ${layer} filter`}>
        <Stepper id={`p3-synth-${layer}-filter-type`} label={`Synth layer ${layer} filter type`} value={SYNTH_FILTERS.indexOf(st.filterType)} min={0} max={3} format={(v) => SYNTH_FILTERS[v]} onChange={(v) => edit({ filterType: SYNTH_FILTERS[v] })} />
        <Stepper id={`p3-synth-${layer}-filter-freq`} label={`Synth layer ${layer} filter freq`} value={st.filterFreq} min={0} max={10} format={(v) => `${v}`} onChange={(v) => { edit({ filterFreq: v }); morphTarget(`synth.${layer}.filterFreq`, v); }} />
        <Stepper id={`p3-synth-${layer}-filter-res`} label={`Synth layer ${layer} filter resonance`} value={st.filterRes} min={0} max={10} format={(v) => `${v}`} onChange={(v) => { edit({ filterRes: v }); morphTarget(`synth.${layer}.filterRes`, v); }} />
        <Stepper id={`p3-synth-${layer}-filter-envamt`} label={`Synth layer ${layer} filter envelope amount`} value={st.filterEnvAmt} min={0} max={10} format={(v) => `${v}`} onChange={(v) => edit({ filterEnvAmt: v })} />
        <Stepper id={`p3-synth-${layer}-tracking`} label={`Synth layer ${layer} keyboard tracking`} value={['Off', '1/3', '2/3', '1'].indexOf(st.tracking)} min={0} max={3} format={(v) => ['Off', '1/3', '2/3', '1'][v]} onChange={(v) => edit({ tracking: (['Off', '1/3', '2/3', '1'] as const)[v] })} />
        <Stepper id={`p3-synth-${layer}-drive`} label={`Synth layer ${layer} drive`} value={st.drive} min={0} max={3} format={(v) => (v === 0 ? 'Off' : `${v}`)} onChange={(v) => edit({ drive: v })} />
      </Row>
      <Row label={`Synth layer ${layer} envelopes`}>
        <Stepper id={`p3-synth-${layer}-amp-attack`} label={`Synth layer ${layer} amp attack`} value={st.ampEnv.attack} min={0} max={10} format={(v) => `${v}`} onChange={(v) => edit({ ampEnv: { ...st.ampEnv, attack: v } })} />
        <Stepper id={`p3-synth-${layer}-amp-decay`} label={`Synth layer ${layer} amp decay`} value={st.ampEnv.decay} min={0} max={10} format={(v) => (v >= 10 ? 'Sustain' : `${v}`)} onChange={(v) => edit({ ampEnv: { ...st.ampEnv, decay: v } })} />
        <Stepper id={`p3-synth-${layer}-amp-sustain`} label={`Synth layer ${layer} amp sustain level`} value={st.ampSustain} min={0} max={10} format={(v) => `${v}`} onChange={(v) => edit({ ampSustain: v })} />
        <Stepper id={`p3-synth-${layer}-amp-release`} label={`Synth layer ${layer} amp release`} value={st.ampEnv.release} min={0} max={10} format={(v) => `${v}`} onChange={(v) => edit({ ampEnv: { ...st.ampEnv, release: v } })} />
        <Stepper id={`p3-synth-${layer}-amp-vel`} label={`Synth layer ${layer} amp velocity`} value={st.ampVel} min={0} max={3} format={(v) => (v === 0 ? 'Off' : `${v}`)} onChange={(v) => edit({ ampVel: v })} />
        <Stepper id={`p3-synth-${layer}-filter-attack`} label={`Synth layer ${layer} filter attack`} value={st.filterEnv.attack} min={0} max={10} format={(v) => `${v}`} onChange={(v) => edit({ filterEnv: { ...st.filterEnv, attack: v } })} />
        <Stepper id={`p3-synth-${layer}-filter-decay`} label={`Synth layer ${layer} filter decay`} value={st.filterEnv.decay} min={0} max={10} format={(v) => `${v}`} onChange={(v) => edit({ filterEnv: { ...st.filterEnv, decay: v } })} />
        <Stepper id={`p3-synth-${layer}-filter-release`} label={`Synth layer ${layer} filter release`} value={st.filterEnv.release} min={0} max={10} format={(v) => `${v}`} onChange={(v) => edit({ filterEnv: { ...st.filterEnv, release: v } })} />
        <Toggle id={`p3-synth-${layer}-filter-vel`} label={`Synth layer ${layer} filter velocity`} on={st.filterVel} onFlip={() => edit({ filterVel: !st.filterVel })} />
        <Stepper id={`p3-synth-${layer}-osc-attack`} label={`Synth layer ${layer} osc attack`} value={st.oscEnv.attack} min={0} max={10} format={(v) => `${v}`} onChange={(v) => edit({ oscEnv: { ...st.oscEnv, attack: v } })} />
        <Stepper id={`p3-synth-${layer}-osc-decay`} label={`Synth layer ${layer} osc decay`} value={st.oscEnv.decay} min={0} max={10} format={(v) => `${v}`} onChange={(v) => edit({ oscEnv: { ...st.oscEnv, decay: v } })} />
        <Stepper id={`p3-synth-${layer}-osc-release`} label={`Synth layer ${layer} osc release`} value={st.oscEnv.release} min={0} max={10} format={(v) => `${v}`} onChange={(v) => edit({ oscEnv: { ...st.oscEnv, release: v } })} />
        <Toggle id={`p3-synth-${layer}-osc-vel`} label={`Synth layer ${layer} osc velocity`} on={st.oscVel} onFlip={() => edit({ oscVel: !st.oscVel })} />
        <Toggle id={`p3-synth-${layer}-env-to-pitch`} label={`Synth layer ${layer} env to pitch`} on={st.envToPitch} onFlip={() => edit({ envToPitch: !st.envToPitch })} />
        <Stepper id={`p3-synth-${layer}-osc-envamt`} label={`Synth layer ${layer} osc envelope amount`} value={st.oscEnvAmt + 5} min={0} max={10} format={() => `${st.oscEnvAmt >= 0 ? '+' : ''}${st.oscEnvAmt}`} onChange={(v) => edit({ oscEnvAmt: v - 5 })} />
      </Row>
      <Row label={`Synth layer ${layer} LFO`}>
        <Stepper id={`p3-synth-${layer}-lfo-wave`} label={`Synth layer ${layer} LFO wave`} value={LFO_WAVES.indexOf(st.lfoWave)} min={0} max={4} format={(v) => LFO_WAVES[v]} onChange={(v) => edit({ lfoWave: LFO_WAVES[v] })} />
        <Stepper id={`p3-synth-${layer}-lfo-dest`} label={`Synth layer ${layer} LFO destination`} value={st.lfoDest === null ? 0 : LFO_DESTS.indexOf(st.lfoDest) + 1} min={0} max={3} format={(v) => (v === 0 ? 'Off' : LFO_DESTS[v - 1])} onChange={(v) => edit({ lfoDest: v === 0 ? null : LFO_DESTS[v - 1] })} />
        <Stepper id={`p3-synth-${layer}-lfo-rate`} label={`Synth layer ${layer} LFO rate`} value={st.lfoRate} min={0} max={10} format={(v) => `${v}`} onChange={(v) => { edit({ lfoRate: v }); morphTarget(`synth.${layer}.lfoRate`, v); }} />
        <Stepper id={`p3-synth-${layer}-lfo-amt`} label={`Synth layer ${layer} LFO amount`} value={st.lfoAmt} min={0} max={10} format={(v) => `${v}`} onChange={(v) => { edit({ lfoAmt: v }); morphTarget(`synth.${layer}.lfoAmt`, v); }} />
        <Toggle id={`p3-synth-${layer}-lfo-sync`} label={`Synth layer ${layer} LFO clock sync`} on={st.lfoSync} onFlip={() => edit({ lfoSync: !st.lfoSync })} />
      </Row>
      <Row label={`Synth layer ${layer} voice`}>
        <Stepper id={`p3-synth-${layer}-voice-mode`} label={`Synth layer ${layer} voice mode`} value={['Poly', 'Mono', 'Legato'].indexOf(st.voice.mode)} min={0} max={2} format={(v) => ['Poly', 'Mono', 'Legato'][v]} onChange={(v) => edit({ voice: { ...st.voice, mode: (['Poly', 'Mono', 'Legato'] as const)[v] } })} />
        <Stepper id={`p3-synth-${layer}-priority`} label={`Synth layer ${layer} note priority`} value={['Off', 'Low', 'High'].indexOf(st.voice.priority)} min={0} max={2} format={(v) => ['Off', 'Low', 'High'][v]} onChange={(v) => edit({ voice: { ...st.voice, priority: (['Off', 'Low', 'High'] as const)[v] } })} />
        <Stepper id={`p3-synth-${layer}-glide`} label={`Synth layer ${layer} glide`} value={st.voice.glide} min={0} max={10} format={(v) => `${v}`} onChange={(v) => edit({ voice: { ...st.voice, glide: v } })} />
        <Stepper id={`p3-synth-${layer}-unison`} label={`Synth layer ${layer} unison`} value={st.voice.unison} min={0} max={3} format={(v) => (v === 0 ? 'Off' : `${v}`)} onChange={(v) => edit({ voice: { ...st.voice, unison: v } })} />
        <Stepper id={`p3-synth-${layer}-vibrato`} label={`Synth layer ${layer} vibrato`} value={['Off', 'On', 'Wheel'].indexOf(st.voice.vibrato)} min={0} max={2} format={(v) => ['Off', 'On', 'Wheel'][v]} onChange={(v) => edit({ voice: { ...st.voice, vibrato: (['Off', 'On', 'Wheel'] as const)[v] } })} />
        <Stepper id={`p3-synth-${layer}-vib-rate`} label={`Synth layer ${layer} vibrato rate`} value={Math.round((st.voice.vibRate - 2) * (10 / 6))} min={0} max={10} format={() => `${st.voice.vibRate.toFixed(1)} Hz`} onChange={(v) => edit({ voice: { ...st.voice, vibRate: 2 + (v / 10) * 6 } })} />
        <Stepper id={`p3-synth-${layer}-vib-amt`} label={`Synth layer ${layer} vibrato amount`} value={st.voice.vibAmount} min={0} max={10} format={(v) => `${v}`} onChange={(v) => edit({ voice: { ...st.voice, vibAmount: v } })} />
      </Row>
      <Row label={`Synth layer ${layer} arpeggiator`}>
        <Stepper id={`p3-synth-${layer}-arp-mode`} label={`Synth layer ${layer} arp mode`} value={['Off', 'Arp', 'Poly', 'Gate'].indexOf(st.arp.mode)} min={0} max={3} format={(v) => ['Off', 'Arp', 'Poly', 'Gate'][v]} onChange={(v) => edit({ arp: { ...st.arp, mode: (['Off', 'Arp', 'Poly', 'Gate'] as const)[v] } })} />
        <Toggle id={`p3-synth-${layer}-arp-run`} label={`Synth layer ${layer} arp run`} on={st.arp.run} onFlip={() => edit({ arp: { ...st.arp, run: !st.arp.run } })} />
        <Stepper id={`p3-synth-${layer}-arp-rate`} label={`Synth layer ${layer} arp rate`} value={st.arp.rate} min={0} max={10} format={(v) => `${v}`} onChange={(v) => { edit({ arp: { ...st.arp, rate: v } }); morphTarget(`synth.${layer}.arpRate`, v); }} />
        <Toggle id={`p3-synth-${layer}-arp-sync`} label={`Synth layer ${layer} arp clock sync`} on={st.arp.sync} onFlip={() => edit({ arp: { ...st.arp, sync: !st.arp.sync } })} />
        <Stepper id={`p3-synth-${layer}-arp-range`} label={`Synth layer ${layer} arp range`} value={st.arp.range} min={1} max={4} format={(v) => `${v} oct`} onChange={(v) => edit({ arp: { ...st.arp, range: v } })} />
        <Stepper id={`p3-synth-${layer}-arp-dir`} label={`Synth layer ${layer} arp direction`} value={['Up', 'Down', 'Up/Down', 'Random'].indexOf(st.arp.direction)} min={0} max={3} format={(v) => ['Up', 'Down', 'Up/Down', 'Random'][v]} onChange={(v) => edit({ arp: { ...st.arp, direction: (['Up', 'Down', 'Up/Down', 'Random'] as const)[v] } })} />
        <Toggle id={`p3-synth-${layer}-arp-hold`} label={`Synth layer ${layer} arp hold`} on={st.arp.hold} onFlip={() => edit({ arp: { ...st.arp, hold: !st.arp.hold } })} />
      </Row>
      <Row label={`Synth layer ${layer} pedal routing`}>
        <Toggle id={`p3-synth-${layer}-sustped`} label={`Synth layer ${layer} sustain pedal enable`} on={st.sustPed} onFlip={() => edit({ sustPed: !st.sustPed })} />
        <Toggle id={`p3-synth-${layer}-pstick`} label={`Synth layer ${layer} pitch stick enable`} on={st.pStick} onFlip={() => edit({ pStick: !st.pStick })} />
      </Row>
    </div>
  );
}

function SynthChainEditor({ layer }: { layer: SynthLayerId }) {
  const fx = useInstrument();
  const chain = fx.snapshot.program.synth.chains[fx.snapshot.program.synth.group ? 'A' : layer];
  const update = (patch: (c: ChainState) => ChainState) => {
    fx.edit((p) => {
      if (p.synth.group) return { ...p, synth: { ...p.synth, chains: { ...p.synth.chains, A: patch(p.synth.chains.A) } } };
      return { ...p, synth: { ...p.synth, chains: { ...p.synth.chains, [layer]: patch(p.synth.chains[layer]) } } };
    });
  };
  return (
    <div className="p2-chain" data-testid={`p3-synth-chain-${layer}`} role="group" aria-label={`Synth ${layer} effects chain`}>
      <Row label={`Synth ${layer} chain Mod 1`}>
        <Toggle id={`p3-synth-${layer}-fx-mod1-on`} label={`Synth ${layer} chain Mod 1 on`} on={chain.mod1.on} onFlip={() => update((c) => ({ ...c, mod1: { ...c.mod1, on: !c.mod1.on } }))} />
        <Stepper id={`p3-synth-${layer}-fx-mod1-type`} label={`Synth ${layer} chain Mod 1 type`} value={chain.mod1.type === 'off' ? 0 : MOD1_TYPES.indexOf(chain.mod1.type) + 1} min={0} max={MOD1_TYPES.length} format={(v) => (v === 0 ? 'Off' : MOD1_TYPES[v - 1])} onChange={(v) => update((c) => ({ ...c, mod1: { ...c.mod1, type: v === 0 ? 'off' : MOD1_TYPES[v - 1] } }))} />
        <Stepper id={`p3-synth-${layer}-fx-mod1-rate`} label={`Synth ${layer} chain Mod 1 rate`} value={chain.mod1.rate} min={0} max={10} format={(v) => `${v}`} onChange={(v) => update((c) => ({ ...c, mod1: { ...c.mod1, rate: v } }))} />
        <Stepper id={`p3-synth-${layer}-fx-mod1-amount`} label={`Synth ${layer} chain Mod 1 amount`} value={chain.mod1.amount} min={0} max={10} format={(v) => `${v}`} onChange={(v) => update((c) => ({ ...c, mod1: { ...c.mod1, amount: v } }))} />
        <Toggle id={`p3-synth-${layer}-fx-mod1-sync`} label={`Synth ${layer} chain Mod 1 clock sync`} on={chain.mod1.sync} onFlip={() => update((c) => ({ ...c, mod1: { ...c.mod1, sync: !c.mod1.sync } }))} />
      </Row>
      <Row label={`Synth ${layer} chain Mod 2`}>
        <Toggle id={`p3-synth-${layer}-fx-mod2-on`} label={`Synth ${layer} chain Mod 2 on`} on={chain.mod2.on} onFlip={() => update((c) => ({ ...c, mod2: { ...c.mod2, on: !c.mod2.on } }))} />
        <Stepper id={`p3-synth-${layer}-fx-mod2-type`} label={`Synth ${layer} chain Mod 2 type`} value={chain.mod2.type === 'off' ? 0 : MOD2_TYPES.indexOf(chain.mod2.type) + 1} min={0} max={MOD2_TYPES.length} format={(v) => (v === 0 ? 'Off' : MOD2_TYPES[v - 1])} onChange={(v) => update((c) => ({ ...c, mod2: { ...c.mod2, type: v === 0 ? 'off' : MOD2_TYPES[v - 1] } }))} />
        <Stepper id={`p3-synth-${layer}-fx-mod2-amount`} label={`Synth ${layer} chain Mod 2 amount`} value={chain.mod2.amount} min={0} max={10} format={(v) => `${v}`} onChange={(v) => update((c) => ({ ...c, mod2: { ...c.mod2, amount: v } }))} />
      </Row>
      <Row label={`Synth ${layer} chain Delay`}>
        <Toggle id={`p3-synth-${layer}-fx-delay-on`} label={`Synth ${layer} chain Delay on`} on={chain.delay.on} onFlip={() => update((c) => ({ ...c, delay: { ...c.delay, on: !c.delay.on } }))} />
        <Stepper id={`p3-synth-${layer}-fx-delay-time`} label={`Synth ${layer} chain Delay time`} value={Math.round((chain.delay.timeMs - 20) / 148)} min={0} max={10} format={() => `${chain.delay.timeMs}ms`} onChange={(v) => update((c) => ({ ...c, delay: { ...c.delay, timeMs: 20 + v * 148 } }))} />
        <Stepper id={`p3-synth-${layer}-fx-delay-fb`} label={`Synth ${layer} chain Delay feedback`} value={chain.delay.feedback} min={0} max={10} format={(v) => `${v}`} onChange={(v) => update((c) => ({ ...c, delay: { ...c.delay, feedback: v } }))} />
        <Stepper id={`p3-synth-${layer}-fx-delay-wet`} label={`Synth ${layer} chain Delay dry wet`} value={chain.delay.wet} min={0} max={10} format={(v) => `${v}`} onChange={(v) => update((c) => ({ ...c, delay: { ...c.delay, wet: v } }))} />
        <Toggle id={`p3-synth-${layer}-fx-delay-sync`} label={`Synth ${layer} chain Delay clock sync`} on={chain.delay.sync} onFlip={() => update((c) => ({ ...c, delay: { ...c.delay, sync: !c.delay.sync } }))} />
        <Toggle id={`p3-synth-${layer}-fx-delay-global`} label={`Synth ${layer} chain Delay global`} on={chain.delay.global} onFlip={() => update((c) => ({ ...c, delay: { ...c.delay, global: !c.delay.global } }))} />
        <Toggle id={`p3-synth-${layer}-fx-torotary`} label={`Synth ${layer} chain To Rotary`} on={chain.rotaryOn} onFlip={() => update((c) => ({ ...c, rotaryOn: !c.rotaryOn, ampEq: { ...c.ampEq, type: !c.rotaryOn ? 'to-rotary' : c.ampEq.type === 'to-rotary' ? 'eq' : c.ampEq.type } }))} />
      </Row>
      <Row label={`Synth ${layer} chain Amp EQ`}>
        <Toggle id={`p3-synth-${layer}-fx-amp-on`} label={`Synth ${layer} chain Amp on`} on={chain.ampEq.on} onFlip={() => update((c) => ({ ...c, ampEq: { ...c.ampEq, on: !c.ampEq.on } }))} />
        <Stepper id={`p3-synth-${layer}-fx-amp-type`} label={`Synth ${layer} chain Amp type`} value={AMP_TYPES.indexOf(chain.ampEq.type)} min={0} max={AMP_TYPES.length - 1} format={(v) => AMP_TYPES[v]} onChange={(v) => update((c) => ({ ...c, ampEq: { ...c.ampEq, type: AMP_TYPES[v] } }))} />
        <Stepper id={`p3-synth-${layer}-fx-amp-drive`} label={`Synth ${layer} chain Amp drive`} value={chain.ampEq.drive} min={0} max={10} format={(v) => `${v}`} onChange={(v) => update((c) => ({ ...c, ampEq: { ...c.ampEq, drive: v } }))} />
      </Row>
      <Row label={`Synth ${layer} chain Compressor`}>
        <Toggle id={`p3-synth-${layer}-fx-comp-on`} label={`Synth ${layer} chain Compressor on`} on={chain.comp.on} onFlip={() => update((c) => ({ ...c, comp: { ...c.comp, on: !c.comp.on } }))} />
        <Stepper id={`p3-synth-${layer}-fx-comp-amount`} label={`Synth ${layer} chain Compressor amount`} value={chain.comp.amount} min={0} max={10} format={(v) => `${v}`} onChange={(v) => update((c) => ({ ...c, comp: { ...c.comp, amount: v } }))} />
        <Toggle id={`p3-synth-${layer}-fx-comp-global`} label={`Synth ${layer} chain Compressor global`} on={chain.comp.global} onFlip={() => update((c) => ({ ...c, comp: { ...c.comp, global: !c.comp.global } }))} />
      </Row>
      <Row label={`Synth ${layer} chain Reverb`}>
        <Toggle id={`p3-synth-${layer}-fx-reverb-on`} label={`Synth ${layer} chain Reverb on`} on={chain.reverb.on} onFlip={() => update((c) => ({ ...c, reverb: { ...c.reverb, on: !c.reverb.on } }))} />
        <Stepper id={`p3-synth-${layer}-fx-reverb-type`} label={`Synth ${layer} chain Reverb type`} value={REVERB_TYPES.indexOf(chain.reverb.type)} min={0} max={REVERB_TYPES.length - 1} format={(v) => REVERB_TYPES[v]} onChange={(v) => update((c) => ({ ...c, reverb: { ...c.reverb, type: REVERB_TYPES[v] } }))} />
        <Stepper id={`p3-synth-${layer}-fx-reverb-wet`} label={`Synth ${layer} chain Reverb dry wet`} value={chain.reverb.wet} min={0} max={10} format={(v) => `${v}`} onChange={(v) => update((c) => ({ ...c, reverb: { ...c.reverb, wet: v } }))} />
        <Toggle id={`p3-synth-${layer}-fx-reverb-global`} label={`Synth ${layer} chain Reverb global`} on={chain.reverb.global} onFlip={() => update((c) => ({ ...c, reverb: { ...c.reverb, global: !c.reverb.global } }))} />
      </Row>
    </div>
  );
}

export function SynthPanel() {
  const fx = useInstrument();
  const synth = fx.snapshot.program.synth;
  return (
    <div className="p2-panel" data-testid="p3-synth-panel" role="group" aria-label="Synth layers, functional">
      <div className="p2-panelhead" aria-hidden="true">
        SYNTH · LAYERS A/B/C · OWN CHAINS
      </div>
      <Row label="Synth section">
        <Toggle id="p3-synth-section-on" label="Synth section on" on={synth.sectionOn} onFlip={() => fx.edit((p) => ({ ...p, synth: { ...p.synth, sectionOn: !p.synth.sectionOn } }))} />
        <Toggle id="p3-synth-group" label="Synth effect group" on={synth.group} onFlip={() => fx.edit((p) => ({ ...p, synth: { ...p.synth, group: !p.synth.group, chains: !p.synth.group ? { ...p.synth.chains, B: p.synth.chains.A, C: p.synth.chains.A } : p.synth.chains } }))} />
      </Row>
      <SynthLayerBlock layer="A" />
      <SynthLayerBlock layer="B" />
      <SynthLayerBlock layer="C" />
      <SynthChainEditor layer="A" />
      <SynthChainEditor layer="B" />
      <SynthChainEditor layer="C" />
    </div>
  );
}

// --- Unsupported notes ---------------------------------------------------------

export function UnsupportedNotes() {
  const fx = useInstrument();
  void fx;
  return (
    <div className="p2-panel" data-testid="p3-unsupported" role="group" aria-label="Unsupported controls">
      <div className="p2-panelhead" aria-hidden="true">
        UNSUPPORTED · SPEC-EXCLUDED
      </div>
      {UNSUPPORTED_CONTROLS.map((u) => (
        <div key={u.id} className="p2-programline" data-testid={`p3-unsupported-${u.id}`} aria-label={`${u.label}: ${u.reason}`}>
          {`${u.label} — ${u.reason}`}
        </div>
      ))}
      <div className="p2-programline" data-testid="p3-morph-targets" aria-label="Morph destination catalog">
        {`Morph destinations: ${Object.values(MORPH_TARGET_INFO).map((t) => t.label).join(', ')}`}
      </div>
    </div>
  );
}
