export const FRIENDLY_SQUAD_DEFINITIONS = Object.freeze({
  assault: Object.freeze({
    type: 'assault', name: '突撃部隊', shortLabel: 'ASLT', role: '万能型', unlockLevel: 0,
    members: 6, hp: 180, speed: 1.25, enemyDps: 9, baseDps: 7, engagementRange: 18,
    allowedBaseKinds: Object.freeze(['MAJOR', 'FIELD']),
    cost: Object.freeze({ wood: 44, stone: 18, fiber: 32 }),
    description: '通常敵と敵基地の両方へ対応できる基本部隊です。'
  }),
  skirmisher: Object.freeze({
    type: 'skirmisher', name: '遊撃部隊', shortLabel: 'SKRM', role: '軽装迎撃', unlockLevel: 1,
    members: 5, hp: 125, speed: 1.65, enemyDps: 8, baseDps: 2.5, engagementRange: 21,
    allowedBaseKinds: Object.freeze(['MAJOR', 'FIELD']),
    targetPriorityTypes: Object.freeze(['raider', 'scout', 'archer', 'ropeCutter', 'oreCarrier', 'ironCarrier', 'pathfinder', 'marauder', 'flankRider', 'warDrummer', 'squadHunter', 'pursuitCavalry', 'mobileLancer', 'roadHunter']),
    lightTargetMultiplier: 1.7, armoredTargetMultiplier: 0.55,
    cost: Object.freeze({ wood: 36, fiber: 42, timber: 4, rope: 2 }),
    description: '高速で軽装敵を処理しますが、重装敵と敵基地には弱い部隊です。'
  }),
  siege: Object.freeze({
    type: 'siege', name: '攻城部隊', shortLabel: 'SIEG', role: '基地破壊', unlockLevel: 2,
    members: 4, hp: 150, speed: 0.72, enemyDps: 4, baseDps: 22, engagementRange: 16,
    allowedBaseKinds: Object.freeze(['MAJOR']),
    cost: Object.freeze({ timber: 8, rope: 4, cutStone: 8, charcoal: 6 }),
    description: '敵基地へ非常に高い損害を与えますが、単独では道中の敵に弱いため連携出撃で護衛が必要です。'
  }),
  heavy: Object.freeze({
    type: 'heavy', name: '重装部隊', shortLabel: 'HVY', role: '味方防護', unlockLevel: 3,
    members: 6, hp: 360, speed: 0.70, enemyDps: 8, baseDps: 4.5, engagementRange: 18,
    allowedBaseKinds: Object.freeze(['MAJOR']), guardRange: 24, guardShare: 0.45,
    cost: Object.freeze({ timber: 10, rope: 3, cutStone: 10, bronzeIngot: 8 }),
    description: '近くの味方部隊が受ける損害の一部を肩代わりする護衛部隊です。'
  }),
  expedition: Object.freeze({
    type: 'expedition', name: '遠征部隊', shortLabel: 'EXPD', role: '長距離作戦', unlockLevel: 4,
    members: 7, hp: 290, speed: 1.15, enemyDps: 14, baseDps: 12, engagementRange: 20,
    allowedBaseKinds: Object.freeze(['MAJOR']), nonCombatRecoveryPerSecond: 1.4, recoveryDelaySeconds: 10,
    cost: Object.freeze({ timber: 14, rope: 5, bronzeIngot: 4, wroughtIron: 10 }),
    description: '高い総合戦闘力を持ち、戦闘から離れると少量ずつ自己回復します。さらに現在位置の周囲120mを移動式の建設圏として利用できます。'
  }),
  engineer: Object.freeze({
    type: 'engineer', name: '工兵部隊', shortLabel: 'ENGR', role: '破城・現地修復', unlockLevel: 5,
    members: 5, hp: 310, speed: 0.95, enemyDps: 11, baseDps: 18, engagementRange: 18,
    allowedBaseKinds: Object.freeze(['MAJOR']), repairRange: 42, repairAmount: 120,
    cost: Object.freeze({ timber: 14, rope: 6, cutStone: 12, steel: 8 }),
    description: '敵施設への攻撃と前線設備の手動修復を担当します。修復には対象設備に応じた資源が必要です。'
  }),
  artillery: Object.freeze({
    type: 'artillery', name: '砲撃部隊', shortLabel: 'ARTY', role: '遠距離範囲攻撃', unlockLevel: 6,
    members: 4, hp: 220, speed: 0.62, enemyDps: 20, baseDps: 15, engagementRange: 42,
    allowedBaseKinds: Object.freeze(['MAJOR']), splashRadius: 18, splashMultiplier: 0.55, maxSplashTargets: 5,
    cost: Object.freeze({ timber: 18, cutStone: 16, steel: 12, mechanism: 6 }),
    description: '密集した敵を遠距離から攻撃します。移動速度と耐久が低いため、重装部隊などの護衛が必要です。'
  }),
  command: Object.freeze({
    type: 'command', name: '指揮部隊', shortLabel: 'CMD', role: '部隊連携支援', unlockLevel: 7,
    members: 6, hp: 380, speed: 1.0, enemyDps: 13, baseDps: 10, engagementRange: 22,
    allowedBaseKinds: Object.freeze(['MAJOR']), commandAura: 0.20, speedAura: 0.08, auraRange: 45, maxPerBase: 1,
    cost: Object.freeze({ timber: 20, steel: 16, mechanism: 10 }),
    description: '周囲の味方部隊の攻撃力と移動速度を高める統合作戦部隊です。主要拠点ごとに同時運用できるのは1隊です。'
  }),
  retrieval: Object.freeze({
    type: 'retrieval', name: '回収部隊', shortLabel: 'RECV', role: '遠隔回収', unlockLevel: 0,
    missionKind: 'RECOVERY', members: 3, hp: 55, speed: 1.05, enemyDps: 1.2, baseDps: 0, engagementRange: 12,
    allowedBaseKinds: Object.freeze(['MAJOR', 'FIELD']), collectionSeconds: 8, nonCombatUnit: true,
    cost: Object.freeze({ wood: 18, fiber: 20 }),
    description: '特殊アイテムを遠隔回収できますが、戦闘力と耐久は非常に低い部隊です。'
  })
});

