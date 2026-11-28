/**
 * Buff traits of the statuses our skills and NPs can put on enemies that some
 * buffs check (Atlas upDamageIndividuality ckOpIndv: "damage up vs [Burned]
 * enemies"): burn, poison, curse, charm, skill seal, immobilize, confusion,
 * terror, bound, death resist down. An enemy-targeted status carrying one of
 * them is recorded on the enemy (Enemy.status, EffectKind enemyStatus), and a
 * buff's opTraits match the enemy's traits or its status (Chaldea: the
 * opponent's traits plus its buff traits).
 */
export const STATUS_TRAITS: ReadonlySet<number> = new Set([3011, 3012, 3015, 3025, 3026, 3039, 3045, 3049, 3052, 3087]);
