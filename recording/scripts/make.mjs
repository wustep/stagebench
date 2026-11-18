/**
 * Build a show end to end: record every model (serially: audio passes are real-time), prep, compose.
 *
 *   node scripts/make.mjs --show shows/<name>.json            # everything
 *   node scripts/make.mjs --show shows/<name>.json --plan     # print the timeline only (no browser)
 *   node scripts/make.mjs --show shows/<name>.json --models a,b   # re-record just these, then compose
 *   node scripts/make.mjs --show shows/<name>.json --compose  # prep + compose from existing takes
 *
 * Placeholder slots (models that can't be filmed yet, see lib/show.mjs) are never recorded; compose
 * fills their bars with a label card. Once a placeholder's run and preview are in place it becomes
 * filmable: record just it with --models <id>, and the compose that follows drops it in.
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { loadShow, argv, REC } from './lib/show.mjs';

const showArg = argv('show');
if (!showArg) { console.error('usage: node scripts/make.mjs --show shows/<name>.json [--plan|--compose|--models a,b]'); process.exit(1); }
const S = loadShow(showArg);
const P = S.plan;

console.log(`${S.name}: ${S.song.title}, ${S.models.length} models, ${P.duration.toFixed(1)} s`);
const xf = S.show.endCard?.secs ? Math.round((S.show.endCard.crossfade || 0) * 30) / 30 : 0;
if (S.show.intro?.secs) console.log(`  intro ${S.show.intro.secs.toFixed(2)} s${P.lead ? `, the first model's idle + pickup (${P.lead.toFixed(2)} s) under its end` : ''}`);
for (const s of P.segments) {
  const m = S.model(s.model);
  const rank = m.rank ? `#${m.rank}` : 'NEW';
  const last = s === P.segments.at(-1);
  console.log(`  ${(s.from - P.t0).toFixed(2).padStart(6)}–${(s.to - P.t0).toFixed(2).padStart(6)}  ${(s.secs - (last ? xf : 0)).toFixed(2).padStart(5)} s  bars ${s.bars.join('–').padEnd(8)} ${rank.padEnd(4)} ${m.label}${last && xf ? `  (+ ${xf.toFixed(2)} s dissolve into the end card)` : ''}${m.placeholder ? `  [placeholder: ${m.placeholder}]` : ''}`);
}
if (S.show.endCard?.secs) console.log(`  end card ${S.show.endCard.secs.toFixed(2)} s${P.audioEnd > P.end ? `, ring-out ${(P.audioEnd - P.end).toFixed(2)} s under it` : ''}`);
if (process.argv.includes('--plan')) process.exit(0);

// record.mjs exits 2 when the page crashed; retry those (renderer crashes can be intermittent).
const node = (script, ...args) => {
  for (let attempt = 1; ; attempt++) {
    const r = spawnSync(process.execPath, [path.join(REC, 'scripts', script), '--show', showArg, ...args], { stdio: 'inherit', cwd: REC });
    if (r.status === 0) return;
    if (r.status === 2 && attempt < 3) { console.error(`${script} ${args.join(' ')}: page crashed, retrying (${attempt}/2)`); continue; }
    console.error(`${script} ${args.join(' ')} failed (${r.status})`);
    process.exit(r.status || 1);
  }
};
const only = argv('models')?.split(',');
for (const id of only || []) {
  const m = S.model(id);
  if (!m) { console.error(`${id} is not in ${S.name}`); process.exit(1); }
  if (m.placeholder) { console.error(`${id} is still a placeholder (${m.placeholder}); see README 'Demo v2' for how to drop it in`); process.exit(1); }
}
const toRecord = process.argv.includes('--compose') ? [] : (only || S.filmable.map((m) => m.id));
for (const id of toRecord) node('record.mjs', '--model', id);
for (const m of S.filmable) node('prep.mjs', '--model', m.id);
node('compose.mjs');
