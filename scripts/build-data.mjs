// Build-time data generation: fetches Atlas Academy exports and writes
// compact JSON to public/data/{NA,JP}/. Reuses src/data/compact.ts via
// Node 24's built-in type stripping (no flag, no tsx).
import { writeFile, readFile, mkdir, stat } from 'node:fs/promises';
import { compactServant, compactCE, compactMC, triggerSkillIds, partUnsupported } from '../src/data/compact.ts';
import { buildClassConstants, classGaps } from '../src/data/constants.ts';

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

// --- Skills run by trigger buffs (attackAfterFunction, delayFunction, ...) ---
// The exports only carry the triggered skill's id, so each one is fetched once
// from /nice/{region}/skill/{id}, sequentially, and cached on disk keyed by the
// Atlas data hash: reruns on the same data version make no skill requests.
// The cache is committed (data-cache/), so a CI / Cloudflare build makes none
// either while the Atlas data has not changed; after a game update, run
// `npm run data` locally and commit the refreshed files.
const CACHE_DIR = 'data-cache';
const TRIGGER_DEPTH = 2; // same limit as compact.ts: a trigger inside a triggered skill

function* functionsOf(entities) {
  for (const e of entities) {
    for (const k of ['skills', 'classPassive', 'noblePhantasms']) {
      for (const s of e[k] ?? []) yield* s.functions ?? [];
    }
  }
}

async function triggerLookup(region, hash, entities) {
  const file = `${CACHE_DIR}/trigger-skills-${region}.json`;
  let cache = {};
  try {
    const c = JSON.parse(await readFile(file, 'utf8'));
    if (c.hash === hash) cache = c.skills;
  } catch { /* no cache yet */ }
  const lookup = new Map();
  let fetched = 0, missing = 0;
  let ids = new Set();
  for (const f of functionsOf(entities)) for (const id of triggerSkillIds(f)) ids.add(id);
  for (let depth = 0; depth < TRIGGER_DEPTH && ids.size; depth++) {
    const next = new Set();
    for (const id of ids) {
      if (lookup.has(id)) continue;
      let skill = cache[id];
      if (skill === undefined) {
        const res = await fetch(`${BASE}/nice/${region}/skill/${id}`, { headers: HEADERS });
        if (res.status === 404) skill = null; // unknown id: compact.ts reports trigger:...:missing
        else if (res.status !== 200) throw new Error(`GET skill ${id} -> HTTP ${res.status}`);
        else { const s = await res.json(); skill = { id: s.id, functions: s.functions }; }
        cache[id] = skill;
        fetched++;
      }
      if (skill === null) { missing++; continue; }
      lookup.set(id, skill);
      for (const f of skill.functions) for (const x of triggerSkillIds(f)) if (!lookup.has(x)) next.add(x);
    }
    ids = next;
  }
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, JSON.stringify({ hash, skills: cache }));
  console.log(`[${region}] trigger skills: ${lookup.size} resolved, ${fetched} fetched, ${missing} missing`);
  return lookup;
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
          ...(spot.name && { spot: spot.name }),
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

/*
 * Drop audit: every skill / NP / passive / CE where a helpful effect is NOT
 * modelled (Rate < 1000, random pick, unevaluable condition, a trigger whose
 * skill only helps, an untracked buffRate...). Those drops are safe (we only
 * miss a combo) but silent: the report makes them visible. Sorted by "impact":
 * rarity first (5 and 4 stars as a popularity proxy), then the number of drops.
 */
function dropEntry(kind, x, parts) {
  return { kind, collectionNo: x.collectionNo, name: x.name, rarity: x.rarity ?? 0, parts };
}
const byImpact = (a, b) => b.rarity - a.rarity
  || b.parts.reduce((n, p) => n + p.drops.length, 0) - a.parts.reduce((n, p) => n + p.drops.length, 0)
  || b.collectionNo - a.collectionNo;

/** Usable servants in the data set currently on disk (the previous build), or null. */
async function previousUsable(dir) {
  try {
    const old = JSON.parse(await readFile(`${dir}/servants.json`, 'utf8'));
    return { usable: old.filter((s) => s.unsupported.length === 0).length, total: old.length };
  } catch { return null; }
}

