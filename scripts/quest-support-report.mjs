// Quest support report: how many NA quests questFromAtlas accepts, and why the
// rest are rejected. Samples every free quest plus EVENT_SAMPLE event quests
// (newest wars first), last phase of each. Fetches /nice/NA/quest/{id}/{phase}
// one request at a time, cached on disk (node_modules/.cache/fgo-solver/quests/).
// Imports src/engine/quest.ts through Node 24's built-in type stripping.
//
//   node scripts/quest-support-report.mjs [--events N] [--top N] [--verbose]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { questFromAtlas, UnsupportedQuestError } from '../src/engine/quest.ts';

const BASE = 'https://api.atlasacademy.io';
const HEADERS = { 'User-Agent': 'fgo-solver-report' };
const CACHE_DIR = 'node_modules/.cache/fgo-solver/quests';
const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
};
const EVENT_SAMPLE = arg('--events', 100);
const TOP = arg('--top', 25);
const VERBOSE = process.argv.includes('--verbose');

async function quest(id, phase) {
  const file = `${CACHE_DIR}/NA-${id}-${phase}.json`;
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { /* not cached */ }
  const res = await fetch(`${BASE}/nice/NA/quest/${id}/${phase}`, { headers: HEADERS });
  if (res.status !== 200) throw new Error(`GET quest ${id}/${phase} -> HTTP ${res.status}`);
  const q = await res.json();
  await writeFile(file, JSON.stringify(q));
  return q;
}

/** Reason without wave number and enemy / skill names, for grouping. */
function normalize(r) {
  if (/reinforcements/.test(r)) return r.replace(/^wave \d+: /, '').replace(/\(.*\)/, '').trim();
  const p = / (passive|skill)(?: [^:]*)?: (.*)$/.exec(r);
  if (p) return `${p[1]}: ${p[2]}`;
  return r.replace(/^wave \d+: /, '').replace(/\(.*\)/, '').trim();
}

const wars = JSON.parse(await readFile('public/data/NA/quests.json', 'utf8'));
const free = [], events = [];
const newest = (w) => Math.max(...w.quests.map((q) => q.openedAt));
for (const w of [...wars].sort((a, b) => newest(b) - newest(a))) {
  for (const q of w.quests) {
    if (!q.phases.length) continue;
    const item = { id: q.id, phase: q.phases[q.phases.length - 1], name: q.name, war: w.warName, type: q.type };
    if (q.type === 'free') free.push(item);
    else if (q.type === 'event' && events.length < EVENT_SAMPLE) events.push(item);
  }
}

await mkdir(CACHE_DIR, { recursive: true });
const byType = new Map();
const reasons = new Map();
let done = 0, failed = 0;
const all = [...free, ...events];
for (const item of all) {
  let raw;
  try { raw = await quest(item.id, item.phase); } catch (e) { failed++; console.error(`  ${item.id}: ${e.message}`); continue; }
  const t = byType.get(item.type) ?? { total: 0, ok: 0 };
  byType.set(item.type, t);
  t.total++;
  try {
    questFromAtlas(raw);
    t.ok++;
  } catch (e) {
    if (!(e instanceof UnsupportedQuestError)) throw e;
    for (const r of new Set(e.reasons.map(normalize))) {
      const c = reasons.get(r) ?? { n: 0, free: 0, example: item };
      c.n++;
      if (item.type === 'free') c.free++;
      reasons.set(r, c);
    }
    if (VERBOSE) console.log(`  x ${item.type} ${item.id} ${item.name} (${item.war}): ${e.reasons.join('; ')}`);
  }
  if (++done % 50 === 0) process.stderr.write(`  ${done}/${all.length}\n`);
}

const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) : '0.0') + '%';
let total = 0, ok = 0;
console.log('\nSupported quests (NA, last phase)');
for (const [type, t] of byType) {
  total += t.total; ok += t.ok;
  console.log(`  ${type.padEnd(6)} ${String(t.ok).padStart(4)} / ${String(t.total).padEnd(4)} ${pct(t.ok, t.total)}`);
}
console.log(`  ${'all'.padEnd(6)} ${String(ok).padStart(4)} / ${String(total).padEnd(4)} ${pct(ok, total)}`);
if (failed) console.log(`  (${failed} quests could not be fetched)`);
console.log(`\nTop rejection reasons (quests affected: all / free)`);
for (const [r, c] of [...reasons].sort((a, b) => b[1].n - a[1].n).slice(0, TOP)) {
  console.log(`  ${String(c.n).padStart(4)} ${String(c.free).padStart(4)}  ${r}   e.g. ${c.example.id} ${c.example.name}`);
}
