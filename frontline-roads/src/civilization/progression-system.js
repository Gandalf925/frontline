import { deepClone } from '../core/utilities.js';
import { CIVILIZATIONS, CIVILIZATION_PROJECTS, DEFENSE_LINES, MAX_CIVILIZATION_LEVEL, SETTLEMENT_BUILDINGS, defenseLineForType } from './data.js';
import { addBundle, consumeBundle } from './inventory-system.js';
import { applyDefenseTier, defenseUpgradeStatus } from './defense-upgrade.js';
import { defenseLine, repairCostForDefense } from './repair-cost.js';
import { activeFieldBases, synchronizeFieldBaseDurability } from '../base/field-bases.js';
import { synchronizeOwnedBaseDurability } from '../base/player-bases.js';


export const PROJECT_RESOURCE_RESERVES = Object.freeze({
  0: Object.freeze({ wood: 40, stone: 30, fiber: 16 }),
  1: Object.freeze({ wood: 80, stone: 60, fiber: 30, timber: 8, rope: 3, cutStone: 6 }),
  2: Object.freeze({ wood: 100, stone: 80, fiber: 40, timber: 10, rope: 4, cutStone: 8, charcoal: 12 }),
  3: Object.freeze({ wood: 120, stone: 100, fiber: 50, timber: 12, rope: 5, cutStone: 10, charcoal: 16, bronzeIngot: 4, wroughtIron: 4 }),
  4: Object.freeze({ wood: 160, stone: 140, fiber: 70, timber: 18, rope: 7, cutStone: 16, charcoal: 24, wroughtIron: 8 }),
  5: Object.freeze({ wood: 220, stone: 180, fiber: 90, timber: 24, rope: 10, cutStone: 22, charcoal: 32, wroughtIron: 10, steel: 6 }),
  6: Object.freeze({ wood: 300, stone: 240, fiber: 120, timber: 32, rope: 14, cutStone: 30, charcoal: 40, wroughtIron: 12, steel: 10, mechanism: 4 }),
  7: Object.freeze({})
});

export function projectContributionReserve(state, resource) {
  const level = Math.max(0, Math.min(MAX_CIVILIZATION_LEVEL, Math.floor(Number(state.civilization?.level) || 0)));
  return Math.max(0, Number(PROJECT_RESOURCE_RESERVES[level]?.[resource]) || 0);
}

export function safeProjectContributionAmount(state, resource) {
  const project = state.civilization?.project;
  if (!project || ['BUILDING', 'PAUSED'].includes(project.status)) return 0;
  const definition = CIVILIZATION_PROJECTS[project.targetLevel];
  const remaining = Math.max(0, (definition?.contributions?.[resource] ?? 0) - (project.contributions?.[resource] ?? 0));
  const available = Math.max(0, Number(state.inventory?.resources?.[resource]) || 0);
  return Math.max(0, Math.min(remaining, available - projectContributionReserve(state, resource)));
}

export function createProgressState() {
  return {
    totalRepairHpPaid: 0,
    barriersBuilt: 0,
    totalProduced: {},
    selfProducedBronze: 0,
    selfProducedWroughtIron: 0,
    selfProducedSteel: 0,
    selfProducedMechanism: 0,
    perfectWaveStreak: 0,
    bossesDefeated: {},
    campsCapturedByType: {},
    cityHpStreaks: { 50: 0, 60: 0, 70: 0 }
  };
}

export function ensureProject(state) {
  if ((state.civilization.level ?? 0) >= MAX_CIVILIZATION_LEVEL) {
    state.civilization.project = null;
    return null;
  }
  const targetLevel = (state.civilization.level ?? 0) + 1;
  const definition = CIVILIZATION_PROJECTS[targetLevel];
  const existing = state.civilization.project;
  if (!existing || existing.targetLevel !== targetLevel) {
    state.civilization.project = {
      targetLevel,
      status: 'AVAILABLE',
      contributions: {},
      durationSec: definition.durationSec,
      progressedSec: 0,
      startedAt: null
    };
  }
  return state.civilization.project;
}

function defenseCount(state, predicate) {
  return state.combat.defenses.filter(defense => defense.hp > 0 && predicate(defense)).length;
}

