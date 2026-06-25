export const ENEMY_PERSONALITIES = Object.freeze({
  direct: Object.freeze({
    key: 'direct', label: '直進型', routeMode: 'DIRECT',
    description: '最短経路と都市到達を優先する基本的な行動です。'
  }),
  evasive: Object.freeze({
    key: 'evasive', label: '警戒迂回型', routeMode: 'EVASIVE', avoidTowers: true, avoidCongestion: true,
    description: '防衛塔と混雑を避け、比較的安全な道路を選びます。'
  }),
  flanker: Object.freeze({
    key: 'flanker', label: '側面迂回型', routeMode: 'FLANK', avoidTowers: true, avoidCongestion: true,
    prefersDetour: true, flankPreference: 3.2, flankWidthMeters: 130,
    maxDetourRatio: 1.65, minimumLateralMeters: 32,
    description: '最短路から外れ、防衛線の側面へ回り込める道路を選びます。'
  }),
  breacher: Object.freeze({
    key: 'breacher', label: '正面突破型', routeMode: 'BREACH',
    description: '遠回りを避け、防壁を破壊して短い経路を押し通ります。'
  }),
  saboteur: Object.freeze({
    key: 'saboteur', label: '破壊工作型', routeMode: 'SABOTAGE', avoidTowers: true,
    description: '都市へ直行せず、支援施設や火力施設を優先して破壊します。'
  }),
  marauder: Object.freeze({
    key: 'marauder', label: '拠点襲撃型', routeMode: 'RAID', avoidCongestion: true,
    description: '都市より簡易拠点や前線支援施設を狙います。'
  }),
  hunter: Object.freeze({
    key: 'hunter', label: '部隊追跡型', routeMode: 'HUNT', avoidCongestion: true,
    description: '道路上の味方部隊を捕捉し、移動先を追跡します。'
  }),
  support: Object.freeze({
    key: 'support', label: '支援同行型', routeMode: 'SUPPORT',
    description: '周囲の敵部隊を強化しながら主力に同行します。'
  }),
  guardian: Object.freeze({
    key: 'guardian', label: '護衛型', routeMode: 'GUARD',
    description: '高い耐久と防護効果で周囲の敵を守ります。'
  }),
  commander: Object.freeze({
    key: 'commander', label: '指揮型', routeMode: 'COMMAND',
    description: '周囲の部隊を加速し、攻撃部隊全体の圧力を高めます。'
  })
});

export const ENEMY_WAVE_DOCTRINES = Object.freeze({
  frontal: Object.freeze({ key: 'frontal', label: '正面攻撃', preferredPersonalities: ['direct', 'guardian', 'breacher'] }),
  flank: Object.freeze({ key: 'flank', label: '側面攻撃', preferredPersonalities: ['flanker', 'evasive'] }),
  raid: Object.freeze({ key: 'raid', label: '拠点襲撃', preferredPersonalities: ['marauder', 'saboteur'] }),
  breach: Object.freeze({ key: 'breach', label: '攻城突破', preferredPersonalities: ['breacher', 'commander'] }),
  support: Object.freeze({ key: 'support', label: '統制進軍', preferredPersonalities: ['support', 'commander', 'guardian'] }),
  hunt: Object.freeze({ key: 'hunt', label: '部隊狩り', preferredPersonalities: ['hunter', 'flanker'] }),
  guard: Object.freeze({ key: 'guard', label: '拠点守備', preferredPersonalities: ['guardian', 'direct', 'breacher'] })
});

export function enemyBehaviorForDefinition(definition = {}, doctrineKey = null) {
  const personalityKey = definition.personality ?? 'direct';
  const profile = ENEMY_PERSONALITIES[personalityKey] ?? ENEMY_PERSONALITIES.direct;
  const doctrine = doctrineKey ? waveDoctrineDefinition(doctrineKey) : null;
  const flankDoctrine = doctrine?.key === 'flank';
  return {
    ...profile,
    personalityKey: profile.key,
    personalityLabel: profile.label,
    doctrineKey: doctrine?.key ?? null,
    targetMode: doctrine?.key === 'raid' ? 'BASES' : doctrine?.key === 'hunt' ? 'SQUADS' : 'DEFAULT',
    avoidTowers: flankDoctrine || (definition.avoidTowers ?? profile.avoidTowers ?? false),
    avoidCongestion: flankDoctrine || (definition.avoidCongestion ?? profile.avoidCongestion ?? false),
    prefersDetour: flankDoctrine || (definition.prefersDetour ?? profile.prefersDetour ?? false),
    flankPreference: Math.max(Number(definition.flankPreference ?? profile.flankPreference ?? 0), flankDoctrine ? 3.2 : 0),
    flankWidthMeters: Math.max(Number(definition.flankWidthMeters ?? profile.flankWidthMeters ?? 120), flankDoctrine ? 130 : 0),
    maxDetourRatio: Math.max(Number(definition.maxDetourRatio ?? profile.maxDetourRatio ?? 1), flankDoctrine ? 1.6 : 1),
    minimumLateralMeters: Math.max(Number(definition.minimumLateralMeters ?? profile.minimumLateralMeters ?? 0), flankDoctrine ? 30 : 0),
    barrierCostMultiplier: doctrine?.key === 'breach' ? 0.42 : 1,
    routeMode: flankDoctrine ? 'FLANK' : doctrine?.key === 'breach' ? 'BREACH' : definition.routeMode ?? profile.routeMode ?? 'DIRECT',
    description: definition.personalityDescription ?? profile.description
  };
}

export function waveDoctrineDefinition(key) {
  return ENEMY_WAVE_DOCTRINES[key] ?? ENEMY_WAVE_DOCTRINES.frontal;
}