export const FRIENDLY_SQUAD_TYPES = Object.freeze(Object.keys(FRIENDLY_SQUAD_DEFINITIONS));

export const FRIENDLY_EQUIPMENT_SCALING = Object.freeze([
  Object.freeze({ hp: 1, damage: 1, speed: 1 }),
  Object.freeze({ hp: 1, damage: 1, speed: 1 }),
  Object.freeze({ hp: 1, damage: 1, speed: 1 }),
  Object.freeze({ hp: 1, damage: 1, speed: 1 }),
  Object.freeze({ hp: 1, damage: 1, speed: 1 }),
  Object.freeze({ hp: 1.15, damage: 1.12, speed: 1 }),
  Object.freeze({ hp: 1.28, damage: 1.25, speed: 1.03 }),
  Object.freeze({ hp: 1.42, damage: 1.38, speed: 1.05 })
]);

const LIGHT_ENEMY_TYPES = new Set(['scout', 'raider', 'archer', 'ropeCutter', 'oreCarrier', 'ironCarrier', 'pathfinder', 'marauder', 'flankRider', 'warDrummer', 'squadHunter', 'pursuitCavalry', 'mobileLancer', 'roadHunter']);
const ARMORED_ENEMY_TYPES = new Set(['shield', 'heavy', 'siegeBreaker', 'sapper', 'bronzeShield', 'siegeCaptain', 'ironclad', 'heavySiege', 'commander', 'ironSaboteur', 'bodyguard', 'steelGuard', 'demolitionEngineer', 'steelCaptain', 'mechanicalSiege', 'armoredAgent', 'machineCommander', 'royalGuard', 'fortressBreaker', 'royalCommander']);

export function friendlySquadDefinition(type) {
  return FRIENDLY_SQUAD_DEFINITIONS[type] ?? FRIENDLY_SQUAD_DEFINITIONS.assault;
}

export function friendlyEquipmentScaling(level) {
  const index = Math.max(0, Math.min(FRIENDLY_EQUIPMENT_SCALING.length - 1, Math.floor(Number(level) || 0)));
  return FRIENDLY_EQUIPMENT_SCALING[index];
}

export function friendlySquadRuntimeDefinition(state, type) {
  const base = friendlySquadDefinition(type);
  const scaling = friendlyEquipmentScaling(state?.civilization?.level ?? 0);
  const retrieval = base.nonCombatUnit;
  const hpMultiplier = retrieval ? 1 + (scaling.hp - 1) * 0.75 : scaling.hp;
  const damageMultiplier = retrieval ? 1 : scaling.damage;
  return {
    ...base,
    hp: Math.round(base.hp * hpMultiplier),
    speed: base.speed * scaling.speed,
    enemyDps: base.enemyDps * damageMultiplier,
    baseDps: base.baseDps * damageMultiplier
  };
}

export function friendlySquadUnlocked(state, type) {
  const definition = FRIENDLY_SQUAD_DEFINITIONS[type];
  return Boolean(definition && (state.civilization?.level ?? 0) >= definition.unlockLevel);
}

export function friendlySquadEnemyDamage(definition, enemyType) {
  let multiplier = 1;
  if (LIGHT_ENEMY_TYPES.has(enemyType)) multiplier *= definition.lightTargetMultiplier ?? 1;
  if (ARMORED_ENEMY_TYPES.has(enemyType)) multiplier *= definition.armoredTargetMultiplier ?? 1;
  return definition.enemyDps * multiplier;
}
