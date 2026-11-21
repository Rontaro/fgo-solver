// Maps our NA servant/CE collectionNo to FGA support image names
// (app/src/main/assets/Support/{servant,ce} in Fate-Grand-Automata/FGA, MIT).
// Servants are folder names, CEs are file names (with .png, as FGA stores them in prefs).
// Run: node scripts/fga-support-names.mjs  -> src/fga/support-names.json
import { readFile, writeFile } from 'node:fs/promises';

const TREE = 'https://api.github.com/repos/Fate-Grand-Automata/FGA/git/trees/master?recursive=1';
const ROOT = 'app/src/main/assets/Support/';

// FGA name -> our NA collectionNo, where normalizing is not enough (or is ambiguous).
// Only confident pairs; FGA names with no NA counterpart are left unmatched.
const OVERRIDES = {
  servant: {
    'Artoria (Caster)': 284, 'Chloe (Avenger)': 388, Douman: 297, Jalter: 106, Koyanskaya: 314,
    'Koyanskaya of the Darkness (Foreigner)': 334, Mash: 1, 'Nero (Bride)': 90, Skadi: 215,
    'Skadi (Ruler)': 357, Tamamo: 62, Waver: 37,
  },
  ce: { 'Black Grail.png': 48, 'Golden Sumo.png': 261 },
};

const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/artoria/g, 'altria').replace(/\.png$/, '').replace(/[^a-z0-9]+/g, ' ').trim();

const res = await fetch(TREE, { headers: { 'User-Agent': 'fgo-solver-script' } });
if (!res.ok) throw new Error(`tree: ${res.status}`);
const { tree, truncated } = await res.json();
if (truncated) console.warn('warning: tree truncated');
const servantNames = new Set(), ceNames = new Set();
for (const { path, type } of tree) {
  if (!path.startsWith(ROOT)) continue;
  const parts = path.slice(ROOT.length).split('/');
  if (parts[0] === 'servant' && parts.length === 2 && type === 'tree') servantNames.add(parts[1]);
  if (parts[0] === 'ce' && parts.length === 2 && type === 'blob' && parts[1].endsWith('.png')) ceNames.add(parts[1]);
}

const load = async (f) => JSON.parse(await readFile(new URL(`../public/data/NA/${f}`, import.meta.url), 'utf8'));
const [servants, ces] = await Promise.all([load('servants.json'), load('ces.json')]);

function match(fgaNames, ours, overrides, kind) {
  const byNorm = new Map();
  for (const o of ours) {
    const k = norm(o.name);
    byNorm.set(k, [...(byNorm.get(k) ?? []), o]);
  }
  const out = {}, unmatched = [];
  for (const f of [...fgaNames].sort()) {
    const o = overrides[f];
    const hits = o !== undefined ? ours.filter((x) => x.collectionNo === o) : byNorm.get(norm(f)) ?? [];
    if (hits.length === 1) out[hits[0].collectionNo] = f;
    else unmatched.push(hits.length ? `${f} (ambiguous: ${hits.map((h) => h.collectionNo).join(',')})` : f);
  }
  console.log(`${kind}: ${Object.keys(out).length}/${fgaNames.size} matched`);
  if (unmatched.length) console.log(`  unmatched: ${unmatched.slice(0, 20).join(' | ')}`);
  return out;
}

const json = {
  servants: match(servantNames, servants, OVERRIDES.servant, 'servants'),
  ces: match(ceNames, ces, OVERRIDES.ce, 'ces'),
};
await writeFile(new URL('../src/fga/support-names.json', import.meta.url), JSON.stringify(json, null, 2) + '\n');
