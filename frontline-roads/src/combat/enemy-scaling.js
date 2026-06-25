const BASE_LEVEL_THRESHOLDS_SECONDS = Object.freeze([
  0, 20 * 60, 60 * 60, 120 * 60, 240 * 60, 420 * 60, 660 * 60, 960 * 60
]);

export const ENEMY_LEVEL_MULTIPLIERS = Object.freeze({
  1: Object.freeze({ hp: 1.00, attack: 1.00, speed: 1.00 }),
  2: Object.freeze({ hp: 1.15, attack: 1.10, speed: 1.02 }),
  3: Object.freeze({ hp: 1.35, attack: 1.22, speed: 1.04 }),
  4: Object.freeze({ hp: 1.60, attack: 1.38, speed: 1.07 }),
  5: Object.freeze({ hp: 1.90, attack: 1.58, speed: 1.10 }),
  6: Object.freeze({ hp: 2.20, attack: 1.78, speed: 1.12 }),
  7: Object.freeze({ hp: 2.55, attack: 2.00, speed: 1.14 }),
  8: Object.freeze({ hp: 2.95, attack: 2.25, speed: 1.16 })
});

export const ENEMY_DENSITY_BY_CIVILIZATION = Object.freeze({
  0: Object.freeze({ populationCap: 220, waveMultiplier: 1.00, intervalMultiplier: 1.00, departureSpacingSeconds: 8.0 }),
  1: Object.freeze({ populationCap: 320, waveMultiplier: 1.55, intervalMultiplier: 0.86, departureSpacingSeconds: 6.0 }),
  2: Object.freeze({ populationCap: 440, waveMultiplier: 2.25, intervalMultiplier: 0.70, departureSpacingSeconds: 4.5 }),
  3: Object.freeze({ populationCap: 580, waveMultiplier: 3.25, intervalMultiplier: 0.56, departureSpacingSeconds: 3.2 }),
  4: Object.freeze({ populationCap: 720, waveMultiplier: 4.50, intervalMultiplier: 0.44, departureSpacingSeconds: 2.4 }),
  5: Object.freeze({ populationCap: 800, waveMultiplier: 4.50, intervalMultiplier: 0.46, departureSpacingSeconds: 2.3 }),
  6: Object.freeze({ populationCap: 880, waveMultiplier: 5.35, intervalMultiplier: 0.39, departureSpacingSeconds: 2.0 }),
  7: Object.freeze({ populationCap: 960, waveMultiplier: 5.90, intervalMultiplier: 0.35, departureSpacingSeconds: 1.8 })
});

export const ENEMY_WAVE_INTERVAL_MULTIPLIERS = Object.freeze({
  1: 1.00, 2: 1.00, 3: 0.95, 4: 0.90, 5: 0.85, 6: 0.81, 7: 0.77, 8: 0.73
});

export function normalizeEnemyLevel(level) { return Math.max(1, Math.min(8, Math.floor(Number(level) || 1))); }

export function effectiveEnemyCivilizationLevel(state) {
  const level = Math.max(0, Math.min(7, Math.floor(Number(state?.civilization?.level) || 0)));
  const graceUntil = Number(state?.civilization?.gracePeriodUntil) || 0;
  const worldNow = Number(state?.runtime?.worldTimeMs) || Date.now();
  return graceUntil > worldNow ? Math.max(0, level - 1) : level;
}

export function maxEnemyBaseLevelForCivilization(level) {
  return Math.min(8, Math.max(0, Math.floor(Number(level) || 0)) + 2);
}

export function enemyBaseLevelForState(state, ageSeconds) {
  const age = Math.max(0, Number(ageSeconds) || 0);
  let naturalLevel = 1;
  for (let index = 1; index < BASE_LEVEL_THRESHOLDS_SECONDS.length; index += 1) {
    if (age >= BASE_LEVEL_THRESHOLDS_SECONDS[index]) naturalLevel = index + 1;
  }
  return Math.min(naturalLevel, maxEnemyBaseLevelForCivilization(effectiveEnemyCivilizationLevel(state)));
}

export function enemyLevelMultipliers(level) { return ENEMY_LEVEL_MULTIPLIERS[normalizeEnemyLevel(level)]; }

function rounded(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function scaleEnemyDefinition(definition, level = 1) {
  const normalizedLevel = normalizeEnemyLevel(level);
  const multipliers = enemyLevelMultipliers(normalizedLevel);
  return {
    ...definition,
    level: normalizedLevel,
    hp: Math.max(1, Math.round((definition.hp ?? 1) * multipliers.hp)),
    speed: rounded((definition.speed ?? 1) * multipliers.speed, 3),
    cityDamage: Math.max(1, Math.round((definition.cityDamage ?? 1) * multipliers.attack)),
    barrierDps: rounded((definition.barrierDps ?? 1) * multipliers.attack, 2),
    facilityDps: definition.facilityDps == null ? definition.facilityDps : rounded(definition.facilityDps * multipliers.attack, 2),
    settlementDamage: definition.settlementDamage == null ? definition.settlementDamage : Math.max(1, Math.round(definition.settlementDamage * multipliers.attack))
  };
}

export function waveIntervalForBase(definition, baseLevel, cityHp = 100) {
  const level = normalizeEnemyLevel(baseLevel);
  const pressureMultiplier = Number(cityHp) <= 30 ? 1.3 : 1;
  return definition.interval * (ENEMY_WAVE_INTERVAL_MULTIPLIERS[level] ?? 1) * pressureMultiplier;
}

export function enemyDensityForState(state) {
  const level = Math.max(0, Math.min(7, effectiveEnemyCivilizationLevel(state)));
  return ENEMY_DENSITY_BY_CIVILIZATION[level] ?? ENEMY_DENSITY_BY_CIVILIZATION[0];
}

export function enemyPopulationCap(state) { return enemyDensityForState(state).populationCap; }

export function expandedWaveSize(state, baseSize) {
  const count = Math.max(0, Math.floor(Number(baseSize) || 0));
  if (count === 0) return 0;
  return Math.max(count, Math.round(count * enemyDensityForState(state).waveMultiplier));
}
