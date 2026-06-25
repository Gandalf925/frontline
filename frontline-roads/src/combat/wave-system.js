import { stableId } from '../core/utilities.js';
import { ENEMY_BASE_DEFINITIONS, ENEMY_DEFINITIONS, ENEMY_GENERATIONS } from './definitions.js';
import { spawnEnemy } from './enemy-system.js';
import { enemyBaseLevelForState, enemyDensityForState, expandedWaveSize, waveIntervalForBase } from './enemy-scaling.js';
import { INITIAL_BASE_TYPES, selectEnemyBaseNode } from './enemy-base-placement.js';
import { enemyBehaviorForDefinition, waveDoctrineDefinition } from './enemy-personalities.js';
import { enemyRegroupActive } from '../core/recovery-balance.js';

export { INITIAL_BASE_TYPES } from './enemy-base-placement.js';

const OPENING_WAVE_INTERVAL_MULTIPLIER = 1.35;
const OPENING_ACTIVE_WAVE_LIMIT = 2;
const OPENING_GRACE_SECONDS = 15 * 60;

function activeWaveCount(state) {
  return Object.values(state.combat?.waves?.active ?? {}).filter(wave => (wave?.remaining ?? 0) > 0).length;
}

function openingPressureLimited(state) {
  if (Math.max(0, Math.floor(Number(state.civilization?.level) || 0)) !== 0) return false;
  const createdAt = Number(state.runtime?.createdAt) || Number(state.runtime?.worldTimeMs) || Date.now();
  const worldTime = Number(state.runtime?.worldTimeMs) || createdAt;
  return Math.max(0, worldTime - createdAt) < OPENING_GRACE_SECONDS * 1000;
}


function deterministicIndex(text, length) {
  let hash = 2166136261;
  for (const character of text) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return length ? (hash >>> 0) % length : 0;
}

export function waveDoctrineForBase(state, base, guard = false) {
  if (guard) return waveDoctrineDefinition('guard');
  const level = Math.max(0, Math.floor(Number(state.civilization?.level) || 0));
  const available = ['frontal'];
  if (level >= 1) available.push('flank', 'raid');
  if (level >= 2) available.push('breach');
  if (level >= 3) available.push('support');
  if (level >= 4) available.push('hunt');
  const key = available[deterministicIndex(`${base.id}:${base.wavesSent}:doctrine:${level}`, available.length)];
  return waveDoctrineDefinition(key);
}

function doctrinePool(pool, doctrine) {
  const preferred = new Set(doctrine.preferredPersonalities ?? []);
  const matching = pool.filter(type => preferred.has(enemyBehaviorForDefinition(ENEMY_DEFINITIONS[type]).personalityKey));
  return matching.length ? matching : pool;
}

export function enemyGenerationMix(state) {
  const generation = Math.max(0, Math.floor(Number(state.civilization.level) || 0));
  if (generation <= 0) return { generation: 0, probability: 0 };
  const worldNow = Number(state.runtime?.worldTimeMs) || Date.now();
  const elapsed = worldNow - (Number(state.civilization.completedAt) || worldNow);
  if (elapsed < 15 * 60 * 1000) return { generation, probability: 0 };
  if (elapsed < 30 * 60 * 1000) return { generation, probability: 0.25 };
  if (elapsed < 45 * 60 * 1000) return { generation, probability: 0.50 };
  if (elapsed < 60 * 60 * 1000) return { generation, probability: 0.75 };
  return { generation, probability: 1 };
}

function levelWave(definition, base) {
  const level = Math.max(1, Math.min(8, Math.floor(Number(base.level) || 1)));
  const initial = [...(definition.waves[1] ?? [])];
  const desiredCount = initial.length + level - 1;
  const template = [...(definition.waves[Math.min(level, 3)] ?? initial)];
  const reinforcementPool = [
    ...(definition.waves[3] ?? []),
    ...(definition.waves[2] ?? []),
    ...initial
  ];
  const wave = template.length > desiredCount && desiredCount > 1
    ? [...template.slice(0, desiredCount - 1), template.at(-1)]
    : template.slice(0, desiredCount);
  while (wave.length < desiredCount && reinforcementPool.length) {
    const index = deterministicIndex(`${base.id}:${base.wavesSent}:${level}:reinforcement:${wave.length}`, reinforcementPool.length);
    wave.push(reinforcementPool[index]);
  }
  return wave;
}

