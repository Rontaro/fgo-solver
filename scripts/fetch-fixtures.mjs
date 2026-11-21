import { writeFile, mkdir } from 'node:fs/promises';
const BASE = 'https://api.atlasacademy.io';
const files = {
  'castoria.json': '/nice/NA/servant/284?lore=false',
  'altria.json': '/nice/NA/servant/2?lore=false',
  'siegfried.json': '/nice/NA/servant/6?lore=false', // damageNpIndividual (vs Dragon 2002)
  'vritra.json': '/nice/NA/servant/300?lore=false',
  'ibuki.json': '/nice/NA/servant/299?lore=false', // damageNpPierce + addDamage passive
  'skadi.json': '/nice/NA/servant/215?lore=false',
  'kaleidoscope.json': '/nice/NA/equip/34',
  'mc-combat.json': '/nice/NA/MC/20',
  'quest-prison-ruins.json': '/nice/NA/quest/93030214/3',
  'class-attack-rate.json': '/export/NA/NiceClassAttackRate.json',
  'class-relation.json': '/export/NA/NiceClassRelation.json',
  'attribute-relation.json': '/export/NA/NiceAttributeRelation.json',
  'card.json': '/export/NA/NiceCard.json',
};
await mkdir('test/fixtures', { recursive: true });
for (const [name, path] of Object.entries(files)) {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(path + ' -> HTTP ' + res.status);
  await writeFile('test/fixtures/' + name, await res.text());
  console.log('ok', name);
}
