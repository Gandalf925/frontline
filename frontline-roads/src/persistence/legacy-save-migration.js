import { LifecycleState, SCHEMA_VERSION } from '../core/constants.js';
import { deepClone } from '../core/utilities.js';
import { createInitialState } from '../core/state-schema.js';
import { RESOURCE_KEYS } from '../civilization/data.js';
import { ensureCivilizationState } from '../civilization/civilization-system.js';

function normalizeResources(legacy) {
  const resources = Object.fromEntries(RESOURCE_KEYS.map(key => [key, 0]));
  const source = legacy.inventory?.stored ?? legacy.inventory?.resources ?? legacy.resources ?? null;
  if (source) {
    for (const key of RESOURCE_KEYS) resources[key] = Math.max(0, Math.floor(Number(source[key]) || 0));
  }
  if (!source || RESOURCE_KEYS.every(key => resources[key] === 0)) {
    const scrap = Math.max(0, Math.floor(Number(legacy.scrap ?? legacy.inventory?.resources?.scrap) || 0));
    resources.wood = Math.floor(scrap * 0.45);
    resources.stone = Math.floor(scrap * 0.35);
    resources.fiber = scrap - resources.wood - resources.stone;
  }
  return resources;
}

function normalizeEnemy(enemy) {
  const path = enemy.path ? {
    nodeIds: enemy.path.nodeIds ?? enemy.path.nodes ?? [],
    edgeIds: enemy.path.edgeIds ?? enemy.path.edges ?? [],
    targetId: enemy.path.targetId ?? enemy.path.target ?? null,
    targetObjectId: enemy.path.targetObjectId ?? null,
    cost: enemy.path.cost ?? 0
  } : null;
  return {
    id: enemy.id, type: enemy.type ?? 'infantry', level: Math.max(1, Math.min(8, Math.floor(Number(enemy.level) || 1))),
    hp: Number(enemy.hp) || 1, maxHp: Number(enemy.maxHp) || Number(enemy.hp) || 1, radius: Number(enemy.radius) || null,
    nodeId: enemy.nodeId, path, pathIndex: Math.max(0, Number(enemy.pathIndex) || 0),
    edgeId: enemy.edgeId ?? null, edgeProgress: Math.max(0, Number(enemy.edgeProgress) || 0),
    slowTimer: Math.max(0, Number(enemy.slowTimer) || 0), slowMultiplier: Number(enemy.slowMultiplier) || 0.52,
    attackClock: Math.max(0, Number(enemy.attackClock) || 0), departDelay: Math.max(0, Number(enemy.departDelay) || 0),
    sourceBaseId: enemy.sourceBaseId ?? null, waveId: enemy.waveId ?? null, waveResolved: Boolean(enemy.waveResolved),
    routeBias: Number.isFinite(Number(enemy.routeBias)) ? Number(enemy.routeBias) : 1,
    targetDefenseId: enemy.targetDefenseId ?? null,
    targetFieldBaseId: enemy.targetFieldBaseId ?? null, targetPlayerBaseId: enemy.targetPlayerBaseId ?? null, targetSquadId: enemy.targetSquadId ?? null, doctrineKey: enemy.doctrineKey ?? 'frontal',
    notifiedDefenseIds: Array.isArray(enemy.notifiedDefenseIds)
      ? enemy.notifiedDefenseIds
      : Array.isArray(enemy.stunnedTowerIds) ? enemy.stunnedTowerIds : [],
    reroutePending: Boolean(enemy.reroutePending),
    rewardGranted: Boolean(enemy.rewardGranted)
  };
}

