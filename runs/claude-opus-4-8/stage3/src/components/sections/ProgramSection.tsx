import { useState } from 'react';
import type { ControlApi } from '../../hooks/useControls';
import type { ProgramManager } from '../../state/programManager';
import type { PerformanceStore } from '../../state/performanceStore';
import { useProgramTick, usePerformanceState } from '../../hooks/usePerformance';
import { ControlView } from '../controls/ControlView';
import { Group } from '../Group';
import { SPLIT_POSITIONS, type CrossfadeWidth } from '../../state/program';

interface ProgramSectionProps {
  ctl: ControlApi;
  program: ProgramManager;
  perfStore: PerformanceStore;
  onPanic: () => void;
}

/**
 * Program & Morph section — now FUNCTIONAL. Drives the ProgramManager (32 slots
 * + 8 Live slots, dirty/E state, Store/Store As, Live Mode, numeric list view)
 * and the PerformanceStore (splits, scenes, morph assign, transpose, panic).
 */
export function ProgramSection({ ctl, program, perfStore, onPanic }: ProgramSectionProps) {
  useProgramTick(program);
  const perf = usePerformanceState(perfStore);
  const [showList, setShowList] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);

  const programButtons = Array.from({ length: 8 }, (_, i) => i);
  const loc = program.location();
  const label = program.displayLabel();
  const name = program.currentName();
  const dirty = program.isDirty();
  const armed = program.isStoreArmed();

  const list = program.isLiveMode() ? program.liveList() : program.programList();

  return (
    <section className="deck-section program central" aria-label="Program and morph">
      <Group title="MORPH ASSIGN" className="morph-assign">
        <MorphButton id="program-morph-wheel" label="WHEEL" ctl={ctl} perfStore={perfStore} source="wheel" active={perf.morph.wheel.length > 0} />
        {/* Aftertouch morph is spec-excluded: browsers have no aftertouch — decorative. */}
        <ControlView id="program-morph-at" ctl={ctl} buttonVariant="square" />
        <MorphButton id="program-morph-ctrlped" label="CTRL PED" ctl={ctl} perfStore={perfStore} source="ctrlPedal" active={perf.morph.ctrlPedal.length > 0} />
      </Group>

      <div className="program-mid">
        <div className="program-store-col">
          <button
            type="button"
            className={`panel-btn pill ${armed ? 'armed' : ''}`}
            aria-label={armed ? 'Store: confirm destination' : 'Store'}
            data-control-id="program-store"
            aria-pressed={armed}
            onClick={() => program.store()}
          >
            <span className="btn-led amber" /> STORE
          </button>
          <button
            type="button"
            className="panel-btn pill"
            aria-label="Store as"
            data-control-id="program-store-as"
            onClick={() => setNaming(name)}
          >
            STORE AS
          </button>
          <div
            className="ctl ctl-encoder"
            data-control-id="program-dial"
            role="spinbutton"
            tabIndex={0}
            aria-label="Program dial"
            aria-valuetext={`${label} ${name}`}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
                e.preventDefault();
                program.step(1);
              } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
                e.preventDefault();
                program.step(-1);
              }
            }}
          >
            <div className="encoder" aria-hidden="true">
              <button type="button" className="encoder-nub up" aria-label="Program up" onClick={() => program.step(1)} />
              <button type="button" className="encoder-nub down" aria-label="Program down" onClick={() => program.step(-1)} />
            </div>
            <span className="ctl-caption">PROGRAM</span>
          </div>
        </div>
        <div className="oled program-oled" data-oled="program" role="img" aria-label={`Program display: ${label} ${name}${dirty ? ' edited' : ''}`}>
          <div className="oled-line big">
            {label}
            {dirty ? <span className="dirty-e" aria-label="edited"> E</span> : null}
            {armed ? <span className="dirty-e" aria-label="storing"> STORE?</span> : null}
          </div>
          <div className="oled-line big">{name}</div>
          <div className="oled-line small">{program.isLiveMode() ? 'LIVE MODE' : `PAGE ${program.page() + 1}`}</div>
          {showList ? (
            <ul className="oled-list" aria-label="Program list">
              {list.map((p) => (
                <li key={p.label}>
                  <button type="button" className="oled-list-item" onClick={() => program.select(program.isLiveMode() ? { bank: 'live', index: Number(p.label.slice(1)) - 1 } : { bank: 'program', index: listIndex(p.label) })}>
                    {p.label} {p.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      <div className="program-nav">
        <button type="button" className="panel-btn square" aria-label="Page left" data-control-id="program-page-left" onClick={() => program.pageStep(-1)}>
          ◀
        </button>
        <button type="button" className="panel-btn square" aria-label="Page right" data-control-id="program-page-right" onClick={() => program.pageStep(1)}>
          ▶
        </button>
        <button
          type="button"
          className={`panel-btn grey ${program.isLiveMode() ? 'on' : ''}`}
          aria-label="Live mode"
          aria-pressed={program.isLiveMode()}
          data-control-id="program-live-mode"
          onClick={() => program.setLiveMode(!program.isLiveMode())}
        >
          <span className="btn-led green" /> LIVE
        </button>
        <button
          type="button"
          className={`panel-btn square ${showList ? 'on' : ''}`}
          aria-label="Program list view"
          aria-pressed={showList}
          data-control-id="program-list"
          onClick={() => setShowList((s) => !s)}
        >
          LIST
        </button>
        {/* Num Pad mode is spec-excluded (programs spec) — stays decorative. */}
        <ControlView id="program-num-pad" ctl={ctl} buttonVariant="square" />
      </div>

      <div className="program-scene-row">
        <button
          type="button"
          className={`panel-btn ${perf.scene === 'II' ? 'on' : ''}`}
          aria-label={`Layer scene: ${perf.scene}`}
          data-control-id="program-layer-scene"
          onClick={() => perfStore.toggleScene()}
        >
          SCENE {perf.scene}
        </button>
        <SplitControl perfStore={perfStore} perf={perf} />
        <TransposeControl perfStore={perfStore} transpose={perf.transpose} />
        <button
          type="button"
          className="panel-btn square"
          aria-label="Panic"
          data-control-id="program-panic"
          onClick={onPanic}
        >
          PANIC
        </button>
      </div>

      <Group title="PROGRAM" className="program-buttons">
        {programButtons.map((i) => {
          const active = !program.isLiveMode() && loc.bank === 'program' && loc.index % 8 === i;
          const activeLive = program.isLiveMode() && loc.bank === 'live' && loc.index === i;
          return (
            <button
              key={i}
              type="button"
              className={`panel-btn square program-slot ${active || activeLive ? 'on' : ''}`}
              aria-label={`Program button ${i + 1}`}
              aria-pressed={active || activeLive}
              data-control-id={`program-button-${i + 1}`}
              onClick={() => program.pressButton(i)}
            >
              {i + 1}
            </button>
          );
        })}
      </Group>

      {naming !== null ? (
        <NamingDialog
          initial={naming}
          onCommit={(n) => {
            program.storeAs(n);
            setNaming(null);
          }}
          onCancel={() => setNaming(null)}
        />
      ) : null}
    </section>
  );
}

function listIndex(label: string): number {
  const [page, button] = label.split('.').map(Number);
  return (page - 1) * 8 + (button - 1);
}

function MorphButton({
  id,
  label,
  ctl,
  perfStore,
  source,
  active,
}: {
  id: string;
  label: string;
  ctl: ControlApi;
  perfStore: PerformanceStore;
  source: 'wheel' | 'ctrlPedal';
  active: boolean;
}) {
  return (
    <div className="morph-btn-wrap">
      <button
        type="button"
        className={`panel-btn square ${active ? 'on' : ''}`}
        aria-label={`Morph assign ${label}${active ? ' (assigned)' : ''}`}
        aria-pressed={ctl.get(id) === true}
        data-control-id={id}
        onClick={() => ctl.toggle(id)}
      >
        <span className="btn-led green" />
        {label}
      </button>
      {active ? (
        <button
          type="button"
          className="morph-clear"
          aria-label={`Clear ${label} morph`}
          onClick={() => perfStore.clearMorphSource(source)}
        >
          CLR
        </button>
      ) : null}
    </div>
  );
}

function SplitControl({ perfStore, perf }: { perfStore: PerformanceStore; perf: ReturnType<PerformanceStore['getState']> }) {
  const [edit, setEdit] = useState(false);
  return (
    <div className="split-control">
      <button
        type="button"
        className={`panel-btn square ${perf.split.on ? 'on' : ''}`}
        aria-label={`Split ${perf.split.on ? 'on' : 'off'}`}
        aria-pressed={perf.split.on}
        data-control-id="program-split"
        onClick={() => perfStore.setSplitOn(!perf.split.on)}
        onContextMenu={(e) => {
          e.preventDefault();
          setEdit((v) => !v);
        }}
      >
        <span className="btn-led amber" /> SPLIT
      </button>
      {edit ? (
        <div className="split-edit" role="group" aria-label="Split editing">
          {(['low', 'mid', 'high'] as const).map((which) => (
            <div key={which} className="split-row">
              <span className="split-label">{which}</span>
              <select
                aria-label={`Split ${which} position`}
                value={perf.split.points[which] ?? -1}
                onChange={(e) => perfStore.setSplitPoint(which, Number(e.target.value) < 0 ? null : Number(e.target.value))}
              >
                <option value={-1}>Off</option>
                {SPLIT_POSITIONS.map((pos, i) => (
                  <option key={pos} value={i}>
                    {pos}
                  </option>
                ))}
              </select>
              <select
                aria-label={`Split ${which} crossfade`}
                value={perf.split.crossfades[which]}
                onChange={(e) => perfStore.setCrossfade(which, Number(e.target.value) as CrossfadeWidth)}
              >
                <option value={0}>Off</option>
                <option value={6}>±6</option>
                <option value={12}>±12</option>
              </select>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TransposeControl({ perfStore, transpose }: { perfStore: PerformanceStore; transpose: number }) {
  return (
    <div
      className="ctl ctl-transpose"
      role="slider"
      tabIndex={0}
      aria-label="Transpose"
      aria-valuemin={-6}
      aria-valuemax={6}
      aria-valuenow={transpose}
      aria-valuetext={`${transpose > 0 ? '+' : ''}${transpose} semitones`}
      data-control-id="program-transpose"
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
          e.preventDefault();
          perfStore.setTranspose(transpose + 1);
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
          e.preventDefault();
          perfStore.setTranspose(transpose - 1);
        }
      }}
    >
      <button type="button" className="transpose-nub" aria-label="Transpose down" onClick={() => perfStore.setTranspose(transpose - 1)}>
        −
      </button>
      <span className="transpose-value">
        {transpose > 0 ? '+' : ''}
        {transpose}
      </span>
      <button type="button" className="transpose-nub" aria-label="Transpose up" onClick={() => perfStore.setTranspose(transpose + 1)}>
        +
      </button>
    </div>
  );
}

function NamingDialog({ initial, onCommit, onCancel }: { initial: string; onCommit: (n: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="naming-dialog" role="dialog" aria-label="Store as: name program">
      <label>
        Name
        <input
          type="text"
          value={value}
          autoFocus
          aria-label="Program name"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommit(value);
            else if (e.key === 'Escape') onCancel();
          }}
        />
      </label>
      <div className="naming-actions">
        <button type="button" onClick={() => onCommit(value)}>
          Store
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
