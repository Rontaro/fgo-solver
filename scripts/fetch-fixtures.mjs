import { writeFile, mkdir } from 'node:fs/promises';
const BASE = 'https://api.atlasacademy.io';
const files = {
  'castoria.json': '/nice/NA/servant/284?lore=false',
  'altria.json': '/nice/NA/servant/2?lore=false',
  'siegfried.json': '/nice/NA/servant/6?lore=false', // damageNpIndividual (vs Dragon 2002)
  'vritra.json': '/nice/NA/servant/300?lore=false',
  'ibuki.json': '/nice/NA/servant/299?lore=false', // damageNpPierce + addDamage passive
  'skadi.json': '/nice/NA/servant/215?lore=false',
  'koyanskaya-light.json': '/nice/NA/servant/314?lore=false', // trigger buff -> skill 966533
  'super-orion.json': '/nice/NA/servant/272?lore=false', // trigger buff -> skill 964095
  'ereshkigal.json': '/nice/NA/servant/196?lore=false', // Ghost Room golden test
  // Skills run by trigger buffs (build-data resolves them the same way).
  'skill-966533.json': '/nice/NA/skill/966533',
  'skill-964095.json': '/nice/NA/skill/964095',
  'kaleidoscope.json': '/nice/NA/equip/34',
  'pioneering-oni.json': '/nice/NA/equip/2139', // field-conditioned event bonus (94000160)
  'mc-combat.json': '/nice/NA/MC/20',
  'quest-prison-ruins.json': '/nice/NA/quest/93030214/3',
  'quest-ghost-room.json': '/nice/NA/quest/94136713/1', // field trait 94000160, war 9175 (event 80494)
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