function normalizeDefenses(legacy, graph) {
  const defenses = [];
  const legacyTowers = legacy.towers ?? legacy.combat?.defenses?.filter(item => item.kind === 'tower') ?? [];
  for (const tower of legacyTowers) {
    if (tower.ruined || Number(tower.hp) <= 0) continue;
    const line = tower.line ?? (tower.type === 'gun' ? 'single' : tower.type === 'mortar' ? 'area' : tower.type === 'slow' ? 'slow' : 'repair');
    defenses.push({
      id: tower.id, kind: 'tower', type: tower.type ?? 'gun', line,
      tier: Math.max(0, Math.min(7, Math.floor(Number(tower.tier) || 0))), defenseKey: tower.defenseKey ?? `${line}${Math.max(0, Math.min(7, Math.floor(Number(tower.tier) || 0)))}`,
      nodeId: tower.nodeId, hp: Math.max(0, Number(tower.hp) || 0), maxHp: Math.max(1, Number(tower.maxHp) || 150),
      cooldown: Math.max(0, Number(tower.cooldown) || 0), disabledTimer: Math.max(0, Number(tower.disabledTimer) || 0)
    });
  }
  for (const edge of graph?.edges ?? []) {
    if (!edge.barrier) continue;
    const barrier = edge.barrier;
    if (Number(barrier.hp) <= 0) {
      edge.barrier = null;
      continue;
    }
    const tier = Math.max(0, Math.min(7, Math.floor(Number(barrier.tier) || 0)));
    defenses.push({
      id: barrier.id ?? `legacy_barrier_${edge.id}`, kind: 'barrier', type: 'barrier',
      line: barrier.isGate ? 'gate' : 'barrier', tier,
      defenseKey: barrier.defenseKey ?? `${barrier.isGate ? 'gate' : 'barrier'}${tier}`,
      edgeId: edge.id, hp: Math.max(0, Number(barrier.hp) || 0), maxHp: Math.max(1, Number(barrier.maxHp) || 220), isGate: Boolean(barrier.isGate)
    });
    edge.barrier = null;
  }
  return defenses;
}

function normalizeEnemyBases(legacy) {
  return (legacy.world?.enemyBases ?? legacy.bases ?? []).map(base => ({
    id: base.id, type: base.type ?? 'barracks', nodeId: base.nodeId,
    hp: Math.max(0, Number(base.hp) || 100), maxHp: Math.max(1, Number(base.maxHp) || 100),
    alive: base.alive !== false, level: Math.max(1, Math.min(8, Math.floor(Number(base.level) || 1))),
    ageSeconds: Math.max(0, Number(base.ageSeconds) || 0), spawnClock: Math.max(0, Number(base.spawnClock) || 0),
    wavesSent: Math.max(0, Number(base.wavesSent) || 0), routeDistance: Number(base.routeDistance ?? base.roadDistance) || 0
  }));
}

export function isLegacySave(value) {
  return Boolean(value && value.schemaVersion !== SCHEMA_VERSION);
}

function migrateRefactorV1(legacy) {
  const defaults = createInitialState();
  const state = deepClone(legacy);
  state.schemaVersion = SCHEMA_VERSION;
  state.lifecycle = Object.values(LifecycleState).includes(state.lifecycle) ? state.lifecycle : LifecycleState.LOAD_SAVE;
  state.world = { ...defaults.world, ...(state.world ?? {}) };
  delete state.world.outposts;
  state.player = { ...defaults.player, ...(state.player ?? {}) };
  state.combat = { ...defaults.combat, ...(state.combat ?? {}) };
  state.statistics = { ...defaults.statistics, ...(state.statistics ?? {}) };
  state.runtime = { ...defaults.runtime, ...(state.runtime ?? {}), performance: { ...defaults.runtime.performance, ...(state.runtime?.performance ?? {}) } };
  const oldResources = state.inventory?.resources ?? {};
  const hasCanonicalResources = RESOURCE_KEYS.some(key => Number(oldResources[key]) > 0);
  state.inventory = { ...defaults.inventory, ...(state.inventory ?? {}), resources: Object.fromEntries(RESOURCE_KEYS.map(key => [key, Math.max(0, Math.floor(Number(oldResources[key]) || 0))])) };
  if (!hasCanonicalResources && Number(oldResources.scrap) > 0) {
    const scrap = Math.floor(Number(oldResources.scrap));
    state.inventory.resources.wood = Math.floor(scrap * 0.45);
    state.inventory.resources.stone = Math.floor(scrap * 0.35);
    state.inventory.resources.fiber = scrap - state.inventory.resources.wood - state.inventory.resources.stone;
  }
  state.civilization = { ...defaults.civilization, ...(state.civilization ?? {}) };
  ensureCivilizationState(state);
  state.runtime.migratedFrom = { schemaVersion: legacy.schemaVersion ?? null, version: legacy.runtime?.version ?? null, at: Date.now() };
  return state;
}

