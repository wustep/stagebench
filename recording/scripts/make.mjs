/**
 * Build a show end to end: record every model (serially: audio passes are real-time), prep, compose.
 *
 *   node scripts/make.mjs --show shows/<name>.json            # everything
 *   node scripts/make.mjs --show shows/<name>.json --plan     # print the timeline only (no browser)
 *   node scripts/make.mjs --show shows/<name>.json --models a,b   # re-record just these, then compose
 *   node scripts/make.mjs --show shows/<name>.json --compose  # prep + compose from existing takes
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { loadShow, argv, REC } from './lib/show.mjs';

const showArg = argv('show');
if (!showArg) { console.error('usage: node scripts/make.mjs --show shows/<name>.json [--plan|--compose|--models a,b]'); process.exit(1); }
const S = loadShow(showArg);
const P = S.plan;

console.log(`${S.name}: ${S.song.title}, ${S.models.length} models, ${P.duration.toFixed(1)} s`);
for (const s of P.segments) {
  const m = S.model(s.model);
  console.log(`  ${(s.from - P.t0).toFixed(2).padStart(6)}–${(s.to - P.t0).toFixed(2).padStart(6)}  ${s.secs.toFixed(2).padStart(5)} s  bars ${s.bars.join('–').padEnd(8)} #${String(m.rank).padEnd(3)} ${m.label}`);
}
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
const toRecord = process.argv.includes('--compose') ? [] : (only || S.models.map((m) => m.id));
for (const id of toRecord) node('record.mjs', '--model', id);
for (const m of S.models) node('prep.mjs', '--model', m.id);
node('compose.mjs');
