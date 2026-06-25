import { distance, stableId } from '../core/utilities.js';
import { addBundle } from '../civilization/inventory-system.js';
import { CITY_RECOVERY_DELAY_SECONDS, ENEMY_DEFINITIONS, MAX_ENEMIES, defenseRuntimeDefinition } from './definitions.js';
import { enemyPopulationCap, normalizeEnemyLevel, scaleEnemyDefinition } from './enemy-scaling.js';
import { findCombatPath, findCombatPathToTargets } from './routing-system.js';
import { roadUnitPosition } from './road-unit-position.js';
import { activeFieldBases, fieldBaseById } from '../base/field-bases.js';
import { activePlayerBases, playerBaseById } from '../base/player-bases.js';
import { destroyPlayerBase } from '../base/player-base-system.js';
import { enemyBehaviorForDefinition } from './enemy-personalities.js';
import { destroyFieldBase } from '../base/field-base-system.js';
import { FRIENDLY_SQUAD_DEFINITIONS, friendlySquadDefinition } from './friendly-force-definitions.js';
import { RECOVERY_BALANCE, beginEnemyRegroup } from '../core/recovery-balance.js';
import { detachDefense } from './defense-lifecycle.js';

const FACILITY_ATTACK_RANGE_METERS = 20;
const FACILITY_PRIORITY_PENALTY_SECONDS = 18;
const FIELD_BASE_PRIORITY_PENALTY_SECONDS = 20;
const FRIENDLY_SQUAD_ATTACK_RANGE_METERS = 24;
const DEFAULT_FACILITY_SEARCH_RADIUS_METERS = 480;
const DEFAULT_SQUAD_HUNT_RADIUS_METERS = 650;