export function migrateLegacySave(legacy) {
  if (!isLegacySave(legacy)) return legacy;
  if (legacy.world) return migrateRefactorV1(legacy);
  const state = createInitialState();
  const graph = deepClone(legacy.map);
  const cityNodeId = legacy.homeBase?.nodeId ?? legacy.homeBaseNodeId ?? legacy.city?.nodeId ?? null;
  const cityNode = graph?.nodes?.find(node => node.id === cityNodeId) ?? null;

  state.lifecycle = LifecycleState.LOAD_SAVE;
  state.world.roadGraph = graph;
  state.world.homeBase = {
    status: 'ESTABLISHED', nodeId: cityNodeId, edgeId: legacy.homeBase?.edgeId ?? null,
    x: cityNode?.x ?? legacy.homeBase?.x ?? 0, y: cityNode?.y ?? legacy.homeBase?.y ?? 0,
    location: legacy.homeBase?.location ?? null,
    selectedDistanceMeters: Number(legacy.homeBase?.selectedDistanceMeters) || 0,
    establishedAt: legacy.homeBase?.establishedAt ?? legacy.startedAt ?? Date.now()
  };
  state.world.city = {
    nodeId: legacy.city?.nodeId ?? cityNodeId,
    hp: Math.max(0, Number(legacy.city?.hp) || 100), maxHp: Math.max(1, Number(legacy.city?.maxHp) || 100)
  };
  state.world.enemyBases = normalizeEnemyBases(legacy);
  state.world.baseRespawns = (legacy.baseRespawns ?? []).map(item => ({
    id: item.id ?? `legacy_respawn_${item.baseType}_${item.sourceNodeId}`,
    baseType: item.baseType,
    sourceNodeId: item.sourceNodeId,
    remainingSec: Math.max(0, Number(item.remainingSec) || ((Number(item.readyAt) || Date.now()) - Date.now()) / 1000),
    attempts: Math.max(0, Number(item.attempts) || 0)
  }));
  state.player.currentPosition = legacy.player?.lat && legacy.player?.lon ? { lat: legacy.player.lat, lon: legacy.player.lon } : null;
  state.player.worldPosition = { x: Number(legacy.player?.x) || state.world.homeBase.x, y: Number(legacy.player?.y) || state.world.homeBase.y };
  state.combat.enemies = (legacy.enemies ?? []).map(normalizeEnemy);
  state.combat.defenses = normalizeDefenses(legacy, graph);
  state.inventory.resources = normalizeResources(legacy);
  state.inventory.overflow = deepClone(legacy.inventory?.overflow ?? {});
  state.civilization.level = Math.max(0, Number(legacy.civilization?.level) || 0);
  state.civilization.completedAt = legacy.civilization?.completedAt ?? null;
  state.civilization.gracePeriodUntil = legacy.civilization?.gracePeriodUntil ?? null;
  state.civilization.project = deepClone(legacy.civilization?.project ?? null);
  state.civilization.buildings = deepClone(legacy.settlementBuildings ?? legacy.civilization?.buildings ?? []);
  state.civilization.productionQueues = deepClone(legacy.production?.queues ?? legacy.civilization?.productionQueues ?? []);
  state.statistics.kills = Math.max(0, Number(legacy.progress?.totalKills ?? legacy.kills) || 0);
  state.statistics.campsCaptured = Math.max(0, Number(legacy.progress?.totalCampsCaptured) || 0);
  state.civilization.progress = { ...state.civilization.progress, ...(deepClone(legacy.progress ?? {})) };
  state.runtime.createdAt = Number(legacy.startedAt) || Date.now();
  state.runtime.updatedAt = Date.now();
  state.runtime.lastSavedAt = Number(legacy.lastSavedAt) || Date.now();
  state.runtime.worldTimeMs = state.runtime.lastSavedAt;
  state.runtime.combatInitialized = Boolean(state.world.city);
  state.runtime.migratedFrom = { schemaVersion: legacy.schemaVersion ?? null, version: legacy.version ?? null, at: Date.now() };
  state.schemaVersion = SCHEMA_VERSION;
  ensureCivilizationState(state);
  return state;
}