function buildingCheckValue(state, key) {
  if (SETTLEMENT_BUILDINGS[key]) return state.civilization.buildings.filter(building => building.type === key).length;
  if (key === 'barrier0') {
    const active = defenseCount(state, defense => defense.kind === 'barrier' && (defense.tier ?? 0) >= 0);
    return Math.max(active, Number(state.civilization.progress.barriersBuilt) || 0);
  }
  if (key === 'single0') return defenseCount(state, defense => defenseLineForType(defense.type) === 'single');
  if (key === 'otherDefense0') return defenseCount(state, defense => ['area', 'slow', 'repair'].includes(defenseLineForType(defense.type)));
  if (key === 'upgradedDefenses') return defenseCount(state, defense => (defense.tier ?? 0) >= 1);
  if (key === 'upgradedDefenseKinds') return new Set(state.combat.defenses.filter(defense => defense.hp > 0 && (defense.tier ?? 0) >= 1).map(defense => defenseLineForType(defense.type))).size;
  if (key === 'barrier2') return defenseCount(state, defense => defense.kind === 'barrier' && !defense.isGate && (defense.tier ?? 0) >= 2);
  if (key === 'gate2') return defenseCount(state, defense => defense.kind === 'barrier' && defense.isGate && (defense.tier ?? 0) >= 2);
  if (key === 'gate3') return defenseCount(state, defense => defense.kind === 'barrier' && defense.isGate && (defense.tier ?? 0) >= 3);
  if (key === 'bronzeDefenses') return defenseCount(state, defense => (defense.tier ?? 0) >= 3);
  if (key === 'bronzeDefenseKinds') return new Set(state.combat.defenses.filter(defense => defense.hp > 0 && (defense.tier ?? 0) >= 3).map(defense => defenseLineForType(defense.type))).size;
  if (key === 'wallAtLeast2') return defenseCount(state, defense => defense.kind === 'barrier' && !defense.isGate && (defense.tier ?? 0) >= 2);
  if (key === 'gate4') return defenseCount(state, defense => defense.isGate && (defense.tier ?? 0) >= 4);
  if (key === 'gate5') return defenseCount(state, defense => defense.isGate && (defense.tier ?? 0) >= 5);
  if (key === 'gate6') return defenseCount(state, defense => defense.isGate && (defense.tier ?? 0) >= 6);
  if (key === 'ironDefenses') return defenseCount(state, defense => (defense.tier ?? 0) >= 4);
  if (key === 'ironDefenseKinds') return new Set(state.combat.defenses.filter(defense => defense.hp > 0 && (defense.tier ?? 0) >= 4).map(defense => defenseLineForType(defense.type))).size;
  if (key === 'steelDefenses') return defenseCount(state, defense => (defense.tier ?? 0) >= 5);
  if (key === 'steelDefenseKinds') return new Set(state.combat.defenses.filter(defense => defense.hp > 0 && (defense.tier ?? 0) >= 5).map(defense => defenseLineForType(defense.type))).size;
  if (key === 'mechanismDefenses') return defenseCount(state, defense => (defense.tier ?? 0) >= 6);
  if (key === 'mechanismDefenseKinds') return new Set(state.combat.defenses.filter(defense => defense.hp > 0 && (defense.tier ?? 0) >= 6).map(defense => defenseLineForType(defense.type))).size;
  return 0;
}

function progressCheckValue(state, key, requirement) {
  const progress = state.civilization.progress;
  if (key === 'totalKills') return state.statistics.kills;
  if (key === 'totalCampsCaptured') return state.statistics.campsCaptured;
  if (key === 'totalRepairHpPaid') return progress.totalRepairHpPaid;
  if (key === 'totalProduced') return Object.values(progress.totalProduced).reduce((sum, value) => sum + Number(value || 0), 0);
  if (key === 'selfProducedBronze') return progress.selfProducedBronze;
  if (key === 'selfProducedWroughtIron') return progress.selfProducedWroughtIron;
  if (key === 'selfProducedSteel') return progress.selfProducedSteel ?? 0;
  if (key === 'selfProducedMechanism') return progress.selfProducedMechanism ?? 0;
  if (key === 'perfectWaveStreak') return progress.perfectWaveStreak;
  if (key === 'siegeCaptainsDefeated') return progress.bossesDefeated.siegeCaptain ?? 0;
  if (key === 'activeFieldBases') return activeFieldBases(state).length;
  if (key === 'copperCampsCaptured') return progress.campsCapturedByType.copperCamp ?? 0;
  if (key === 'tinCampsCaptured') return progress.campsCapturedByType.tinCamp ?? 0;
  if (key === 'ironCampsCaptured') return progress.campsCapturedByType.ironCamp ?? 0;
  if (key === 'machineWorksCaptured') return progress.campsCapturedByType.machineWorks ?? 0;
  if (key === 'generation5CommandersDefeated') return progress.bossesDefeated.steelCaptain ?? 0;
  if (key === 'generation6CommandersDefeated') return progress.bossesDefeated.machineCommander ?? 0;
  if (key === 'cityHpStreak') return progress.cityHpStreaks[requirement.threshold] ?? 0;
  return 0;
}