function stableRouteBias(text) {
  let hash = 2166136261;
  for (const character of String(text)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return 0.86 + ((hash >>> 0) % 29) / 100;
}

export function enemyPosition(state, enemy) {
  return roadUnitPosition(state, enemy);
}

export function spawnEnemy(state, base, type, departDelay = 0, waveId = null, doctrineKey = 'frontal') {
  if (state.combat.enemies.length >= Math.min(MAX_ENEMIES, enemyPopulationCap(state))) return null;
  const baseDefinition = ENEMY_DEFINITIONS[type];
  if (!baseDefinition) return null;
  const level = normalizeEnemyLevel(base.level);
  const definition = scaleEnemyDefinition(baseDefinition, level);
  const id = stableId('enemy', base.id, type, base.wavesSent, state.combat.enemies.length, state.runtime?.worldTimeMs ?? Date.now());
  const enemy = {
    id,
    type, level, hp: definition.hp, maxHp: definition.hp, radius: definition.radius, nodeId: base.nodeId,
    path: null, pathIndex: 0, edgeId: null, edgeProgress: 0,
    slowTimer: 0, slowMultiplier: 0.52, attackClock: 0, departDelay,
    sourceBaseId: base.id, waveId, doctrineKey, waveResolved: false, rewardGranted: false,
    reroutePending: false, routeBias: stableRouteBias(id), targetDefenseId: null, targetFieldBaseId: null, targetPlayerBaseId: null, targetSquadId: null,
    notifiedDefenseIds: [], engagedSquadId: null
  };
  state.combat.enemies.push(enemy);
  return enemy;
}

function activeTowerById(state, defenseId) {
  if (!defenseId) return null;
  return state.combat.defenses.find(defense =>
    defense.id === defenseId && defense.kind === 'tower' && defense.hp > 0
  ) ?? null;
}

function facilityTargetCandidates(state, definition, enemy) {
  const priorities = definition.targetPriorities ?? [];
  if (!priorities.length) return [];
  const rankByType = new Map(priorities.map((type, index) => [type, index]));
  const origin = enemyPosition(state, enemy);
  const maxDistance = Math.max(50, Number(definition.facilitySearchRadius) || DEFAULT_FACILITY_SEARCH_RADIUS_METERS);
  return state.combat.defenses
    .filter(defense => defense.kind === 'tower' && defense.hp > 0 && rankByType.has(defense.type))
    .filter(defense => {
      const node = state.world.roadGraph.nodeById.get(defense.nodeId);
      return node && distance(origin, node) <= maxDistance;
    })
    .map(defense => ({
      nodeId: defense.nodeId,
      targetObjectId: defense.id,
      priorityPenalty: rankByType.get(defense.type) * Math.max(0, Number(definition.facilityPriorityPenaltySeconds ?? FACILITY_PRIORITY_PENALTY_SECONDS))
    }));
}

function activeFieldBaseById(state, baseId) {
  return baseId ? fieldBaseById(state, baseId, { includeDestroyed: false }) : null;
}

function activeHuntSquadById(state, squadId, enemy = null, definition = null) {
  if (!squadId) return null;
  const squad = (state.combat.friendlySquads ?? []).find(item =>
    item.id === squadId && item.hp > 0 && !['RECOVERING', 'READY'].includes(item.status)
  ) ?? null;
  if (!squad || !enemy || !definition) return squad;
  const nodeId = squadTargetNodeId(state, squad);
  const node = nodeId ? state.world.roadGraph.nodeById.get(nodeId) : null;
  const maxDistance = Math.max(80, Number(definition.huntRadius) || DEFAULT_SQUAD_HUNT_RADIUS_METERS);
  return node && distance(enemyPosition(state, enemy), node) <= maxDistance ? squad : null;
}

function squadTargetNodeId(state, squad) {
  if (!squad) return null;
  if (squad.path?.nodeIds?.length) {
    const next = squad.path.nodeIds[Math.min(squad.pathIndex + 1, squad.path.nodeIds.length - 1)];
    if (next && state.world.roadGraph.nodeById.has(next)) return next;
  }
  return state.world.roadGraph.nodeById.has(squad.nodeId) ? squad.nodeId : null;
}

function friendlySquadTargetCandidates(state, enemy, definition) {
  const origin = enemyPosition(state, enemy);
  const maxDistance = Math.max(80, Number(definition.huntRadius) || DEFAULT_SQUAD_HUNT_RADIUS_METERS);
  return (state.combat.friendlySquads ?? [])
    .filter(squad => squad.hp > 0 && !['RECOVERING', 'READY'].includes(squad.status))
    .map(squad => ({ squad, nodeId: squadTargetNodeId(state, squad) }))
    .filter(entry => entry.nodeId && distance(origin, state.world.roadGraph.nodeById.get(entry.nodeId)) <= maxDistance)
    .map(({ squad, nodeId }) => ({
      nodeId,
      targetObjectId: `squad:${squad.id}`,
      priorityPenalty: squad.type === 'retrieval' ? 0 : 5
    }));
}

function planPath(state, enemy) {
  const definition = ENEMY_DEFINITIONS[enemy.type] ?? ENEMY_DEFINITIONS.infantry;
  const behavior = enemyBehaviorForDefinition(definition, enemy.doctrineKey);
  if (definition.huntFriendlySquads || behavior.targetMode === 'SQUADS') {
    const squadPath = findCombatPathToTargets(
      state,
      enemy.nodeId,
      friendlySquadTargetCandidates(state, enemy, definition),
      enemy.type,
      enemy.routeBias ?? 1,
      enemy.level ?? 1,
      enemy.doctrineKey
    );
    if (squadPath?.targetObjectId?.startsWith('squad:')) {
      enemy.targetSquadId = squadPath.targetObjectId.slice(6);
      enemy.targetDefenseId = null;
      enemy.targetFieldBaseId = null;
      enemy.targetPlayerBaseId = null;
      return squadPath;
    }
  }
  enemy.targetSquadId = null;

  const targets = facilityTargetCandidates(state, definition, enemy);
  if (targets.length) {
    const facilityPath = findCombatPathToTargets(state, enemy.nodeId, targets, enemy.type, enemy.routeBias ?? 1, enemy.level ?? 1, enemy.doctrineKey);
    if (facilityPath) {
      enemy.targetDefenseId = facilityPath.targetObjectId;
      enemy.targetFieldBaseId = null;
      enemy.targetPlayerBaseId = null;
      return facilityPath;
    }
  }
  enemy.targetDefenseId = null;
  const raid = behavior.targetMode === 'BASES';
  const cityPenalty = Math.max(0, Number(definition.cityPriorityPenalty ?? 0)) + (raid ? 60 : 0);
  const fieldPenalty = Math.max(0, Number(definition.fieldBasePriorityPenalty ?? FIELD_BASE_PRIORITY_PENALTY_SECONDS)) + (raid ? 0 : 0);
  const majorPenalty = Math.max(0, Number(definition.majorBasePriorityPenalty ?? 14)) + (raid ? 0 : 0);
  const settlementTargets = [
    { nodeId: state.world.city.nodeId, targetObjectId: 'city', priorityPenalty: cityPenalty },
    ...activePlayerBases(state).filter(base => !base.primary).map(base => ({ nodeId: base.nodeId, targetObjectId: `major:${base.id}`, priorityPenalty: majorPenalty })),
    ...activeFieldBases(state).map(base => ({
      nodeId: base.nodeId,
      targetObjectId: `field:${base.id}`,
      priorityPenalty: fieldPenalty
    }))
  ];
  const path = findCombatPathToTargets(state, enemy.nodeId, settlementTargets, enemy.type, enemy.routeBias ?? 1, enemy.level ?? 1, enemy.doctrineKey);
  enemy.targetFieldBaseId = path?.targetObjectId?.startsWith('field:') ? path.targetObjectId.slice(6) : null;
  enemy.targetPlayerBaseId = path?.targetObjectId?.startsWith('major:') ? path.targetObjectId.slice(6) : null;
  return path;
}

function ensurePath(state, enemy) {
  if (enemy.targetDefenseId && !activeTowerById(state, enemy.targetDefenseId)) {
    enemy.targetDefenseId = null;
    enemy.reroutePending = true;
  }
  if (enemy.targetPlayerBaseId && !playerBaseById(state, enemy.targetPlayerBaseId, { includeDestroyed: false })) {
    enemy.targetPlayerBaseId = null;
    enemy.reroutePending = true;
  }
  if (enemy.targetFieldBaseId && !activeFieldBaseById(state, enemy.targetFieldBaseId)) {
    enemy.targetFieldBaseId = null;
    enemy.reroutePending = true;
  }
  const definition = ENEMY_DEFINITIONS[enemy.type] ?? ENEMY_DEFINITIONS.infantry;
  if (enemy.targetSquadId && !activeHuntSquadById(state, enemy.targetSquadId, enemy, definition)) {
    enemy.targetSquadId = null;
    enemy.reroutePending = true;
  }
  const targetSquad = activeHuntSquadById(state, enemy.targetSquadId, enemy, definition);
  const expectedTargetId = enemy.targetDefenseId
    ? activeTowerById(state, enemy.targetDefenseId)?.nodeId
    : enemy.targetPlayerBaseId
      ? playerBaseById(state, enemy.targetPlayerBaseId, { includeDestroyed: false })?.nodeId
      : enemy.targetFieldBaseId
        ? activeFieldBaseById(state, enemy.targetFieldBaseId)?.nodeId
        : targetSquad
        ? squadTargetNodeId(state, targetSquad)
        : state.world.city.nodeId;
  const currentPathValid = expectedTargetId && enemy.path?.targetId === expectedTargetId && enemy.pathIndex < enemy.path.edgeIds.length;
  if (currentPathValid && !enemy.reroutePending) return true;

  const currentEdgeLength = enemy.edgeId ? state.world.roadGraph.edgeById.get(enemy.edgeId)?.length ?? 0 : 0;
  if (enemy.path && enemy.edgeId && enemy.edgeProgress > 0 && enemy.edgeProgress < currentEdgeLength) {
    enemy.reroutePending = true;
    return true;
  }

  const path = planPath(state, enemy);
  enemy.path = path;
  enemy.pathIndex = 0;
  enemy.edgeId = path?.edgeIds[0] ?? null;
  enemy.edgeProgress = 0;
  enemy.reroutePending = false;
  return Boolean(path);
}

function attackTargetFacility(state, enemy, definition, deltaSeconds, events) {
  const target = activeTowerById(state, enemy.targetDefenseId);
  if (!target) return false;
  const node = state.world.roadGraph.nodeById.get(target.nodeId);
  if (!node || distance(enemyPosition(state, enemy), node) > FACILITY_ATTACK_RANGE_METERS) return false;

  enemy.notifiedDefenseIds ??= [];
  if (!enemy.notifiedDefenseIds.includes(target.id)) {
    enemy.notifiedDefenseIds.push(target.id);
    if ((definition.stunSeconds ?? 0) > 0) {
      target.disabledTimer = Math.max(target.disabledTimer ?? 0, definition.stunSeconds);
    }
    events?.emit('message', { text: definition.attackMessage ?? `${definition.name}が防衛施設を攻撃しています。` });
  }

  target.hp -= Math.max(0.1, definition.facilityDps ?? definition.barrierDps ?? 1) * deltaSeconds;
  if (target.hp > 0) return true;

  target.hp = 0;
  const destroyed = detachDefense(state, target.id) ?? target;
  beginEnemyRegroup(state, RECOVERY_BALANCE.defenseBreakthroughRegroupSeconds);
  events?.emit('combat:defense-destroyed', { defenseId: destroyed.id, defense: destroyed, position: node });
  events?.emit('message', { text: `${defenseRuntimeDefinition(destroyed).name ?? '防衛施設'}が破壊され、建設地点から撤去されました。` });
  return true;
}

function resolveWaveEnemy(state, enemy, breached) {
  if (!enemy.waveId || enemy.waveResolved) return;
  enemy.waveResolved = true;
  const record = state.combat.waves.active?.[enemy.waveId];
  if (!record) return;
  record.remaining = Math.max(0, record.remaining - 1);
  if (breached) record.breached = true;
  if (record.remaining > 0) return;
  if (!record.guard) {
    if (record.breached) state.civilization.progress.perfectWaveStreak = 0;
    else state.civilization.progress.perfectWaveStreak = (state.civilization.progress.perfectWaveStreak ?? 0) + 1;
  }
  delete state.combat.waves.active[enemy.waveId];
}

export function damageEnemy(state, enemy, amount, events = null, spatial = null) {
  if (enemy.hp <= 0 || enemy.rewardGranted) return false;
  if (!(ENEMY_DEFINITIONS[enemy.type]?.shieldAura > 0)) {
    const position = spatial?.positions?.get(enemy.id) ?? enemyPosition(state, enemy);
    const shieldCandidates = spatial ? spatial.query(position, 24) : state.combat.enemies.map(other => ({ enemy: other, position: enemyPosition(state, other) }));
    let strongestShield = 0;
    for (const entry of shieldCandidates) {
      const other = entry.enemy;
      const shield = Math.max(0, Math.min(0.8, Number(ENEMY_DEFINITIONS[other.type]?.shieldAura) || 0));
      const range = Math.max(1, Number(ENEMY_DEFINITIONS[other.type]?.shieldRange) || 14);
      if (other !== enemy && other.hp > 0 && shield > 0 && distance(entry.position, position) <= range) strongestShield = Math.max(strongestShield, shield);
    }
    if (strongestShield > 0) amount *= 1 - strongestShield;
  }
  enemy.hp -= amount;
  if (enemy.hp > 0) return false;
  enemy.hp = 0;
  enemy.rewardGranted = true;
  const definition = ENEMY_DEFINITIONS[enemy.type];
  let drops = { ...(definition.drops ?? {}) };
  const sourceBase = state.world.enemyBases.find(base => base.id === enemy.sourceBaseId);
  if (['miner', 'oreCarrier'].includes(enemy.type)) {
    if (sourceBase?.type === 'tinCamp') drops = { stone: drops.stone ?? 2, tinOre: Math.max(1, drops.tinOre ?? 1) };
    if (sourceBase?.type === 'ironCamp') drops = { stone: drops.stone ?? 2, ironOre: Math.max(1, drops.ironOre ?? 1) };
  }
  addBundle(state, drops);
  resolveWaveEnemy(state, enemy, false);
  state.statistics.kills += 1;
  if (['siegeCaptain', 'steelCaptain', 'machineCommander', 'royalCommander'].includes(enemy.type)) {
    state.civilization.progress.bossesDefeated[enemy.type] = (state.civilization.progress.bossesDefeated[enemy.type] ?? 0) + 1;
  }
  events?.emit('combat:enemy-killed', { enemyId: enemy.id, position: enemyPosition(state, enemy), type: enemy.type, drops });
  return true;
}


function activeFriendlySquadById(state, squadId) {
  if (!squadId) return null;
  return (state.combat.friendlySquads ?? []).find(squad => squad.id === squadId && squad.hp > 0) ?? null;
}

function destroyFriendlySquad(state, squad, squadPoint, events) {
  squad.hp = 0;
  for (const other of state.combat.enemies) {
    if (other.engagedSquadId === squad.id) other.engagedSquadId = null;
  }
  events?.emit('friendly:squad-destroyed', { squadId: squad.id, position: squadPoint, originBaseId: squad.originBaseId });
  events?.emit('message', { text: `${friendlySquadDefinition(squad.type).name}が全滅しました。` });
}

function applyFriendlyDamage(state, squad, amount, events) {
  if (!squad || squad.hp <= 0 || amount <= 0) return;
  const definition = friendlySquadDefinition(squad.type);
  squad.combatCooldown = Math.max(squad.combatCooldown ?? 0, definition.recoveryDelaySeconds ?? 0);
  squad.hp = Math.max(0, squad.hp - amount);
  if (squad.hp <= 0) destroyFriendlySquad(state, squad, roadUnitPosition(state, squad), events);
}

function nearbyHeavyGuard(state, protectedSquad, protectedPoint) {
  if (protectedSquad.type === 'heavy') return null;
  const definition = FRIENDLY_SQUAD_DEFINITIONS.heavy;
  return (state.combat.friendlySquads ?? [])
    .filter(squad => squad.id !== protectedSquad.id && squad.type === 'heavy' && squad.hp > 0 && !['RECOVERING', 'READY'].includes(squad.status))
    .map(squad => ({ squad, gap: distance(roadUnitPosition(state, squad), protectedPoint) }))
    .filter(entry => entry.gap <= definition.guardRange)
    .sort((a, b) => a.gap - b.gap)[0]?.squad ?? null;
}

function acquireHuntEngagement(state, enemy, definition) {
  if (!definition.huntFriendlySquads || enemy.engagedSquadId) return;
  const squad = activeHuntSquadById(state, enemy.targetSquadId, enemy, definition);
  if (!squad) return;
  if (distance(enemyPosition(state, enemy), roadUnitPosition(state, squad)) > FRIENDLY_SQUAD_ATTACK_RANGE_METERS) return;
  enemy.engagedSquadId = squad.id;
  squad.engagedEnemyId ??= enemy.id;
}

function attackFriendlySquad(state, enemy, definition, deltaSeconds, events) {
  const squad = activeFriendlySquadById(state, enemy.engagedSquadId);
  if (!squad) {
    enemy.engagedSquadId = null;
    return false;
  }
  const enemyPoint = enemyPosition(state, enemy);
  const squadPoint = roadUnitPosition(state, squad);
  if (distance(enemyPoint, squadPoint) > FRIENDLY_SQUAD_ATTACK_RANGE_METERS) {
    enemy.engagedSquadId = null;
    if (squad.engagedEnemyId === enemy.id) squad.engagedEnemyId = null;
    return false;
  }
  const fieldDps = Math.max(1, (definition.cityDamage ?? 4) * 0.32 + (definition.barrierDps ?? 1) * 0.22);
  const totalDamage = fieldDps * deltaSeconds;
  const guard = nearbyHeavyGuard(state, squad, squadPoint);
  if (guard) {
    const guardDefinition = FRIENDLY_SQUAD_DEFINITIONS.heavy;
    const redirected = totalDamage * guardDefinition.guardShare;
    applyFriendlyDamage(state, guard, redirected, events);
    applyFriendlyDamage(state, squad, totalDamage - redirected, events);
  } else {
    applyFriendlyDamage(state, squad, totalDamage, events);
  }
  return true;
}

export class EnemySystem {
  constructor(events) { this.events = events; }

  invalidateAllPaths(state) {
    for (const enemy of state.combat.enemies) enemy.reroutePending = true;
  }

  updateEnemy(state, enemy, deltaSeconds, frame) {
    let remainingSeconds = Math.max(0, Number(deltaSeconds) || 0);
    if (enemy.departDelay > 0) {
      const waitingSeconds = Math.min(enemy.departDelay, remainingSeconds);
      enemy.departDelay = Math.max(0, enemy.departDelay - waitingSeconds);
      enemy.slowTimer = Math.max(0, (enemy.slowTimer ?? 0) - waitingSeconds);
      remainingSeconds -= waitingSeconds;
      if (remainingSeconds <= 1e-9) return false;
    }

    const baseDefinition = ENEMY_DEFINITIONS[enemy.type] ?? ENEMY_DEFINITIONS.infantry;
    enemy.radius = Math.max(1, Number(enemy.radius) || Number(baseDefinition.radius) || 5);
    enemy.doctrineKey ??= 'frontal';
    enemy.targetDefenseId ??= null;
    enemy.targetFieldBaseId ??= null;
    enemy.targetPlayerBaseId ??= null;
    enemy.targetSquadId ??= null;
    const definition = scaleEnemyDefinition(baseDefinition, enemy.level ?? 1);

    acquireHuntEngagement(state, enemy, definition);
    if (attackFriendlySquad(state, enemy, definition, remainingSeconds, this.events)) {
      enemy.slowTimer = Math.max(0, (enemy.slowTimer ?? 0) - remainingSeconds);
      return false;
    }
    if (attackTargetFacility(state, enemy, definition, remainingSeconds, this.events)) {
      enemy.slowTimer = Math.max(0, (enemy.slowTimer ?? 0) - remainingSeconds);
      return false;
    }

    let transitions = 0;
    while (remainingSeconds > 1e-9 && transitions < 4096) {
      if (!ensurePath(state, enemy) || !enemy.edgeId) {
        enemy.slowTimer = Math.max(0, (enemy.slowTimer ?? 0) - remainingSeconds);
        return false;
      }
      const graph = state.world.roadGraph;
      const edge = graph.edgeById.get(enemy.edgeId);
      if (!edge) { enemy.path = null; return false; }

      const barrier = frame.barriers.get(edge.id) ?? null;
      const barrierPosition = edge.length * 0.5;
      const atBarrier = barrier && enemy.edgeProgress >= barrierPosition - 1 && enemy.edgeProgress <= barrierPosition + 2;
      if (atBarrier) {
        const timeToStrike = Math.max(0, 0.5 - (Number(enemy.attackClock) || 0));
        if (remainingSeconds + 1e-9 < timeToStrike) {
          enemy.attackClock = (Number(enemy.attackClock) || 0) + remainingSeconds;
          enemy.slowTimer = Math.max(0, (enemy.slowTimer ?? 0) - remainingSeconds);
          return false;
        }
        remainingSeconds = Math.max(0, remainingSeconds - timeToStrike);
        enemy.slowTimer = Math.max(0, (enemy.slowTimer ?? 0) - timeToStrike);
        enemy.attackClock = 0;
        barrier.hp -= definition.barrierDps * 0.5;
        if (barrier.hp > 0) continue;
        barrier.hp = 0;
        const destroyed = detachDefense(state, barrier.id) ?? barrier;
        beginEnemyRegroup(state, RECOVERY_BALANCE.defenseBreakthroughRegroupSeconds);
        frame.barriers.delete(edge.id);
        this.invalidateAllPaths(state);
        const a = graph.nodeById.get(edge.a);
        const b = graph.nodeById.get(edge.b);
        this.events?.emit('combat:defense-destroyed', { defenseId: destroyed.id, defense: destroyed, position: a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null });
        this.events?.emit('message', { text: `${destroyed.isGate ? '門' : '防壁'}が破壊され、道路から撤去されました。` });
        continue;
      }

      let commandMultiplier = 1;
      const position = enemyPosition(state, enemy);
      for (const entry of frame.spatial.speedAuras ?? frame.spatial.commanders ?? []) {
        if (entry.enemy.id === enemy.id || entry.enemy.hp <= 0) continue;
        const auraDefinition = ENEMY_DEFINITIONS[entry.enemy.type] ?? {};
        const aura = Math.max(0, Number(auraDefinition.speedAura ?? auraDefinition.commanderAura) || 0);
        const range = Math.max(1, Number(auraDefinition.auraRange) || 35);
        if (aura > 0 && distance(entry.position, position) <= range) commandMultiplier = Math.max(commandMultiplier, 1 + aura);
      }
      const slowBase = enemy.slowMultiplier ?? 0.52;
      const slowMultiplier = enemy.slowTimer > 0
        ? 1 - (1 - slowBase) * (1 - (definition.slowResistance ?? 0))
        : 1;
      const movementSpeed = Math.max(0.001, definition.speed * commandMultiplier * slowMultiplier);
      const slowWindow = enemy.slowTimer > 0 ? Math.min(remainingSeconds, enemy.slowTimer) : remainingSeconds;

      if (barrier && enemy.edgeProgress < barrierPosition - 1) {
        const distanceToBarrier = barrierPosition - 1 - enemy.edgeProgress;
        const timeToBarrier = distanceToBarrier / movementSpeed;
        if (timeToBarrier <= slowWindow + 1e-9) {
          enemy.edgeProgress = barrierPosition - 1;
          remainingSeconds = Math.max(0, remainingSeconds - timeToBarrier);
          enemy.slowTimer = Math.max(0, (enemy.slowTimer ?? 0) - timeToBarrier);
          continue;
        }
      }

      const distanceToNode = Math.max(0, edge.length - enemy.edgeProgress);
      const timeToNode = distanceToNode / movementSpeed;
      if (timeToNode > slowWindow + 1e-9) {
        enemy.edgeProgress += movementSpeed * slowWindow;
        remainingSeconds = Math.max(0, remainingSeconds - slowWindow);
        enemy.slowTimer = Math.max(0, (enemy.slowTimer ?? 0) - slowWindow);
        continue;
      }

      enemy.edgeProgress = edge.length;
      remainingSeconds = Math.max(0, remainingSeconds - timeToNode);
      enemy.slowTimer = Math.max(0, (enemy.slowTimer ?? 0) - timeToNode);
      enemy.nodeId = enemy.path.nodeIds[enemy.pathIndex + 1];
      enemy.pathIndex += 1;
      enemy.edgeProgress = 0;
      transitions += 1;

      if (enemy.reroutePending && enemy.nodeId !== enemy.path.targetId) {
        enemy.path = null;
        enemy.pathIndex = 0;
        enemy.edgeId = null;
        enemy.reroutePending = false;
        continue;
      }

      if (enemy.nodeId === enemy.path.targetId && enemy.targetPlayerBaseId) {
        const majorBase = playerBaseById(state, enemy.targetPlayerBaseId, { includeDestroyed: false });
        if (majorBase && majorBase.nodeId === enemy.path.targetId) {
          majorBase.hp = Math.max(0, majorBase.hp - definition.cityDamage);
          this.events?.emit('combat:player-base-hit', { baseId: majorBase.id, damage: definition.cityDamage, enemyId: enemy.id });
          if (majorBase.hp <= 0) destroyPlayerBase(state, majorBase, this.events, { enemyId: enemy.id });
          resolveWaveEnemy(state, enemy, true);
          return true;
        }
        enemy.targetPlayerBaseId = null;
        enemy.path = null;
        enemy.edgeId = null;
        continue;
      }

      if (enemy.nodeId === enemy.path.targetId && enemy.targetFieldBaseId) {
        const fieldBase = activeFieldBaseById(state, enemy.targetFieldBaseId);
        if (fieldBase && fieldBase.nodeId === enemy.path.targetId) {
          fieldBase.hp = Math.max(0, fieldBase.hp - definition.cityDamage);
          this.events?.emit('combat:field-base-hit', { baseId: fieldBase.id, damage: definition.cityDamage, enemyId: enemy.id });
          if (fieldBase.hp <= 0) destroyFieldBase(state, fieldBase, this.events, { enemyId: enemy.id });
          resolveWaveEnemy(state, enemy, true);
          return true;
        }
        enemy.targetFieldBaseId = null;
        enemy.path = null;
        enemy.edgeId = null;
        continue;
      }

      if (enemy.nodeId === enemy.path.targetId && enemy.path.targetId === state.world.city.nodeId) {
        state.world.city.hp = Math.max(0, state.world.city.hp - definition.cityDamage);
        state.combat.cityRecoveryCooldown = CITY_RECOVERY_DELAY_SECONDS;
        if ((definition.settlementDamage ?? 0) > 0) {
          state.combat.pendingSettlementDamage ??= [];
          state.combat.pendingSettlementDamage.push({ enemyId: enemy.id, enemyType: enemy.type, damage: definition.settlementDamage });
        }
        resolveWaveEnemy(state, enemy, true);
        this.events?.emit('combat:city-hit', { damage: definition.cityDamage, enemyId: enemy.id });
        return true;
      }

      if (enemy.pathIndex >= enemy.path.edgeIds.length) {
        enemy.edgeId = null;
        return false;
      }
      enemy.edgeId = enemy.path.edgeIds[enemy.pathIndex];
    }
    return false;
  }

  update(state, deltaSeconds, spatial = null, shouldUpdate = null) {
    if (!spatial) {
      const positions = new Map();
      const commanders = [];
      const speedAuras = [];
      const entries = [];
      for (const enemy of state.combat.enemies) {
        if (enemy.hp <= 0 || enemy.departDelay > 0) continue;
        const position = enemyPosition(state, enemy);
        const entry = { enemy, position };
        positions.set(enemy.id, position);
        entries.push(entry);
        if (enemy.type === 'commander') commanders.push(entry);
        const auraDefinition = ENEMY_DEFINITIONS[enemy.type] ?? {};
        if ((auraDefinition.speedAura ?? auraDefinition.commanderAura ?? 0) > 0) speedAuras.push(entry);
      }
      spatial = {
        positions,
        commanders,
        speedAuras,
        query(point, range) {
          const limit = range * range;
          return entries.filter(entry => {
            const dx = entry.position.x - point.x;
            const dy = entry.position.y - point.y;
            return dx * dx + dy * dy <= limit;
          });
        }
      };
    }
    const barriers = new Map();
    for (const defense of state.combat.defenses) {
      if (defense.kind === 'barrier' && defense.hp > 0) barriers.set(defense.edgeId, defense);
    }
    const frame = { spatial, barriers };
    const remove = new Set();
    for (const enemy of state.combat.enemies) {
      if (enemy.hp <= 0) { remove.add(enemy.id); continue; }
      if (shouldUpdate && !shouldUpdate(enemy)) continue;
      if (this.updateEnemy(state, enemy, deltaSeconds, frame)) remove.add(enemy.id);
    }
    if (remove.size > 0) state.combat.enemies = state.combat.enemies.filter(enemy => !remove.has(enemy.id) && enemy.hp > 0);
  }
}
