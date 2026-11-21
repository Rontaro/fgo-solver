// Build-time data generation: fetches Atlas Academy exports and writes
// compact JSON to public/data/{NA,JP}/. Reuses src/data/compact.ts via
// Node 24's built-in type stripping (no flag, no tsx).
import { writeFile, mkdir, stat } from 'node:fs/promises';
import { compactServant, compactCE, compactMC } from '../src/data/compact.ts';

const BASE = 'https://api.atlasacademy.io';
const REGIONS = ['NA', 'JP'];
const HEADERS = { 'User-Agent': 'fgo-solver-build' };
const QUEST_TYPES = new Set(['free', 'event']);
const SERVANT_LIMIT = 4 * 1024 * 1024;

// Sequential by construction: every call is awaited before the next one.
async function get(path) {
  const res = await fetch(BASE + path, { headers: HEADERS });
  if (res.status !== 200) throw new Error(`GET ${path} -> HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

// The class attack-rate export also carries numeric class-id keys ("98",
// "1006", ...) that duplicate/alias internal classes. CompactServant.className
// is always a name, so numeric keys are unreachable: drop them (at every level).
const isNumericKey = (k) => /^\d+$/.test(k);
function namedKeys(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (isNumericKey(k)) continue;
    out[k] = v !== null && typeof v === 'object' ? namedKeys(v) : v;
  }
  return out;
}

function questIndex(wars) {
  const out = [];
  for (const war of wars) {
    const quests = [];
    for (const spot of war.spots ?? []) {
      for (const q of spot.quests ?? []) {
        if (!QUEST_TYPES.has(q.type)) continue;
        quests.push({
          id: q.id, name: q.name, type: q.type, phases: q.phases,
          openedAt: q.openedAt, closedAt: q.closedAt,
        });
      }
    }
    if (quests.length === 0) continue; // wars with only main/story quests are useless here
    out.push({
      warId: war.id,
      warName: (war.longName || war.name).replace(/\s*\n\s*/g, ' '),
      eventId: war.eventId,
      quests,
    });
  }
  return out;
}

function topUnsupported(servants, n) {
  const counts = new Map();
  for (const s of servants) for (const u of new Set(s.unsupported)) counts.set(u, (counts.get(u) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, n);
}

const fmt = (bytes) => (bytes / 1024 / 1024).toFixed(2) + ' MB';

async function buildRegion(region) {
  const dir = `public/data/${region}`;
  await mkdir(dir, { recursive: true });
  const written = [];
  const write = async (name, data) => {
    const file = `${dir}/${name}`;
    await writeFile(file, JSON.stringify(data));
    written.push([name, (await stat(file)).size]);
  };

  console.log(`[${region}] info`);
  const info = (await get('/info'))[region];
  if (!info) throw new Error(`/info has no entry for ${region}`);
  await write('version.json', { hash: info.hash, timestamp: info.timestamp });

  console.log(`[${region}] servants`);
  const servants = (await get(`/export/${region}/nice_servant.json`))
    .filter((s) => (s.type === 'normal' || s.type === 'heroine') && s.collectionNo > 0)
    .map(compactServant);
  await write('servants.json', servants);

  console.log(`[${region}] craft essences`);
  const ces = (await get(`/export/${region}/nice_equip.json`))
    .filter((e) => e.type === 'servantEquip')
    .map(compactCE);
  await write('ces.json', ces);

  console.log(`[${region}] mystic codes`);
  const mcs = (await get(`/export/${region}/nice_mystic_code.json`)).map(compactMC);
  await write('mcs.json', mcs);

  console.log(`[${region}] constants`);
  const classAtk = namedKeys(await get(`/export/${region}/NiceClassAttackRate.json`));
  const classRel = namedKeys(await get(`/export/${region}/NiceClassRelation.json`));
  const attrRel = namedKeys(await get(`/export/${region}/NiceAttributeRelation.json`));
  await write('constants.json', { classAtk, classRel, attrRel });

  console.log(`[${region}] quests`);
  const quests = questIndex(await get(`/export/${region}/nice_war.json`));
  await write('quests.json', quests);

  const unsupported = servants
    .filter((s) => s.unsupported.length > 0)
    .map((s) => ({ collectionNo: s.collectionNo, name: s.name, unsupported: s.unsupported }));
  await write('unsupported-report.json', unsupported);

  return {
    region, written, servants: servants.length, ces: ces.length, mcs: mcs.length,
    questCount: quests.reduce((n, w) => n + w.quests.length, 0), wars: quests.length,
    unsupportedCount: unsupported.length, top: topUnsupported(servants, 15),
  };
}

const results = [];
for (const region of REGIONS) results.push(await buildRegion(region));

let oversize = false;
for (const r of results) {
  console.log(`\n== ${r.region} ==`);
  for (const [name, size] of r.written) {
    const flag = name === 'servants.json' && size > SERVANT_LIMIT ? '  (over 4 MB target)' : '';
    if (flag) oversize = true;
    console.log(`  ${name.padEnd(24)} ${fmt(size).padStart(10)}${flag}`);
  }
  console.log(`  servants ${r.servants}, CEs ${r.ces}, MCs ${r.mcs}, wars ${r.wars}, quests ${r.questCount}`);
  console.log(`  servants with non-empty unsupported: ${r.unsupportedCount}/${r.servants}`);
  console.log('  top unsupported types (servant count):');
  for (const [type, n] of r.top) console.log(`    ${String(n).padStart(4)}  ${type}`);
}
if (oversize) console.warn('\nWARNING: servants.json exceeds the 4 MB target in at least one region.');