function projectView(state) {
  const level = Math.max(0, Math.min(MAX_CIVILIZATION_LEVEL, Math.floor(Number(state.civilization?.level) || 0)));
  if (level >= MAX_CIVILIZATION_LEVEL) return null;
  const targetLevel = level + 1;
  const existing = state.civilization?.project;
  if (existing?.targetLevel === targetLevel) return existing;
  const definition = CIVILIZATION_PROJECTS[targetLevel];
  return {
    targetLevel,
    status: 'AVAILABLE',
    contributions: {},
    durationSec: definition.durationSec,
    progressedSec: 0,
    startedAt: null
  };
}

export function evaluateProject(state) {
  const project = projectView(state);
  if (!project) return { complete: true, checks: [] };
  const definition = CIVILIZATION_PROJECTS[project.targetLevel];
  const checks = [];
  for (const [key, required] of Object.entries(definition.contributions)) {
    const current = project.contributions[key] ?? 0;
    checks.push({ kind: 'resource', key, current, required, complete: current >= required });
  }
  for (const [key, required] of Object.entries(definition.buildings)) {
    const current = buildingCheckValue(state, key);
    checks.push({ kind: 'building', key, current, required, complete: current >= required });
  }
  for (const [key, required] of Object.entries(definition.progress)) {
    const requiredValue = key === 'cityHpStreak' ? required.seconds : required;
    const current = progressCheckValue(state, key, required);
    checks.push({ kind: 'progress', key, current, required: requiredValue, complete: current >= requiredValue });
  }
  if ((definition.artifactsRequired ?? 0) > 0) {
    const current = Math.max(0, Number(state.civilization.totalArtifactsRecovered) || 0);
    checks.push({ kind: 'artifact', key: 'recoveredArtifacts', current, required: definition.artifactsRequired, complete: current >= definition.artifactsRequired });
  }
  return { complete: checks.every(check => check.complete), checks, project, definition };
}

export class ProgressionSystem {
  constructor(events = null) {
    this.events = events;
  }

  contributeSafely(state, resource) {
    const amount = safeProjectContributionAmount(state, resource);
    if (amount <= 0) {
      const reserve = projectContributionReserve(state, resource);
      return { ok: false, reason: reserve > 0 ? `防衛・建設用の予備資源を${reserve}残しています。必要なら「全量納入」を選んでください。` : '安全に納入できる資源がありません。', reserve };
    }
    return this.contribute(state, resource, amount);
  }

  contribute(state, resource, amount = Infinity) {
    const project = ensureProject(state);
    if (!project || ['BUILDING', 'PAUSED'].includes(project.status)) return { ok: false, reason: '現在は納入できません。' };
    const definition = CIVILIZATION_PROJECTS[project.targetLevel];
    const required = definition.contributions[resource] ?? 0;
    const current = project.contributions[resource] ?? 0;
    const available = state.inventory.resources[resource] ?? 0;
    const accepted = Math.min(Math.max(0, required - current), Math.max(0, Math.floor(amount)), available);
    if (accepted <= 0 || !consumeBundle(state, { [resource]: accepted })) return { ok: false, reason: '納入できる資源がありません。' };
    project.contributions[resource] = current + accepted;
    project.status = evaluateProject(state).complete ? 'READY' : 'CONTRIBUTING';
    return { ok: true, amount: accepted };
  }

  withdraw(state) {
    const project = ensureProject(state);
    if (!project || ['BUILDING', 'PAUSED'].includes(project.status)) return { ok: false, reason: '建設開始後は引き出せません。' };
    const refund = deepClone(project.contributions);
    project.contributions = {};
    project.status = 'AVAILABLE';
    addBundle(state, refund);
    return { ok: true, refund };
  }

  start(state) {
    ensureProject(state);
    const evaluation = evaluateProject(state);
    if (!evaluation.project || !evaluation.complete) return { ok: false, reason: '発展条件を満たしていません。', checks: evaluation.checks };
    evaluation.project.status = 'BUILDING';
    evaluation.project.startedAt = state.runtime?.worldTimeMs ?? Date.now();
    return { ok: true };
  }