export function waveForBase(state, base, doctrineKey = null) {
  const definition = ENEMY_BASE_DEFINITIONS[base.type];
  if (!definition) return [];
  const wave = levelWave(definition, base);
  const doctrine = doctrineKey ? waveDoctrineDefinition(doctrineKey) : waveDoctrineForBase(state, base);
  const mix = enemyGenerationMix(state);
  if (mix.generation <= 0 || wave.length === 0) return wave;
  const current = ENEMY_GENERATIONS[mix.generation] ?? [];
  const previous = Object.entries(ENEMY_GENERATIONS)
    .filter(([generation]) => Number(generation) > 0 && Number(generation) < mix.generation)
    .flatMap(([, values]) => values);
  if (mix.probability <= 0 && previous.length === 0) return wave;
  const replacementSlots = Math.min(wave.length, 1 + Math.floor(Math.max(1, Number(base.level) || 1) / 2));
  for (let index = 0; index < Math.min(replacementSlots, wave.length); index += 1) {
    const roll = deterministicIndex(`${base.id}:${base.wavesSent}:${index}:roll`, 1000) / 1000;
    const rawPool = current.length && roll < mix.probability ? current : previous;
    const pool = doctrinePool(rawPool, doctrine);
    if (!pool.length) continue;
    const type = pool[deterministicIndex(`${base.id}:${base.wavesSent}:${index}:${doctrine.key}:type`, pool.length)];
    wave[wave.length - 1 - index] = type;
  }
  return wave;
}

export const MAX_ACTIVE_ENEMY_BASES = 10;

export function enemyBaseTypesForCivilization(level) {
  const normalized = Math.max(0, Math.min(7, Math.floor(Number(level) || 0)));
  const types = [...INITIAL_BASE_TYPES];
  if (normalized >= 2) types.push('copperCamp', 'tinCamp');
  if (normalized >= 3) types.push('ironCamp');
  if (normalized >= 3 && normalized < 5) types.push('bronzeCamp');
  if (normalized >= 3 && normalized < 6) types.push('siegeWorks');
  if (normalized >= 5) types.push('steelCamp');
  if (normalized >= 6) types.push('machineWorks');
  if (normalized >= 7) types.push('commandFortress');
  return [...new Set(types)].slice(0, MAX_ACTIVE_ENEMY_BASES);
}

export function unlockedBaseTypes(state) {
  return enemyBaseTypesForCivilization(state.civilization.level ?? 0);
}

const ENEMY_BASE_REPLACEMENTS = Object.freeze([
  Object.freeze({ level: 5, from: 'bronzeCamp', to: 'steelCamp' }),
  Object.freeze({ level: 6, from: 'siegeWorks', to: 'machineWorks' })
]);

function activeEnemyBaseCount(state) {
  return (state.world?.enemyBases ?? []).filter(base => base.alive).length;
}

function transformEnemyBase(base, targetType) {
  const definition = ENEMY_BASE_DEFINITIONS[targetType];
  if (!definition) return false;
  const oldMaximum = Math.max(1, Number(base.maxHp) || 120);
  const healthRatio = Math.max(0, Math.min(1, Number(base.hp ?? oldMaximum) / oldMaximum));
  base.upgradedFromType ??= base.type;
  base.type = targetType;
  base.maxHp = definition.isResourceBase ? 120 : 100;
  base.hp = Math.max(1, Math.round(base.maxHp * healthRatio));
  base.alive = true;
  base.destroyed = false;
  base.retired = false;
  base.spawnClock = Math.max(0, definition.interval - definition.firstDelay);
  base.wavesSent = 0;
  base.guardWaveTriggered = false;
  return true;
}