async function buildRegion(region) {
  const dir = `public/data/${region}`;
  await mkdir(dir, { recursive: true });
  const before = await previousUsable(dir);
  const written = [];
  const write = async (name, data) => {
    const file = `${dir}/${name}`;
    await writeFile(file, JSON.stringify(data));
    written.push([name, (await stat(file)).size]);
  };

  console.log(`[${region}] info`);
  const info = (await get('/info'))[region];
  if (!info) throw new Error(`/info has no entry for ${region}`);

  console.log(`[${region}] servants, craft essences, mystic codes`);
  const rawServants = (await get(`/export/${region}/nice_servant.json`))
    .filter((s) => (s.type === 'normal' || s.type === 'heroine') && s.collectionNo > 0);
  const rawCes = (await get(`/export/${region}/nice_equip.json`)).filter((e) => e.type === 'servantEquip');
  const rawMcs = await get(`/export/${region}/nice_mystic_code.json`);
  const triggers = await triggerLookup(region, info.hash, [...rawServants, ...rawCes, ...rawMcs]);

  const dropped = [];
  const servants = rawServants.map((s) => {
    const parts = [];
    const c = compactServant(s, triggers, parts);
    if (parts.length) dropped.push(dropEntry('servant', c, parts));
    return c;
  });
  await write('servants.json', servants);
  const ces = rawCes.map((e) => {
    const parts = [];
    const c = compactCE(e, triggers, parts);
    if (parts.length) dropped.push(dropEntry('ce', { ...c, rarity: e.rarity }, parts));
    return c;
  });
  await write('ces.json', ces);
  const mcs = rawMcs.map((m) => compactMC(m, triggers));
  await write('mcs.json', mcs);

  console.log(`[${region}] constants`);
  // classAtk from NiceClass.attackRate; missing classRel pairs filled through
  // relationId (see src/data/constants.ts).
  const classInfo = await get(`/export/${region}/NiceClass.json`);
  const { classAtk, classRel, filled } = buildClassConstants(
    classInfo,
    await get(`/export/${region}/NiceClassAttackRate.json`),
    await get(`/export/${region}/NiceClassRelation.json`),
  );
  const attrRel = namedKeys(await get(`/export/${region}/NiceAttributeRelation.json`));
  await write('constants.json', { classAtk, classRel, attrRel });
  // Every servant class must resolve as attacker against every named class an
  // enemy can have (NiceClass lists them all; per-quest enemy fetches would
  // cost one request per quest, so the full class list is used instead).
  // Ids 1000-1006 (OTHER, ALL, EXTRA, MIX, EXTRA1, EXTRA2, 1006) are class
  // group selectors used in conditions, not classes a unit can have.
  const isGroup = (c) => c.id >= 1000 && c.id <= 1006;
  const defenders = classInfo.filter((c) => !isGroup(c)).map((c) => c.className).filter((n) => !/^\d+$/.test(n));
  const classGapList = classGaps({ classAtk, classRel }, servants.map((s) => s.className), defenders);
  console.log(`[${region}] class constants: ${Object.keys(classAtk).length} classes, ${filled} relation pairs filled, ${classGapList.length} gaps`);

  console.log(`[${region}] quests`);
  const quests = questIndex(await get(`/export/${region}/nice_war.json`));
  await write('quests.json', quests);

  // Servant-level reasons (not usable at all), and the part-level marks of the usable ones.
  const unsupported = servants
    .filter((s) => s.unsupported.length > 0)
    .map((s) => ({ collectionNo: s.collectionNo, name: s.name, unsupported: s.unsupported }));
  await write('unsupported-report.json', unsupported);
  const partMarks = servants.filter((s) => s.unsupported.length === 0).flatMap((s) => {
    const p = partUnsupported(s);
    return p.skills.length || p.lastTurnOnly.length || p.np ? [{ collectionNo: s.collectionNo, name: s.name, ...p }] : [];
  });
  await write('part-unsupported-report.json', partMarks);
  dropped.sort(byImpact);
  await write('dropped-report.json', dropped);

  // Written last: clients key their cache on hash + build, so a page loaded while
  // the files above are being regenerated never caches a half-old data set.
  await write('version.json', { hash: info.hash, timestamp: info.timestamp, build: new Date().toISOString() });

  return {
    region, written, servants: servants.length, ces: ces.length, mcs: mcs.length,
    questCount: quests.reduce((n, w) => n + w.quests.length, 0), wars: quests.length,
    unsupportedCount: unsupported.length, top: topUnsupported(servants, 15),
    before, partMarks: partMarks.length, dropped,
    cesUnsupported: ces.filter((c) => c.unsupported.length).length,
    classGaps: classGapList,
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
  console.log(`  usable servants: ${r.servants - r.unsupportedCount}/${r.servants}` +
    (r.before ? ` (previous build: ${r.before.usable}/${r.before.total})` : ''));
  console.log(`  usable servants with part-level marks (a skill / the NP unusable or last-turn only): ${r.partMarks}`);
  console.log(`  CEs with non-empty unsupported: ${r.cesUnsupported}/${r.ces}`);
  const line = (d) => `    ${d.rarity}* #${d.collectionNo} ${d.name}: ${d.parts.map((p) => `${p.part} ${p.drops.join(',')}`).join('; ')}`;
  console.log(`  dropped helpful effects: ${r.dropped.length} entries (dropped-report.json); top 20 servants by rarity:`);
  for (const d of r.dropped.filter((x) => x.kind === 'servant').slice(0, 20)) console.log(line(d));
  console.log('  top 10 CEs:');
  for (const d of r.dropped.filter((x) => x.kind === 'ce').slice(0, 10)) console.log(line(d));
  console.log(`  class constant gaps: ${r.classGaps.length}${r.classGaps.length ? ' e.g. ' + r.classGaps.slice(0, 8).join(', ') : ''}`);
  console.log('  top unsupported types (servant count):');
  for (const [type, n] of r.top) console.log(`    ${String(n).padStart(4)}  ${type}`);
}
if (oversize) console.warn('\nWARNING: servants.json exceeds the 4 MB target in at least one region.');