  update(state, deltaSeconds) {
    const progress = state.civilization.progress;
    for (const threshold of [50, 60, 70]) {
      progress.cityHpStreaks[threshold] = state.world.city.hp >= threshold
        ? (progress.cityHpStreaks[threshold] ?? 0) + deltaSeconds
        : 0;
    }
    const project = ensureProject(state);
    if (!project) return;
    if (project.status !== 'BUILDING') {
      if (!['PAUSED'].includes(project.status)) project.status = evaluateProject(state).complete ? 'READY' : Object.keys(project.contributions).length ? 'CONTRIBUTING' : 'AVAILABLE';
      return;
    }
    project.progressedSec = Math.min(project.durationSec, (project.progressedSec ?? 0) + deltaSeconds);
    if (project.progressedSec < project.durationSec) return;
    const level = project.targetLevel;
    state.civilization.level = level;
    const worldNow = state.runtime?.worldTimeMs ?? Date.now();
    state.civilization.completedAt = worldNow;
    state.civilization.gracePeriodUntil = CIVILIZATIONS[level].graceMinutes > 0 ? worldNow + CIVILIZATIONS[level].graceMinutes * 60000 : null;
    state.civilization.project = null;
    synchronizeOwnedBaseDurability(state, level);
    synchronizeFieldBaseDurability(state, level);
    ensureProject(state);
    this.events?.emit('civilization:level-up', { level, civilization: CIVILIZATIONS[level] });
    this.events?.emit('message', { text: `${CIVILIZATIONS[level].name}へ発展しました。` });
  }

  repairDefense(state, defenseId) {
    const defense = state.combat.defenses.find(item => item.id === defenseId);
    if (!defense) return { ok: false, reason: '設備が見つかりません。' };
    if (defense.hp <= 0) return { ok: false, reason: '破壊された設備は撤去済みです。再建してください。' };
    const missingHp = Math.max(0, defense.maxHp - defense.hp);
    if (missingHp <= 0) return { ok: false, reason: '修理は不要です。' };
    const line = defenseLine(defense);
    const cost = repairCostForDefense(defense, missingHp);
    if (!consumeBundle(state, cost)) return { ok: false, reason: '修理資源が不足しています。' };
    defense.hp = defense.maxHp;
    state.civilization.progress.totalRepairHpPaid += missingHp;
    this.events?.emit('combat:defense-repaired', { defenseId: defense.id, repairHp: missingHp, cost, automatic: false });
    return { ok: true, defense, cost };
  }

  convertBarrierToGate(state, defenseId) {
    const defense = state.combat.defenses.find(item => item.id === defenseId && item.kind === 'barrier' && !item.isGate && item.hp > 0);
    if (!defense) return { ok: false, reason: '変換できる防壁がありません。' };
    const civilizationLevel = state.civilization.level ?? 0;
    if (civilizationLevel < 2) return { ok: false, reason: '文明Lv.2で石門が解禁されます。' };
    const tier = Math.max(2, Math.min(civilizationLevel, defense.tier ?? 0));
    const definition = DEFENSE_LINES.gate[tier];
    if (!definition) return { ok: false, reason: '門へ変換できません。' };
    const source = definition.cost ?? definition.upgrade ?? {};
    const cost = Object.fromEntries(Object.entries(source).map(([key, value]) => [key, Math.max(1, Math.ceil(value * 0.5))]));
    if (!consumeBundle(state, cost)) return { ok: false, reason: '門への変換資源が不足しています。' };
    const priorMaximum = Math.max(1, defense.maxHp);
    const priorRatio = Math.max(0, Math.min(1, defense.hp / priorMaximum));
    defense.isGate = true;
    defense.line = 'gate';
    defense.tier = tier;
    defense.defenseKey = definition.key;
    defense.maxHp = definition.hp;
    defense.hp = Math.max(1, Math.round(definition.hp * priorRatio));
    this.events?.emit('combat:defense-upgraded', { defenseId: defense.id, tier: defense.tier, gate: true });
    return { ok: true, defense, cost, message: `${definition.name}へ変換しました。` };
  }

  upgradeDefense(state, defenseId) {
    const defense = state.combat.defenses.find(item => item.id === defenseId);
    if (!defense) return { ok: false, reason: '設備が見つかりません。' };
    const status = defenseUpgradeStatus(state, defense);
    if (!status.ok) return { ok: false, reason: status.reason };
    if (!consumeBundle(state, status.cost)) return { ok: false, reason: '強化直前に資源が不足しました。' };
    const definition = applyDefenseTier(defense, status.nextTier, { preserveHealthRatio: true });
    if (!definition) return { ok: false, reason: '強化先の設備定義が見つかりません。' };
    this.events?.emit('combat:defense-upgraded', { defenseId: defense.id, tier: defense.tier, gate: defense.isGate });
    return {
      ok: true,
      defense,
      cost: status.cost,
      message: `${definition.name}（Tier ${defense.tier}）へ強化しました。`
    };
  }
}
