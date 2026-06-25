import { DEFENSE_LINES, defenseLineForType } from './data.js';
import { hasBundle, missingBundle } from './inventory-system.js';

export const MAX_DEFENSE_TIER = 7;


function minimumTierForLine(line) {
  const definitions = DEFENSE_LINES[line] ?? [];
  const index = definitions.findIndex(Boolean);
  return index >= 0 ? index : 0;
}

export function defenseLineForInstance(defense) {
  if (defense?.isGate) return 'gate';
  if (defense?.kind === 'barrier') return 'barrier';
  return defense?.line ?? defenseLineForType(defense?.type);
}

export function defenseDefinitionForInstance(defense, tier = defense?.tier ?? 0) {
  const line = defenseLineForInstance(defense);
  return DEFENSE_LINES[line]?.[tier] ?? null;
}

export function defenseTierMaxHp(defense, tier = defense?.tier ?? 0) {
  const definition = defenseDefinitionForInstance(defense, tier);
  if (definition?.hp) return definition.hp;
  const base = DEFENSE_LINES[defenseLineForInstance(defense)]?.find(Boolean);
  return Math.max(1, Number(base?.hp) || Number(defense?.maxHp) || 1);
}

export function synchronizeDefenseTier(defense) {
  if (!defense) return defense;
  const line = defenseLineForInstance(defense);
  const minimumTier = minimumTierForLine(line);
  let tier = Math.max(minimumTier, Math.min(MAX_DEFENSE_TIER, Math.floor(Number(defense.tier) || 0)));
  while (tier > minimumTier && !DEFENSE_LINES[line]?.[tier]) tier -= 1;
  const definition = DEFENSE_LINES[line]?.[tier];
  if (!definition) return defense;

  const oldMaximum = Math.max(1, Number(defense.maxHp) || Number(definition.hp) || 1);
  const oldHp = Number.isFinite(Number(defense.hp)) ? Math.max(0, Number(defense.hp)) : oldMaximum;
  const ratio = Math.max(0, Math.min(1, oldHp / oldMaximum));
  const maximum = defenseTierMaxHp({ ...defense, line, tier }, tier);

  defense.line = line;
  defense.tier = tier;
  defense.defenseKey = definition.key;
  defense.maxHp = maximum;
  defense.hp = oldHp <= 0 ? 0 : Math.max(1, Math.min(maximum, Math.round(maximum * ratio)));
  return defense;
}

export function defenseUpgradeStatus(state, defense) {
  if (!defense) return { ok: false, reason: '設備が見つかりません。', atMax: false };
  const line = defenseLineForInstance(defense);
  const minimumTier = minimumTierForLine(line);
  const currentTier = Math.max(minimumTier, Math.floor(Number(defense.tier) || minimumTier));
  const currentDefinition = DEFENSE_LINES[line]?.[currentTier] ?? null;
  let nextTier = currentTier + 1;
  let nextDefinition = DEFENSE_LINES[line]?.[nextTier] ?? null;
  while (!nextDefinition && nextTier <= MAX_DEFENSE_TIER) {
    nextTier += 1;
    nextDefinition = DEFENSE_LINES[line]?.[nextTier] ?? null;
  }
  const atMax = !nextDefinition || nextTier > MAX_DEFENSE_TIER;
  if (atMax) {
    return {
      ok: false,
      atMax: true,
      line,
      currentTier,
      currentDefinition,
      reason: '最高Tierへ到達しています。'
    };
  }

  const requiredCivilizationLevel = nextTier;
  const unlocked = (state.civilization?.level ?? 0) >= requiredCivilizationLevel;
  const cost = nextDefinition.upgrade ?? nextDefinition.cost ?? {};
  const affordable = hasBundle(state, cost);
  const missing = missingBundle(state, cost);
  let reason = null;
  if (defense.hp <= 0) reason = '破壊された設備は撤去済みです。';
  else if (!unlocked) reason = `文明Lv.${requiredCivilizationLevel}で解禁されます。`;
  else if (!affordable) reason = '強化資源が不足しています。';

  return {
    ok: !reason,
    atMax: false,
    line,
    currentTier,
    nextTier,
    currentDefinition,
    nextDefinition,
    currentMaxHp: defenseTierMaxHp(defense, currentTier),
    nextMaxHp: defenseTierMaxHp(defense, nextTier),
    requiredCivilizationLevel,
    unlocked,
    affordable,
    cost,
    missing,
    reason
  };
}

export function applyDefenseTier(defense, tier, { preserveHealthRatio = true } = {}) {
  const line = defenseLineForInstance(defense);
  const definition = DEFENSE_LINES[line]?.[tier];
  if (!definition) return null;
  const oldMaximum = Math.max(1, Number(defense.maxHp) || defenseTierMaxHp(defense));
  const oldHp = Number.isFinite(Number(defense.hp)) ? Math.max(0, Number(defense.hp)) : oldMaximum;
  const ratio = preserveHealthRatio ? Math.max(0, Math.min(1, oldHp / oldMaximum)) : 1;
  const nextMaximum = defenseTierMaxHp(defense, tier);

  defense.line = line;
  defense.tier = tier;
  defense.defenseKey = definition.key;
  defense.maxHp = nextMaximum;
  defense.hp = oldHp <= 0 ? 0 : Math.max(1, Math.min(nextMaximum, Math.round(nextMaximum * ratio)));
  return definition;
}