export function synchronizeEnemyBaseNetwork(state, events = null) {
  state.world.enemyBases ??= [];
  state.world.baseRespawns ??= [];
  const level = Math.max(0, Math.floor(Number(state.civilization?.level) || 0));
  for (const replacement of ENEMY_BASE_REPLACEMENTS) {
    if (level < replacement.level) continue;
    const current = state.world.enemyBases.find(base => base.type === replacement.to && base.alive) ?? null;
    const obsolete = state.world.enemyBases.filter(base => base.type === replacement.from && base.alive);
    if (!current && obsolete.length) {
      const converted = obsolete.shift();
      transformEnemyBase(converted, replacement.to);
      events?.emit('message', { text: `${ENEMY_BASE_DEFINITIONS[replacement.from].name}が${ENEMY_BASE_DEFINITIONS[replacement.to].name}へ再編されました。` });
    }
    for (const base of obsolete) {
      base.alive = false;
      base.hp = 0;
      base.retired = true;
      base.destroyed = false;
    }
    const targetExists = state.world.enemyBases.some(base => base.type === replacement.to && base.alive);
    let targetPending = state.world.baseRespawns.some(respawn => respawn.baseType === replacement.to);
    const nextRespawns = [];
    for (const respawn of state.world.baseRespawns) {
      if (respawn.baseType !== replacement.from) {
        nextRespawns.push(respawn);
        continue;
      }
      if (targetExists || targetPending) continue;
      respawn.baseType = replacement.to;
      targetPending = true;
      nextRespawns.push(respawn);
    }
    state.world.baseRespawns = nextRespawns;
  }
  return state.world.enemyBases;
}

function createBase(type, placement, idSeed = placement.node.id) {
  const definition = ENEMY_BASE_DEFINITIONS[type];
  return {
    id: stableId('enemy_base', type, idSeed), type, nodeId: placement.node.id,
    hp: definition.isResourceBase ? 120 : 100,
    maxHp: definition.isResourceBase ? 120 : 100,
    alive: true,
    level: 1, ageSeconds: 0,
    spawnClock: definition.interval - definition.firstDelay - (placement.initialDelayBonusSec ?? 0),
    initialDelayBonusSec: placement.initialDelayBonusSec ?? 0,
    frontPressureMultiplier: placement.frontPressureMultiplier ?? 1,
    wavesSent: 0, routeDistance: placement.route
  };
}

export function spawnEnemyBaseGuard(state, base, events = null) {
  if (!base?.alive || base.guardWaveTriggered) return 0;
  base.guardWaveTriggered = true;
  const spawned = new WaveSystem(events).spawnWave(state, base, true);
  if (spawned > 0) {
    events?.emit('message', { text: `${ENEMY_BASE_DEFINITIONS[base.type].name}の守備隊が迎撃を開始しました。` });
  }
  return spawned;
}

export class WaveSystem {
  constructor(events) { this.events = events; }

  spawnWave(state, base, guard = false) {
    const doctrine = waveDoctrineForBase(state, base, guard);
    const baseWave = waveForBase(state, base, doctrine.key);
    const density = enemyDensityForState(state);
    const desiredSize = guard ? baseWave.length : expandedWaveSize(state, baseWave.length);
    const wave = Array.from({ length: desiredSize }, (_, index) => baseWave[index % Math.max(1, baseWave.length)]).filter(Boolean);
    state.combat.waves.active ??= {};
    const waveId = stableId('wave', base.id, base.wavesSent, state.runtime?.worldTimeMs ?? Date.now());
    let spawned = 0;
    wave.forEach((type, index) => {
      const spacing = guard ? 3 : density.departureSpacingSeconds;
      if (spawnEnemy(state, base, type, index * spacing, waveId, doctrine.key)) spawned += 1;
    });
    if (spawned > 0) {
      state.combat.waves.active[waveId] = {
        id: waveId, baseId: base.id, remaining: spawned, breached: false, guard,
        doctrineKey: doctrine.key, startedAt: state.runtime?.worldTimeMs ?? Date.now()
      };
      this.events?.emit('combat:wave-launched', { baseId: base.id, waveId, count: spawned, guard, doctrineKey: doctrine.key, level: base.level ?? 1 });
    }
    if (!guard) {
      base.wavesSent += 1;
      this.events?.emit('message', { text: `${ENEMY_BASE_DEFINITIONS[base.type].name} Lv.${base.level ?? 1}が「${doctrine.label}」を開始しました。` });
    }
    return spawned;
  }

  ensureUnlockedBases(state) {
    synchronizeEnemyBaseNetwork(state, this.events);
    state.world.baseRespawns ??= [];
    const pendingTypes = new Set(state.world.baseRespawns.map(item => item.baseType));
    for (const type of unlockedBaseTypes(state)) {
      const exists = state.world.enemyBases.some(base => base.type === type && base.alive);
      if (exists || pendingTypes.has(type)) continue;
      if (activeEnemyBaseCount(state) >= MAX_ACTIVE_ENEMY_BASES) break;
      const placement = selectEnemyBaseNode(state, type);
      if (!placement) continue;
      const base = createBase(type, placement);
      state.world.enemyBases.push(base);
      this.events?.emit('message', { text: `${ENEMY_BASE_DEFINITIONS[type].name}が道路網に出現しました。` });
    }
  }

  processRespawns(state, deltaSeconds) {
    state.world.baseRespawns ??= [];
    const remaining = [];
    for (const respawn of state.world.baseRespawns) {
      respawn.remainingSec = Math.max(0, Number(respawn.remainingSec) - deltaSeconds);
      if (respawn.remainingSec > 0) {
        remaining.push(respawn);
        continue;
      }
      const desiredTypes = new Set(unlockedBaseTypes(state));
      if (!desiredTypes.has(respawn.baseType)) continue;
      if (state.world.enemyBases.some(base => base.type === respawn.baseType && base.alive)) continue;
      if (activeEnemyBaseCount(state) >= MAX_ACTIVE_ENEMY_BASES) {
        respawn.remainingSec = 60 * 60;
        respawn.attempts = (respawn.attempts ?? 0) + 1;
        remaining.push(respawn);
        continue;
      }
      const placement = selectEnemyBaseNode(state, respawn.baseType, respawn.sourceNodeId);
      if (!placement) {
        respawn.remainingSec = 60 * 60;
        respawn.attempts = (respawn.attempts ?? 0) + 1;
        remaining.push(respawn);
        continue;
      }
      const base = createBase(respawn.baseType, placement, `${respawn.id}:${respawn.attempts ?? 0}`);
      state.world.enemyBases.push(base);
      this.events?.emit('message', { text: `${ENEMY_BASE_DEFINITIONS[respawn.baseType].name}が別の道路へ再出現しました。` });
    }
    state.world.baseRespawns = remaining;
  }

  update(state, deltaSeconds) {
    synchronizeEnemyBaseNetwork(state, this.events);
    this.processRespawns(state, deltaSeconds);
    state.combat.waves.resourceBaseCheckClock = (state.combat.waves.resourceBaseCheckClock ?? 30) + deltaSeconds;
    while (state.combat.waves.resourceBaseCheckClock >= 30) {
      state.combat.waves.resourceBaseCheckClock -= 30;
      this.ensureUnlockedBases(state);
    }
    const regrouping = enemyRegroupActive(state);
    for (const base of state.world.enemyBases) {
      if (!base.alive) continue;
      const definition = ENEMY_BASE_DEFINITIONS[base.type];
      if (!definition) continue;
      base.ageSeconds = (base.ageSeconds ?? 0) + deltaSeconds;
      const previousLevel = Math.max(1, Math.floor(Number(base.level) || 1));
      base.level = enemyBaseLevelForState(state, base.ageSeconds);
      if (base.level > previousLevel) {
        this.events?.emit('message', { text: `${definition.name}の脅威レベルがLv.${base.level}へ上昇しました。` });
        this.events?.emit('combat:enemy-base-level-up', { baseId: base.id, level: base.level });
      }
      if (regrouping) continue;
      base.spawnClock = (base.spawnClock ?? 0) + deltaSeconds;
      const openingMultiplier = openingPressureLimited(state) ? OPENING_WAVE_INTERVAL_MULTIPLIER : 1;
      const density = enemyDensityForState(state);
      const interval = waveIntervalForBase(definition, base.level, state.world.city.hp)
        * density.intervalMultiplier
        * Math.max(1, Number(base.frontPressureMultiplier) || 1)
        * openingMultiplier;
      if (openingPressureLimited(state) && activeWaveCount(state) >= OPENING_ACTIVE_WAVE_LIMIT) {
        base.spawnClock = Math.min(base.spawnClock, interval);
        continue;
      }
      if (base.spawnClock >= interval) {
        if (openingPressureLimited(state) && activeWaveCount(state) >= OPENING_ACTIVE_WAVE_LIMIT) {
          base.spawnClock = Math.min(base.spawnClock, interval);
          continue;
        }
        // Old saves or a civilization upgrade may carry a large clock. Launch only the
        // currently due wave; offline simulation already advances in bounded time steps.
        base.spawnClock %= interval;
        this.spawnWave(state, base);
      }
    }
  }
}
