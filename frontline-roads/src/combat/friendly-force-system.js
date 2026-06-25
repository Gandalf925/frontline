import { consumeBundle, missingBundle } from '../civilization/inventory-system.js';
import { repairCostForDefense } from '../civilization/repair-cost.js';
import { activePlayerBases, ensurePlayerBaseState } from '../base/player-bases.js';
import { deploymentBases, ensureFieldBaseState, ownedBaseById } from '../base/field-bases.js';
import { distance, stableId } from '../core/utilities.js';
import { findRoadPath } from './routing-system.js';
import { damageEnemy, enemyPosition } from './enemy-system.js';
import { destroyEnemyBase } from './enemy-base-system.js';
import { spawnEnemyBaseGuard } from './wave-system.js';
import { roadUnitPosition } from './road-unit-position.js';
import {
  FRIENDLY_RECOVERY_STATUS,
  beginFriendlyRecovery,
  recoveryPresentation,
  updateFriendlyRecovery
} from './friendly-recovery-system.js';
import {
  FRIENDLY_SQUAD_DEFINITIONS,
  friendlySquadRuntimeDefinition,
  friendlySquadEnemyDamage,
  friendlySquadUnlocked
} from './friendly-force-definitions.js';
import { defenseRuntimeDefinition } from './definitions.js';
import {
  RECOVERY_ITEM_STATUS,
  SQUAD_RECOVERY_COLLECTION_DURATION_SECONDS,
  deliverRecoveryItem,
  markRecoveryItemCarried,
  recoveryItemPoint,
  recoveryItemPresentation,
  releaseRecoveryItem,
  reserveRecoveryItem
} from '../exploration/recovery-system.js';

export { FRIENDLY_SQUAD_DEFINITIONS, FRIENDLY_SQUAD_TYPES } from './friendly-force-definitions.js';

export const FRIENDLY_SQUAD_STATUS = Object.freeze({
  OUTBOUND: 'OUTBOUND',
  ENGAGED: 'ENGAGED',
  ATTACKING_BASE: 'ATTACKING_BASE',
  COLLECTING_ITEM: 'COLLECTING_ITEM',
  HALTED: 'HALTED',
  RETREATING: 'RETREATING',
  WITHDRAWING: 'WITHDRAWING',
  RETURNING: 'RETURNING',
  STRANDED: 'STRANDED',
  RECOVERING: FRIENDLY_RECOVERY_STATUS.RECOVERING,
  READY: FRIENDLY_RECOVERY_STATUS.READY
});

export const FRIENDLY_SQUAD_MISSION = Object.freeze({ ATTACK: 'ATTACK', INTERCEPT: 'INTERCEPT', RECOVERY: 'RECOVERY' });

export const FRIENDLY_SQUAD_ORDER = Object.freeze({
  ADVANCE: 'ADVANCE',
  HOLD: 'HOLD',
  RETREAT: 'RETREAT',
  WITHDRAW: 'WITHDRAW',
  RETURN: 'RETURN'
});

const VALID_STATUS = new Set(Object.values(FRIENDLY_SQUAD_STATUS));
const VALID_ORDER = new Set(Object.values(FRIENDLY_SQUAD_ORDER));

const FRIENDLY_GLOBAL_COMMAND_LIMITS = Object.freeze([6, 10, 14, 18, 22, 28, 34, 40]);
const FRIENDLY_MAJOR_BASE_CAPACITY = Object.freeze([2, 3, 4, 5, 6, 7, 8, 9]);
const FRIENDLY_COORDINATED_LIMITS = Object.freeze([3, 3, 4, 5, 6, 7, 8, 8]);

function civilizationTableValue(table, state) {
  const index = Math.max(0, Math.min(table.length - 1, Math.floor(Number(state.civilization?.level) || 0)));
  return table[index];
}

export function friendlyGlobalCommandLimit(state) { return civilizationTableValue(FRIENDLY_GLOBAL_COMMAND_LIMITS, state); }
export function friendlyCoordinatedDeploymentLimit(state) { return civilizationTableValue(FRIENDLY_COORDINATED_LIMITS, state); }
export function friendlyGlobalCommandStatus(state) {
  const assigned = (state.combat?.friendlySquads ?? []).filter(squad => squad.hp > 0).length;
  const capacity = friendlyGlobalCommandLimit(state);
  return { capacity, assigned, available: Math.max(0, capacity - assigned) };
}

function statusForOrder(order) {
  if (order === FRIENDLY_SQUAD_ORDER.HOLD) return FRIENDLY_SQUAD_STATUS.HALTED;
  if (order === FRIENDLY_SQUAD_ORDER.RETREAT) return FRIENDLY_SQUAD_STATUS.RETREATING;
  if (order === FRIENDLY_SQUAD_ORDER.WITHDRAW) return FRIENDLY_SQUAD_STATUS.WITHDRAWING;
  if (order === FRIENDLY_SQUAD_ORDER.RETURN) return FRIENDLY_SQUAD_STATUS.RETURNING;
  return FRIENDLY_SQUAD_STATUS.OUTBOUND;
}

function normalizePath(path) {
  if (!path || !Array.isArray(path.nodeIds) || !Array.isArray(path.edgeIds)) return null;
  return {
    nodeIds: [...path.nodeIds],
    edgeIds: [...path.edgeIds],
    cost: Math.max(0, Number(path.cost) || 0),
    targetId: path.targetId ?? path.nodeIds[path.nodeIds.length - 1] ?? null
  };
}

export function ensureFriendlyForceState(state) {
  ensurePlayerBaseState(state);
  ensureFieldBaseState(state);
  state.combat.friendlySquads = Array.isArray(state.combat.friendlySquads) ? state.combat.friendlySquads : [];
  for (const squad of state.combat.friendlySquads) {
    const definition = friendlySquadRuntimeDefinition(state, squad.type);
    squad.type = definition.type;
    const previousMaxHp = Math.max(1, Number(squad.maxHp) || definition.hp);
    const previousHp = Math.max(0, Math.min(previousMaxHp, Number(squad.hp ?? previousMaxHp) || 0));
    squad.maxHp = Math.max(1, definition.hp);
    squad.hp = Math.max(0, Math.min(squad.maxHp, previousMaxHp === squad.maxHp ? previousHp : previousHp / previousMaxHp * squad.maxHp));
    squad.status = VALID_STATUS.has(squad.status) ? squad.status : FRIENDLY_SQUAD_STATUS.OUTBOUND;
    squad.order = VALID_ORDER.has(squad.order)
      ? squad.order
      : squad.status === FRIENDLY_SQUAD_STATUS.RETURNING
        ? FRIENDLY_SQUAD_ORDER.RETURN
        : FRIENDLY_SQUAD_ORDER.ADVANCE;
    squad.missionType = squad.missionType === FRIENDLY_SQUAD_MISSION.RECOVERY || definition.missionKind === 'RECOVERY'
      ? FRIENDLY_SQUAD_MISSION.RECOVERY
      : squad.missionType === FRIENDLY_SQUAD_MISSION.INTERCEPT || squad.targetEnemyId
        ? FRIENDLY_SQUAD_MISSION.INTERCEPT
        : FRIENDLY_SQUAD_MISSION.ATTACK;
    squad.missionTargetBaseId ??= squad.targetBaseId ?? null;
    squad.targetEnemyId ??= null;
    squad.targetRecoveryItemId ??= null;
    squad.recoveryCollectionProgressSec = squad.recoveryCollectionProgressSec == null
      ? null
      : Math.max(0, Math.min(SQUAD_RECOVERY_COLLECTION_DURATION_SECONDS, Number(squad.recoveryCollectionProgressSec) || 0));
    squad.commandDestinationNodeId ??= squad.path?.targetId ?? null;
    squad.heldOrder = VALID_ORDER.has(squad.heldOrder) ? squad.heldOrder : null;
    squad.heldDestinationNodeId ??= null;
    squad.pathIndex = Math.max(0, Number(squad.pathIndex) || 0);
    squad.edgeProgress = Math.max(0, Number(squad.edgeProgress) || 0);
    squad.combatCooldown = Math.max(0, Number(squad.combatCooldown) || 0);
    squad.departDelay = Math.max(0, Number(squad.departDelay) || 0);
    squad.formationId ??= null;
    squad.formationTargetId ??= null;
    squad.formationSpeed = squad.formationSpeed == null ? null : Math.max(0.1, Number(squad.formationSpeed) || 0.1);
    squad.formationSize = squad.formationSize == null ? null : Math.max(1, Math.floor(Number(squad.formationSize) || 1));
    squad.engagedEnemyId ??= null;
    squad.path = normalizePath(squad.path);
    squad.travelHistoryNodeIds = Array.isArray(squad.travelHistoryNodeIds) && squad.travelHistoryNodeIds.length
      ? [...squad.travelHistoryNodeIds]
      : [squad.nodeId].filter(Boolean);
    squad.recoveryBaseId ??= null;
    squad.recoveryStartedAt = Number(squad.recoveryStartedAt) || null;
    squad.reorganizationRemaining = Math.max(0, Number(squad.reorganizationRemaining) || 0);
    delete squad.recoveryTargetHp;
    delete squad.recoveryFacilityType;
    delete squad.recoveryFacilityId;
    squad.readyAt = Number(squad.readyAt) || null;
  }
  return state.combat.friendlySquads;
}

export function friendlySquadPosition(state, squad) {
  return roadUnitPosition(state, squad);
}

export function friendlySquadById(state, squadId) {
  return (state.combat?.friendlySquads ?? []).find(squad => squad.id === squadId && squad.hp > 0) ?? null;
}

function squadsFromBase(state, baseId) {
  return (state.combat?.friendlySquads ?? []).filter(squad => squad.originBaseId === baseId && squad.hp > 0);
}

function fieldBarracksCapacityBonus(state, baseId) {
  if (!baseId) return 0;
  const facility = (state.combat?.defenses ?? []).find(defense =>
    defense.type === 'fieldBarracks'
    && defense.baseId === baseId
    && defense.hp > 0
    && (defense.disabledTimer ?? 0) <= 0
  );
  if (!facility) return 0;
  return Math.max(0, Math.floor(Number(defenseRuntimeDefinition(facility).squadCapacityBonus) || 0));
}

export function friendlySquadCapacityForBase(state, baseOrId) {
  const base = typeof baseOrId === 'string' ? ownedBaseById(state, baseOrId, { includeDestroyed: true }) : baseOrId;
  if (!base) return 0;
  const civilizationLevel = Math.max(0, Math.floor(Number(state.civilization?.level) || 0));
  if (base.kind === 'FIELD') {
    return 2 + Math.floor(civilizationLevel / 2) + fieldBarracksCapacityBonus(state, base.id);
  }
  return FRIENDLY_MAJOR_BASE_CAPACITY[Math.min(FRIENDLY_MAJOR_BASE_CAPACITY.length - 1, civilizationLevel)];
}

export function friendlySquadCapacityStatus(state, baseOrId) {
  const base = typeof baseOrId === 'string' ? ownedBaseById(state, baseOrId, { includeDestroyed: true }) : baseOrId;
  if (!base) return { capacity: 0, assigned: 0, active: 0, recovering: 0, ready: 0, available: 0 };
  const squads = squadsFromBase(state, base.id);
  const recovering = squads.filter(squad => squad.status === FRIENDLY_SQUAD_STATUS.RECOVERING).length;
  const ready = squads.filter(squad => squad.status === FRIENDLY_SQUAD_STATUS.READY).length;
  const active = squads.length - recovering - ready;
  const capacity = friendlySquadCapacityForBase(state, base);
  return { capacity, assigned: squads.length, active, recovering, ready, available: Math.max(0, capacity - squads.length) };
}

function garrisonSquadsFromBase(state, baseId) {
  return squadsFromBase(state, baseId).filter(squad => [FRIENDLY_SQUAD_STATUS.READY, FRIENDLY_SQUAD_STATUS.RECOVERING].includes(squad.status));
}

function planningReservationCount(planning, baseId) {
  return Math.max(0, Number(planning?.additionalSquadsByBase?.get(baseId)) || 0);
}

function planningSquadReserved(planning, squadId) {
  return Boolean(squadId && planning?.reservedSquadIds?.has(squadId));
}

function planningTypeReservationCount(planning, baseId, squadType) {
  return Math.max(0, Number(planning?.squadTypesByBase?.get(`${baseId}:${squadType}`)) || 0);
}

function reservePlanningSlot(planning, preview) {
  if (!planning || !preview?.origin) return;
  if (preview.garrison?.id) planning.reservedSquadIds.add(preview.garrison.id);
  else {
    planning.additionalSquadsByBase.set(
      preview.origin.id,
      planningReservationCount(planning, preview.origin.id) + 1
    );
  }
  if (!preview.reuseReadySquad) {
    const key = `${preview.origin.id}:${preview.definition.type}`;
    planning.squadTypesByBase.set(key, planningTypeReservationCount(planning, preview.origin.id, preview.definition.type) + 1);
  }
}

export function enemyPursuitNodeId(state, enemy) {
  const graph = state.world?.roadGraph;
  if (!graph || !enemy) return null;
  const pathNodeIds = Array.isArray(enemy.path?.nodeIds) ? enemy.path.nodeIds : [];
  const nextNodeId = pathNodeIds.length
    ? pathNodeIds[Math.min(Math.max(0, Number(enemy.pathIndex) || 0) + 1, pathNodeIds.length - 1)]
    : null;
  if (nextNodeId && graph.nodeById.has(nextNodeId)) return nextNodeId;
  return graph.nodeById.has(enemy.nodeId) ? enemy.nodeId : null;
}

function deploymentTarget(state, definition, targetId, targetKind = 'enemyBase') {
  if (definition.missionKind === 'RECOVERY') {
    if (state.world.recoveryCollection?.itemId === targetId) return null;
    const item = (state.world?.recoveryItems ?? []).find(value => value.id === targetId && value.status === RECOVERY_ITEM_STATUS.AVAILABLE) ?? null;
    return item ? { target: item, nodeId: item.nodeId, missionType: FRIENDLY_SQUAD_MISSION.RECOVERY, targetKind: 'recoveryItem' } : null;
  }
  if (targetKind === 'enemy') {
    const enemy = state.combat.enemies.find(value => value.id === targetId && value.hp > 0 && value.departDelay <= 0) ?? null;
    const nodeId = enemyPursuitNodeId(state, enemy);
    return enemy && nodeId ? { target: enemy, nodeId, missionType: FRIENDLY_SQUAD_MISSION.INTERCEPT, targetKind: 'enemy' } : null;
  }
  const base = state.world.enemyBases.find(value => value.id === targetId && value.alive && value.hp > 0) ?? null;
  return base ? { target: base, nodeId: base.nodeId, missionType: FRIENDLY_SQUAD_MISSION.ATTACK, targetKind: 'enemyBase' } : null;
}

function unavailableTargetReason(definition, targetKind) {
  if (definition.missionKind === 'RECOVERY') return '回収可能な特殊アイテムではありません。';
  if (targetKind === 'enemy') return '迎撃可能な敵部隊ではありません。';
  return '攻撃可能な敵拠点ではありません。';
}

function unreachableTargetReason(definition, targetKind) {
  if (definition.missionKind === 'RECOVERY') return '回収地点へ到達できる道路経路がありません。';
  if (targetKind === 'enemy') return '敵部隊の進路へ到達できる道路経路がありません。';
  return '敵拠点へ到達できる道路経路がありません。';
}

export function previewFriendlyDeployment(state, squadType, originBaseId, targetId, planning = null, targetKind = 'enemyBase') {
  const baseDefinition = FRIENDLY_SQUAD_DEFINITIONS[squadType];
  if (!baseDefinition) return { ok: false, reason: '選択した部隊種類は存在しません。' };
  const definition = friendlySquadRuntimeDefinition(state, squadType);
  if (!friendlySquadUnlocked(state, squadType)) return { ok: false, reason: `${definition.name}は文明Lv.${definition.unlockLevel}で解禁されます。`, definition };
  const origin = ownedBaseById(state, originBaseId);
  if (!origin || origin.status !== 'ESTABLISHED' || origin.hp <= 0) return { ok: false, reason: '出撃可能な拠点ではありません。', definition };
  if (!deploymentBases(state, squadType).some(base => base.id === origin.id)) return { ok: false, reason: `この拠点から${definition.name}は派兵できません。`, definition };
  const resolved = deploymentTarget(state, definition, targetId, targetKind);
  if (!resolved) return { ok: false, reason: unavailableTargetReason(definition, targetKind), definition };
  const path = findRoadPath(state, origin.nodeId, resolved.nodeId);
  if (!path) return { ok: false, reason: unreachableTargetReason(definition, targetKind), definition };

  const assignedSquads = squadsFromBase(state, origin.id);
  const capacity = friendlySquadCapacityForBase(state, origin);
  const plannedAdditional = planningReservationCount(planning, origin.id);
  const availableGarrisons = garrisonSquadsFromBase(state, origin.id)
    .filter(squad => !planningSquadReserved(planning, squad.id));
  const reusableGarrison = availableGarrisons.find(squad => squad.status === FRIENDLY_SQUAD_STATUS.READY && squad.type === squadType) ?? null;
  const canCreateNewSquad = assignedSquads.length + plannedAdditional < capacity;
  const replaceableGarrison = !reusableGarrison && !canCreateNewSquad
    ? availableGarrisons.find(squad => squad.status === FRIENDLY_SQUAD_STATUS.READY && squad.type !== squadType) ?? null
    : null;
  const plannedGlobal = planning ? [...planning.additionalSquadsByBase.values()].reduce((total, value) => total + value, 0) : 0;
  const globalStatus = friendlyGlobalCommandStatus(state);
  if (!reusableGarrison && !replaceableGarrison && globalStatus.assigned + plannedGlobal >= globalStatus.capacity) {
    return { ok: false, reason: `全体指揮上限に達しています（${globalStatus.assigned + plannedGlobal}/${globalStatus.capacity}）。既存部隊を帰還・再編成してから派兵してください。`, definition, origin, target: resolved.target, missionType: resolved.missionType, path, routeDistance: path.cost };
  }
  const plannedTypeCount = planningTypeReservationCount(planning, origin.id, squadType);
  if (definition.maxPerBase && !reusableGarrison && assignedSquads.filter(squad => squad.type === squadType).length + plannedTypeCount >= definition.maxPerBase) {
    return { ok: false, reason: `${definition.name}は主要拠点ごとに${definition.maxPerBase}隊までです。`, definition, origin, target: resolved.target, missionType: resolved.missionType, path, routeDistance: path.cost };
  }
  if (!reusableGarrison && !canCreateNewSquad && !replaceableGarrison) {
    const capacityStatus = friendlySquadCapacityStatus(state, origin);
    const recoveryNote = capacityStatus.recovering ? `・回復中 ${capacityStatus.recovering}` : '';
    return {
      ok: false,
      reason: `この拠点の部隊枠が満員です（${capacityStatus.assigned + plannedAdditional}/${capacity}${recoveryNote}）。文明レベルを上げるか、待機部隊を再編成してください。`,
      definition,
      origin,
      target: resolved.target,
      missionType: resolved.missionType,
      path,
      routeDistance: path.cost,
      capacity,
      assignedSquads: capacityStatus.assigned,
      plannedAdditional
    };
  }
  const garrison = reusableGarrison ?? replaceableGarrison;
  const reuseReadySquad = Boolean(reusableGarrison);
  const replaceReadySquad = Boolean(replaceableGarrison);
  const deploymentCost = reuseReadySquad ? {} : definition.cost;
  const missing = missingBundle(state, deploymentCost);
  return {
    ok: Object.keys(missing).length === 0,
    reason: Object.keys(missing).length ? '派兵に必要な資源が不足しています。' : null,
    origin,
    target: resolved.target,
    missionType: resolved.missionType,
    targetKind: resolved.targetKind,
    path,
    routeDistance: path.cost,
    cost: { ...deploymentCost },
    missing,
    definition,
    garrison,
    reuseReadySquad,
    replaceReadySquad,
    capacity,
    assignedSquads: assignedSquads.length,
    availableSlots: Math.max(0, capacity - assignedSquads.length - plannedAdditional)
  };
}

function instantiateFriendlySquad(state, preview, squadType, originBaseId, targetId, events = null, formation = null) {
  const definition = preview.definition;
  const worldTime = state.runtime?.worldTimeMs ?? Date.now();
  const squadId = preview.reuseReadySquad && preview.garrison
    ? preview.garrison.id
    : stableId('friendly_squad', definition.type, originBaseId, targetId, worldTime, state.combat.friendlySquads.length);
  if (preview.replaceReadySquad && preview.garrison) {
    state.combat.friendlySquads = state.combat.friendlySquads.filter(item => item.id !== preview.garrison.id);
  }
  const squad = preview.reuseReadySquad && preview.garrison ? preview.garrison : {
    id: squadId,
    type: definition.type, hp: definition.hp, maxHp: definition.hp, members: definition.members, originBaseId, deployedAt: worldTime
  };
  Object.assign(squad, {
    type: definition.type,
    members: definition.members,
    missionType: preview.missionType,
    originBaseId,
    targetBaseId: preview.missionType === FRIENDLY_SQUAD_MISSION.ATTACK ? targetId : null,
    missionTargetBaseId: preview.missionType === FRIENDLY_SQUAD_MISSION.ATTACK ? targetId : null,
    targetEnemyId: preview.missionType === FRIENDLY_SQUAD_MISSION.INTERCEPT ? targetId : null,
    targetRecoveryItemId: preview.missionType === FRIENDLY_SQUAD_MISSION.RECOVERY ? targetId : null,
    recoveryCollectionProgressSec: null,
    nodeId: preview.origin.nodeId,
    path: normalizePath(preview.path), pathIndex: 0, edgeId: preview.path.edgeIds[0] ?? null, edgeProgress: 0,
    status: FRIENDLY_SQUAD_STATUS.OUTBOUND, order: FRIENDLY_SQUAD_ORDER.ADVANCE,
    commandDestinationNodeId: preview.path.targetId, travelHistoryNodeIds: [preview.origin.nodeId],
    engagedEnemyId: null, combatCooldown: 0, departDelay: Math.max(0, Number(formation?.departDelay) || 0),
    formationId: formation?.id ?? null,
    formationTargetId: formation?.targetId ?? null,
    formationSpeed: formation?.speed ?? null,
    formationSize: formation?.size ?? null,
    recoveryBaseId: null, recoveryStartedAt: null, reorganizationRemaining: 0,
    readyAt: null, deployedAt: worldTime
  });
  if (!preview.reuseReadySquad) state.combat.friendlySquads.push(squad);
  events?.emit('friendly:squad-deployed', { squad, origin: preview.origin, target: preview.target, cost: preview.cost, redeployed: preview.reuseReadySquad, formationId: formation?.id ?? null });
  const targetLabel = preview.missionType === FRIENDLY_SQUAD_MISSION.RECOVERY
    ? `${recoveryItemPresentation(preview.target).name}の回収へ`
    : preview.missionType === FRIENDLY_SQUAD_MISSION.INTERCEPT
      ? '指定敵部隊の迎撃へ'
      : '';
  events?.emit('message', { text: preview.reuseReadySquad ? `${preview.origin.name}から${definition.name}が${targetLabel || '再'}出撃しました。` : `${preview.origin.name}から${definition.name}が${targetLabel || ''}出撃しました。` });
  return { squad, cost: preview.cost, routeDistance: preview.routeDistance, redeployed: preview.reuseReadySquad, replaced: preview.replaceReadySquad };
}

export function dispatchFriendlySquad(state, squadType, originBaseId, targetId, events = null, targetKind = 'enemyBase') {
  const preview = previewFriendlyDeployment(state, squadType, originBaseId, targetId, null, targetKind);
  if (!preview.ok) return preview;

  let reservation = null;
  const squadId = preview.reuseReadySquad && preview.garrison
    ? preview.garrison.id
    : stableId('friendly_squad', preview.definition.type, originBaseId, targetId, state.runtime?.worldTimeMs ?? Date.now(), state.combat.friendlySquads.length);
  if (preview.missionType === FRIENDLY_SQUAD_MISSION.RECOVERY) {
    reservation = reserveRecoveryItem(state, targetId, squadId);
    if (!reservation.ok) return reservation;
  }

  if (!consumeBundle(state, preview.cost)) {
    if (reservation) releaseRecoveryItem(state, targetId, squadId);
    return { ok: false, reason: '派兵確定時に資源が不足しました。' };
  }
  const result = instantiateFriendlySquad(state, preview, squadType, originBaseId, targetId, events);
  return { ok: true, ...result };
}

function addCost(total, bundle) {
  for (const [resource, amount] of Object.entries(bundle ?? {})) total[resource] = (total[resource] ?? 0) + amount;
  return total;
}

export function previewCoordinatedDeployment(state, targetId, squadTypes) {
  const requested = (Array.isArray(squadTypes) ? squadTypes : [])
    .filter(type => FRIENDLY_SQUAD_DEFINITIONS[type]?.missionKind !== 'RECOVERY')
    .slice(0, friendlyCoordinatedDeploymentLimit(state))
    .map((type, index) => ({ type, index, definition: FRIENDLY_SQUAD_DEFINITIONS[type] ? friendlySquadRuntimeDefinition(state, type) : null }))
    .filter(item => item.definition);
  if (requested.length < 2) return { ok: false, reason: '連携出撃には2部隊以上を選択してください。', assignments: [], squadTypes: requested.map(item => item.type) };
  const target = state.world.enemyBases.find(base => base.id === targetId && base.alive && base.hp > 0) ?? null;
  if (!target) return { ok: false, reason: '攻撃可能な敵拠点ではありません。', assignments: [] };

  const planning = {
    additionalSquadsByBase: new Map(),
    squadTypesByBase: new Map(),
    reservedSquadIds: new Set()
  };
  const assignments = [];
  const assignmentOrder = [...requested].sort((left, right) =>
    left.definition.allowedBaseKinds.length - right.definition.allowedBaseKinds.length
    || right.definition.unlockLevel - left.definition.unlockLevel
    || left.index - right.index
  );
  for (const item of assignmentOrder) {
    if (!friendlySquadUnlocked(state, item.type)) return { ok: false, reason: `${item.definition.name}は文明Lv.${item.definition.unlockLevel}で解禁されます。`, assignments };
    const candidates = deploymentBases(state, item.type)
      .map(base => previewFriendlyDeployment(state, item.type, base.id, targetId, planning, 'enemyBase'))
      .filter(preview => preview.origin && preview.path && !/部隊枠が満員/.test(preview.reason ?? ''))
      .sort((left, right) =>
        (left.routeDistance ?? Infinity) - (right.routeDistance ?? Infinity)
        || (right.availableSlots ?? 0) - (left.availableSlots ?? 0)
      );
    const selected = candidates[0] ?? null;
    if (!selected) return { ok: false, reason: `${item.definition.name}を出撃できる部隊枠がありません。`, assignments };
    reservePlanningSlot(planning, selected);
    assignments.push({ ...selected, squadType: item.type, requestIndex: item.index });
  }
  assignments.sort((left, right) => left.requestIndex - right.requestIndex);
  const cost = assignments.reduce((total, assignment) => addCost(total, assignment.cost), {});
  const missing = missingBundle(state, cost);
  const slowestSpeed = Math.min(...assignments.map(assignment => Math.max(0.1, Number(assignment.definition.speed) || 0.1)));
  const fastestSpeed = Math.max(...assignments.map(assignment => Math.max(0.1, Number(assignment.definition.speed) || 0.1)));
  const maximumDistance = Math.max(...assignments.map(assignment => Math.max(0, Number(assignment.routeDistance) || 0)));
  const estimatedArrivalSeconds = Math.max(...assignments.map(assignment => {
    const naturalSpeed = Math.max(0.1, Number(assignment.definition.speed) || 0.1);
    return Math.max(0, Number(assignment.routeDistance) || 0) / naturalSpeed;
  }));
  for (const assignment of assignments) {
    const naturalSpeed = Math.max(0.1, Number(assignment.definition.speed) || 0.1);
    assignment.synchronizedSpeed = naturalSpeed;
    assignment.travelSeconds = Math.max(0, Number(assignment.routeDistance) || 0) / naturalSpeed;
    assignment.departDelay = Math.max(0, estimatedArrivalSeconds - assignment.travelSeconds);
  }
  return {
    ok: Object.keys(missing).length === 0,
    reason: Object.keys(missing).length ? '連携出撃に必要な合計資源が不足しています。' : null,
    target,
    assignments,
    cost,
    missing,
    synchronizedSpeed: null,
    slowestSpeed,
    fastestSpeed,
    maximumRouteDistance: maximumDistance,
    estimatedArrivalSeconds
  };
}

export function dispatchCoordinatedSquads(state, targetId, squadTypes, events = null) {
  const preview = previewCoordinatedDeployment(state, targetId, squadTypes);
  if (!preview.ok) return preview;
  if (!consumeBundle(state, preview.cost)) return { ok: false, reason: '連携出撃確定時に合計資源が不足しました。', preview };
  const worldTime = state.runtime?.worldTimeMs ?? Date.now();
  const formation = {
    id: stableId('friendly_formation', targetId, worldTime, state.combat.friendlySquads.length),
    targetId,
    speed: null,
    size: preview.assignments.length
  };
  const squads = preview.assignments.map(assignment => instantiateFriendlySquad(
    state,
    { ...assignment, cost: {} },
    assignment.squadType,
    assignment.origin.id,
    targetId,
    events,
    { ...formation, speed: assignment.synchronizedSpeed, departDelay: assignment.departDelay }
  ).squad);
  events?.emit('friendly:formation-deployed', { formationId: formation.id, targetId, squadIds: squads.map(squad => squad.id), cost: preview.cost });
  events?.emit('message', { text: `${squads.length}部隊が連携出撃しました。各部隊の本来速度を維持し、出発時刻を調整して同時到着を目指します。` });
  return { ok: true, squads, formationId: formation.id, cost: preview.cost, estimatedArrivalSeconds: preview.estimatedArrivalSeconds };
}

export function previewAssaultDeployment(state, originBaseId, targetBaseId) { return previewFriendlyDeployment(state, 'assault', originBaseId, targetBaseId); }
export function dispatchAssaultSquad(state, originBaseId, targetBaseId, events = null) { return dispatchFriendlySquad(state, 'assault', originBaseId, targetBaseId, events); }

function clearEnemyEngagements(state, squadId) {
  for (const enemy of state.combat.enemies) {
    if (enemy.engagedSquadId === squadId) enemy.engagedSquadId = null;
  }
}

function appendHistory(squad, nodeId) {
  if (!nodeId) return;
  squad.travelHistoryNodeIds ??= [];
  if (squad.travelHistoryNodeIds[squad.travelHistoryNodeIds.length - 1] !== nodeId) squad.travelHistoryNodeIds.push(nodeId);
  if (squad.travelHistoryNodeIds.length > 96) squad.travelHistoryNodeIds.splice(0, squad.travelHistoryNodeIds.length - 96);
}

function routeMatchesGraph(state, route, expectedStartNodeId, expectedDestinationNodeId = null) {
  if (!route || route.nodeIds.length !== route.edgeIds.length + 1) return false;
  if (route.nodeIds[0] !== expectedStartNodeId) return false;
  if (expectedDestinationNodeId && route.nodeIds[route.nodeIds.length - 1] !== expectedDestinationNodeId) return false;
  for (let index = 0; index < route.edgeIds.length; index += 1) {
    const edge = state.world.roadGraph.edgeById.get(route.edgeIds[index]);
    const from = route.nodeIds[index];
    const to = route.nodeIds[index + 1];
    if (!edge || !((edge.a === from && edge.b === to) || (edge.a === to && edge.b === from))) return false;
  }
  return true;
}

function assignPathAtCurrentPosition(state, squad, route, expectedDestinationNodeId = null) {
  const normalized = normalizePath(route);
  if (!normalized) return false;
  const currentEdge = squad.edgeId ? state.world.roadGraph.edgeById.get(squad.edgeId) : null;
  const movingInsideEdge = Boolean(squad.edgeId && currentEdge && squad.edgeProgress > 0 && squad.edgeProgress < currentEdge.length);
  const nextNodeId = movingInsideEdge && squad.path?.nodeIds?.[squad.pathIndex + 1]
    ? squad.path.nodeIds[squad.pathIndex + 1]
    : squad.nodeId;
  if (!routeMatchesGraph(state, normalized, nextNodeId, expectedDestinationNodeId)) return false;
  if (movingInsideEdge) {
    const currentFrom = squad.path.nodeIds[squad.pathIndex];
    squad.path = {
      nodeIds: [currentFrom, ...normalized.nodeIds],
      edgeIds: [squad.edgeId, ...normalized.edgeIds],
      cost: Math.max(0, currentEdge.length - squad.edgeProgress) + normalized.cost,
      targetId: normalized.targetId
    };
    squad.pathIndex = 0;
    return true;
  }
  squad.path = normalized;
  squad.pathIndex = 0;
  squad.edgeId = normalized.edgeIds[0] ?? null;
  squad.edgeProgress = 0;
  squad.nodeId = normalized.nodeIds[0] ?? squad.nodeId;
  return true;
}

export function holdFriendlySquad(state, squadId, events = null) {
  const squad = friendlySquadById(state, squadId);
  if (!squad) return { ok: false, reason: '部隊が見つかりません。' };
  if ([FRIENDLY_SQUAD_STATUS.RECOVERING, FRIENDLY_SQUAD_STATUS.READY].includes(squad.status)) {
    return { ok: false, reason: '拠点で回復・待機中の部隊には移動命令を出せません。' };
  }
  if (squad.order === FRIENDLY_SQUAD_ORDER.WITHDRAW || squad.order === FRIENDLY_SQUAD_ORDER.RETURN) {
    return { ok: false, reason: '帰還中の部隊は停止命令へ変更できません。' };
  }
  if (squad.order !== FRIENDLY_SQUAD_ORDER.HOLD) {
    squad.heldOrder = squad.order;
    squad.heldDestinationNodeId = squad.commandDestinationNodeId;
  }
  squad.order = FRIENDLY_SQUAD_ORDER.HOLD;
  if (squad.status !== FRIENDLY_SQUAD_STATUS.ENGAGED) squad.status = FRIENDLY_SQUAD_STATUS.HALTED;
  events?.emit('friendly:squad-order', { squadId, order: squad.order });
  events?.emit('message', { text: '味方部隊へ停止命令を出しました。' });
  return { ok: true, squad };
}

export function issueFriendlyRouteOrder(state, squadId, { order, path, destinationNodeId }, events = null) {
  const squad = friendlySquadById(state, squadId);
  if (!squad) return { ok: false, reason: '部隊が見つかりません。' };
  if ([FRIENDLY_SQUAD_STATUS.RECOVERING, FRIENDLY_SQUAD_STATUS.READY].includes(squad.status)) {
    return { ok: false, reason: '拠点で回復・待機中の部隊には経路命令を出せません。' };
  }
  if (![FRIENDLY_SQUAD_ORDER.ADVANCE, FRIENDLY_SQUAD_ORDER.RETREAT, FRIENDLY_SQUAD_ORDER.WITHDRAW].includes(order)) {
    return { ok: false, reason: '無効な部隊命令です。' };
  }
  if ([FRIENDLY_SQUAD_ORDER.WITHDRAW, FRIENDLY_SQUAD_ORDER.RETURN].includes(squad.order)) {
    return { ok: false, reason: '撤退・帰還を開始した部隊の任務は変更できません。' };
  }
  let advanceTarget = null;
  if (order === FRIENDLY_SQUAD_ORDER.ADVANCE) {
    if (squad.missionType === FRIENDLY_SQUAD_MISSION.RECOVERY) {
      advanceTarget = (state.world?.recoveryItems ?? []).find(item => item.id === squad.targetRecoveryItemId && item.assignedSquadId === squad.id && [RECOVERY_ITEM_STATUS.RESERVED, RECOVERY_ITEM_STATUS.CARRIED].includes(item.status)) ?? null;
      if (!advanceTarget) return { ok: false, reason: '回収目標が失われています。撤退してください。' };
    } else if (squad.missionType === FRIENDLY_SQUAD_MISSION.INTERCEPT) {
      advanceTarget = currentTargetEnemy(state, squad);
      if (!advanceTarget) return { ok: false, reason: '迎撃対象は既に失われています。撤退してください。' };
    } else {
      const targetId = squad.missionTargetBaseId ?? squad.targetBaseId;
      advanceTarget = state.world.enemyBases.find(base => base.id === targetId && base.alive && base.hp > 0) ?? null;
      if (!advanceTarget) return { ok: false, reason: '元の攻撃目標は既に失われています。撤退してください。' };
    }
  }
  if (order === FRIENDLY_SQUAD_ORDER.WITHDRAW) {
    const origin = ownedBaseById(state, squad.originBaseId) ?? activePlayerBases(state)[0] ?? null;
    if (!origin || origin.status !== 'ESTABLISHED' || origin.hp <= 0) return { ok: false, reason: '帰還可能な拠点がありません。' };
  }
  if (!assignPathAtCurrentPosition(state, squad, path, destinationNodeId ?? path?.targetId ?? null)) return { ok: false, reason: '現在位置から選択ルートへ接続できません。' };
  if (advanceTarget && squad.missionType === FRIENDLY_SQUAD_MISSION.ATTACK) squad.targetBaseId = advanceTarget.id;
  if (advanceTarget && squad.missionType === FRIENDLY_SQUAD_MISSION.INTERCEPT) squad.targetEnemyId = advanceTarget.id;
  if (order === FRIENDLY_SQUAD_ORDER.WITHDRAW) {
    if (squad.targetRecoveryItemId) releaseRecoveryItem(state, squad.targetRecoveryItemId, squad.id, squad.status === FRIENDLY_SQUAD_STATUS.COLLECTING_ITEM ? friendlySquadPosition(state, squad) : null);
    squad.targetRecoveryItemId = null;
    squad.recoveryCollectionProgressSec = null;
    squad.targetBaseId = null;
    squad.missionTargetBaseId = null;
    squad.targetEnemyId = null;
  }
  squad.commandDestinationNodeId = destinationNodeId ?? path.targetId ?? null;
  if (squad.missionType === FRIENDLY_SQUAD_MISSION.RECOVERY && order !== FRIENDLY_SQUAD_ORDER.HOLD) squad.recoveryCollectionProgressSec = null;
  squad.order = order;
  squad.heldOrder = null;
  squad.heldDestinationNodeId = null;
  squad.status = statusForOrder(order);
  squad.engagedEnemyId = null;
  events?.emit('friendly:squad-order', { squadId, order, destinationNodeId: squad.commandDestinationNodeId });
  const label = order === FRIENDLY_SQUAD_ORDER.RETREAT ? '後退' : order === FRIENDLY_SQUAD_ORDER.WITHDRAW ? '撤退' : '進軍再開';
  events?.emit('message', { text: `味方部隊へ${label}命令を出しました。` });
  return { ok: true, squad };
}

function planReturn(state, squad) {
  const origin = ownedBaseById(state, squad.originBaseId) ?? activePlayerBases(state)[0] ?? null;
  if (!origin) return false;
  const currentEdge = squad.edgeId ? state.world.roadGraph.edgeById.get(squad.edgeId) : null;
  const routeStart = currentEdge && squad.edgeProgress > 0 && squad.edgeProgress < currentEdge.length && squad.path?.nodeIds?.[squad.pathIndex + 1]
    ? squad.path.nodeIds[squad.pathIndex + 1]
    : squad.nodeId;
  const path = findRoadPath(state, routeStart, origin.nodeId);
  if ([FRIENDLY_SQUAD_MISSION.ATTACK, FRIENDLY_SQUAD_MISSION.INTERCEPT].includes(squad.missionType)) {
    squad.targetBaseId = null;
    squad.missionTargetBaseId = null;
    squad.targetEnemyId = null;
  }
  squad.engagedEnemyId = null;
  squad.order = FRIENDLY_SQUAD_ORDER.RETURN;
  squad.heldOrder = null;
  squad.heldDestinationNodeId = null;
  squad.commandDestinationNodeId = origin.nodeId;
  squad.recoveryBaseId = origin.id;
  if (squad.originBaseId !== origin.id && !ownedBaseById(state, squad.originBaseId)) squad.originBaseId = origin.id;
  if (!path || !assignPathAtCurrentPosition(state, squad, path, origin.nodeId)) {
    squad.status = FRIENDLY_SQUAD_STATUS.STRANDED;
    squad.path = null;
    squad.edgeId = null;
    return false;
  }
  squad.status = FRIENDLY_SQUAD_STATUS.RETURNING;
  return true;
}

function redirectRecoverySquadToMajorBase(state, squad, events = null) {
  const candidates = activePlayerBases(state)
    .map(base => ({ base, path: findRoadPath(state, squad.nodeId, base.nodeId) }))
    .filter(candidate => candidate.path)
    .sort((a, b) => a.path.cost - b.path.cost);
  const fallback = candidates[0] ?? null;
  if (!fallback || !assignPathAtCurrentPosition(state, squad, fallback.path, fallback.base.nodeId)) {
    squad.status = FRIENDLY_SQUAD_STATUS.STRANDED;
    squad.path = null;
    squad.edgeId = null;
    squad.edgeProgress = 0;
    return false;
  }
  squad.originBaseId = fallback.base.id;
  squad.recoveryBaseId = fallback.base.id;
  squad.targetBaseId = null;
  squad.missionTargetBaseId = null;
  squad.targetEnemyId = null;
  squad.commandDestinationNodeId = fallback.base.nodeId;
  squad.order = FRIENDLY_SQUAD_ORDER.RETURN;
  squad.status = FRIENDLY_SQUAD_STATUS.RETURNING;
  squad.heldOrder = null;
  squad.heldDestinationNodeId = null;
  squad.recoveryStartedAt = null;
  squad.reorganizationRemaining = 0;
  squad.readyAt = null;
  events?.emit('friendly:squad-recovery-relocated', { squadId: squad.id, baseId: fallback.base.id });
  events?.emit('message', { text: `療養中の拠点が失われたため、部隊は${fallback.base.name}へ退避します。` });
  return true;
}

function currentTargetBase(state, squad) {
  return squad.targetBaseId
    ? state.world.enemyBases.find(base => base.id === squad.targetBaseId && base.alive && base.hp > 0) ?? null
    : null;
}

function currentTargetEnemy(state, squad) {
  return squad.targetEnemyId
    ? state.combat.enemies.find(enemy => enemy.id === squad.targetEnemyId && enemy.hp > 0 && enemy.departDelay <= 0) ?? null
    : null;
}

function replanIntercept(state, squad, target = currentTargetEnemy(state, squad)) {
  const destinationNodeId = enemyPursuitNodeId(state, target);
  if (!destinationNodeId) return false;
  if (squad.commandDestinationNodeId === destinationNodeId && (squad.path || squad.nodeId === destinationNodeId)) return true;
  const currentEdge = squad.edgeId ? state.world.roadGraph.edgeById.get(squad.edgeId) : null;
  const routeStart = currentEdge && squad.edgeProgress > 0 && squad.edgeProgress < currentEdge.length && squad.path?.nodeIds?.[squad.pathIndex + 1]
    ? squad.path.nodeIds[squad.pathIndex + 1]
    : squad.nodeId;
  squad.commandDestinationNodeId = destinationNodeId;
  if (routeStart === destinationNodeId) {
    if (!currentEdge || squad.edgeProgress <= 0 || squad.edgeProgress >= currentEdge.length) {
      squad.path = null;
      squad.edgeId = null;
      squad.edgeProgress = 0;
      squad.nodeId = destinationNodeId;
    }
    squad.status = FRIENDLY_SQUAD_STATUS.OUTBOUND;
    return true;
  }
  const path = findRoadPath(state, routeStart, destinationNodeId);
  if (!path || !assignPathAtCurrentPosition(state, squad, path, destinationNodeId)) return false;
  squad.status = FRIENDLY_SQUAD_STATUS.OUTBOUND;
  return true;
}

function currentRecoveryItem(state, squad) {
  return squad.targetRecoveryItemId
    ? (state.world?.recoveryItems ?? []).find(item => item.id === squad.targetRecoveryItemId && item.assignedSquadId === squad.id) ?? null
    : null;
}

function recoveryDropPlacement(state, squad) {
  const point = friendlySquadPosition(state, squad);
  const edge = squad.edgeId ? state.world.roadGraph.edgeById.get(squad.edgeId) : null;
  let nodeId = squad.nodeId;
  if (edge) nodeId = squad.edgeProgress <= edge.length / 2 ? edge.a : edge.b;
  return { nodeId, x: point.x, y: point.y };
}

function releaseSquadRecoveryItem(state, squad, dropCarried = false) {
  const item = currentRecoveryItem(state, squad);
  if (!item) return null;
  const placement = dropCarried && item.status === RECOVERY_ITEM_STATUS.CARRIED ? recoveryDropPlacement(state, squad) : null;
  const released = releaseRecoveryItem(state, item.id, squad.id, placement);
  squad.targetRecoveryItemId = null;
  squad.recoveryCollectionProgressSec = null;
  return released.item ?? null;
}

function synchronizeCarriedItem(state, squad) {
  const item = currentRecoveryItem(state, squad);
  if (!item || item.status !== RECOVERY_ITEM_STATUS.CARRIED) return;
  const placement = recoveryDropPlacement(state, squad);
  item.nodeId = placement.nodeId;
  item.x = placement.x;
  item.y = placement.y;
}

function updateRecoveryCollection(state, squad, definition, deltaSeconds, events) {
  const item = currentRecoveryItem(state, squad);
  if (!item) { planReturn(state, squad); return; }
  if (item.status === RECOVERY_ITEM_STATUS.CARRIED) { planReturn(state, squad); return; }
  if (item.status !== RECOVERY_ITEM_STATUS.RESERVED) { releaseSquadRecoveryItem(state, squad); planReturn(state, squad); return; }
  squad.status = FRIENDLY_SQUAD_STATUS.COLLECTING_ITEM;
  squad.recoveryCollectionProgressSec = Math.min(definition.collectionSeconds ?? SQUAD_RECOVERY_COLLECTION_DURATION_SECONDS, (squad.recoveryCollectionProgressSec ?? 0) + deltaSeconds);
  if (squad.recoveryCollectionProgressSec < (definition.collectionSeconds ?? SQUAD_RECOVERY_COLLECTION_DURATION_SECONDS)) return;
  const pickedUp = markRecoveryItemCarried(state, item.id, squad.id);
  if (!pickedUp.ok) { releaseSquadRecoveryItem(state, squad); planReturn(state, squad); return; }
  squad.recoveryCollectionProgressSec = null;
  events?.emit('friendly:recovery-item-picked-up', { squadId: squad.id, itemId: item.id });
  events?.emit('message', { text: `${recoveryItemPresentation(item).name}を確保しました。拠点へ帰還します。` });
  planReturn(state, squad);
}

function acquireEnemy(state, squad, spatial, definition) {
  const position = friendlySquadPosition(state, squad);
  const priority = new Map((definition.targetPriorityTypes ?? []).map((type, index) => [type, index]));
  const candidates = spatial.query(position, definition.engagementRange)
    .filter(entry => entry.enemy.hp > 0 && entry.enemy.departDelay <= 0)
    .sort((a, b) => {
      if (a.enemy.id === squad.targetEnemyId) return -1;
      if (b.enemy.id === squad.targetEnemyId) return 1;
      const rankA = priority.has(a.enemy.type) ? priority.get(a.enemy.type) : Number.MAX_SAFE_INTEGER;
      const rankB = priority.has(b.enemy.type) ? priority.get(b.enemy.type) : Number.MAX_SAFE_INTEGER;
      return rankA - rankB || distance(a.position, position) - distance(b.position, position);
    });
  const target = candidates[0]?.enemy ?? null;
  squad.engagedEnemyId = target?.id ?? null;
  if (target) target.engagedSquadId = squad.id;
  return target;
}

function friendlyCommandBonuses(state, squad) {
  const point = friendlySquadPosition(state, squad);
  let attack = 0;
  let speed = 0;
  for (const commander of state.combat?.friendlySquads ?? []) {
    if (commander.id === squad.id || commander.type !== 'command' || commander.hp <= 0) continue;
    if ([FRIENDLY_SQUAD_STATUS.RECOVERING, FRIENDLY_SQUAD_STATUS.READY].includes(commander.status)) continue;
    const definition = friendlySquadRuntimeDefinition(state, commander.type);
    if (distance(point, friendlySquadPosition(state, commander)) > (definition.auraRange ?? 0)) continue;
    attack = Math.max(attack, Number(definition.commandAura) || 0);
    speed = Math.max(speed, Number(definition.speedAura) || 0);
  }
  return { attack, speed };
}

function applyArtillerySplash(state, squad, definition, primaryEnemy, primaryDamage, spatial, events) {
  if (!(definition.splashRadius > 0) || !(definition.maxSplashTargets > 1)) return;
  const center = enemyPosition(state, primaryEnemy);
  const targets = spatial.query(center, definition.splashRadius)
    .filter(entry => entry.enemy.id !== primaryEnemy.id && entry.enemy.hp > 0 && entry.enemy.departDelay <= 0)
    .sort((left, right) => distance(left.position, center) - distance(right.position, center))
    .slice(0, definition.maxSplashTargets - 1);
  for (const entry of targets) damageEnemy(state, entry.enemy, primaryDamage * (definition.splashMultiplier ?? 0), events, spatial);
}

function updateEngagement(state, squad, definition, deltaSeconds, spatial, events) {
  let enemy = squad.engagedEnemyId ? state.combat.enemies.find(item => item.id === squad.engagedEnemyId && item.hp > 0) : null;
  const squadPoint = friendlySquadPosition(state, squad);
  const designated = squad.missionType === FRIENDLY_SQUAD_MISSION.INTERCEPT ? currentTargetEnemy(state, squad) : null;
  if (designated && distance(enemyPosition(state, designated), squadPoint) <= definition.engagementRange) {
    if (enemy && enemy.id !== designated.id && enemy.engagedSquadId === squad.id) enemy.engagedSquadId = null;
    enemy = designated;
    squad.engagedEnemyId = designated.id;
    designated.engagedSquadId = squad.id;
  }
  if (enemy && distance(enemyPosition(state, enemy), squadPoint) > definition.engagementRange + 5) {
    if (enemy.engagedSquadId === squad.id) enemy.engagedSquadId = null;
    squad.engagedEnemyId = null;
    enemy = null;
  }
  enemy ??= acquireEnemy(state, squad, spatial, definition);
  if (!enemy) return false;
  squad.status = FRIENDLY_SQUAD_STATUS.ENGAGED;
  squad.combatCooldown = Math.max(squad.combatCooldown ?? 0, definition.recoveryDelaySeconds ?? 0);
  const commandBonus = friendlyCommandBonuses(state, squad).attack;
  const primaryDamage = friendlySquadEnemyDamage(definition, enemy.type) * (1 + commandBonus) * deltaSeconds;
  applyArtillerySplash(state, squad, definition, enemy, primaryDamage, spatial, events);
  damageEnemy(state, enemy, primaryDamage, events, spatial);
  if (enemy.hp <= 0) squad.engagedEnemyId = null;
  return true;
}


function exposeEvasiveSquad(state, squad, definition, spatial) {
  const position = friendlySquadPosition(state, squad);
  const candidate = spatial.query(position, definition.engagementRange)
    .filter(entry => entry.enemy.hp > 0 && entry.enemy.departDelay <= 0)
    .sort((a, b) => distance(a.position, position) - distance(b.position, position))[0]?.enemy ?? null;
  if (candidate && (!candidate.engagedSquadId || candidate.engagedSquadId === squad.id)) candidate.engagedSquadId = squad.id;
}


function updateNonCombatRecovery(squad, definition, deltaSeconds) {
  squad.combatCooldown = Math.max(0, (squad.combatCooldown ?? 0) - deltaSeconds);
  if (!(definition.nonCombatRecoveryPerSecond > 0)) return;
  if (squad.combatCooldown > 0 || squad.status === FRIENDLY_SQUAD_STATUS.ENGAGED || squad.status === FRIENDLY_SQUAD_STATUS.ATTACKING_BASE) return;
  squad.hp = Math.min(squad.maxHp, squad.hp + definition.nonCombatRecoveryPerSecond * deltaSeconds);
}

function advanceAlongPath(state, squad, definition, deltaSeconds) {
  if (!squad.path || !squad.edgeId) return { status: 'ARRIVED', remainingSeconds: Math.max(0, deltaSeconds) };
  const formationActive = Boolean(
    squad.formationId && squad.order === FRIENDLY_SQUAD_ORDER.ADVANCE &&
    squad.missionType === FRIENDLY_SQUAD_MISSION.ATTACK &&
    state.world.enemyBases.some(base => base.id === squad.formationTargetId && base.alive && base.hp > 0)
  );
  const baseMovementSpeed = formationActive ? Math.min(definition.speed, squad.formationSpeed ?? definition.speed) : definition.speed;
  const movementSpeed = Math.max(0.001, baseMovementSpeed * (1 + friendlyCommandBonuses(state, squad).speed));
  let remainingSeconds = Math.max(0, Number(deltaSeconds) || 0);
  let transitions = 0;
  while (squad.path && squad.edgeId && remainingSeconds > 1e-9 && transitions < 4096) {
    const edge = state.world.roadGraph.edgeById.get(squad.edgeId);
    if (!edge) return { status: 'BROKEN', remainingSeconds };
    const remainingDistance = Math.max(0, edge.length - squad.edgeProgress);
    const timeToNode = remainingDistance / movementSpeed;
    if (remainingSeconds + 1e-9 < timeToNode) {
      squad.edgeProgress += movementSpeed * remainingSeconds;
      return { status: 'MOVING', remainingSeconds: 0 };
    }
    remainingSeconds = Math.max(0, remainingSeconds - timeToNode);
    squad.nodeId = squad.path.nodeIds[squad.pathIndex + 1];
    appendHistory(squad, squad.nodeId);
    squad.pathIndex += 1;
    squad.edgeProgress = 0;
    transitions += 1;
    if (squad.pathIndex >= squad.path.edgeIds.length) {
      squad.edgeId = null;
      return { status: 'ARRIVED', remainingSeconds };
    }
    squad.edgeId = squad.path.edgeIds[squad.pathIndex];
  }
  return { status: squad.edgeId ? 'MOVING' : 'ARRIVED', remainingSeconds };
}

function attackEnemyBase(state, squad, definition, deltaSeconds, events) {
  const target = currentTargetBase(state, squad);
  if (!target) {
    planReturn(state, squad);
    return;
  }
  squad.status = FRIENDLY_SQUAD_STATUS.ATTACKING_BASE;
  squad.combatCooldown = Math.max(squad.combatCooldown ?? 0, definition.recoveryDelaySeconds ?? 0);
  spawnEnemyBaseGuard(state, target, events);
  target.hp = Math.max(0, target.hp - definition.baseDps * deltaSeconds);
  if (target.hp > 0) return;
  destroyEnemyBase(state, target, events, { squadId: squad.id });
  planReturn(state, squad);
}

function replanStranded(state, squad) {
  let targetNodeId = null;
  if (squad.order === FRIENDLY_SQUAD_ORDER.ADVANCE) targetNodeId = squad.missionType === FRIENDLY_SQUAD_MISSION.RECOVERY
    ? currentRecoveryItem(state, squad)?.nodeId ?? null
    : squad.missionType === FRIENDLY_SQUAD_MISSION.INTERCEPT
      ? enemyPursuitNodeId(state, currentTargetEnemy(state, squad))
      : currentTargetBase(state, squad)?.nodeId ?? null;
  if ([FRIENDLY_SQUAD_ORDER.RETURN, FRIENDLY_SQUAD_ORDER.WITHDRAW].includes(squad.order)) targetNodeId = ownedBaseById(state, squad.originBaseId)?.nodeId ?? activePlayerBases(state)[0]?.nodeId ?? null;
  if (squad.order === FRIENDLY_SQUAD_ORDER.RETREAT) targetNodeId = squad.commandDestinationNodeId;
  if (!targetNodeId) return false;
  const path = findRoadPath(state, squad.nodeId, targetNodeId);
  if (!path) return false;
  squad.path = normalizePath(path);
  squad.pathIndex = 0;
  squad.edgeId = path.edgeIds[0] ?? null;
  squad.edgeProgress = 0;
  squad.status = statusForOrder(squad.order);
  return true;
}

export function repairNearbyDefenseWithEngineer(state, squadId, events = null) {
  ensureFriendlyForceState(state);
  const squad = friendlySquadById(state, squadId);
  if (!squad || squad.type !== 'engineer') return { ok: false, reason: '工兵部隊を選択してください。' };
  if ([FRIENDLY_SQUAD_STATUS.RECOVERING, FRIENDLY_SQUAD_STATUS.READY].includes(squad.status)) return { ok: false, reason: '出撃中の工兵部隊だけが現地修復できます。' };
  const definition = friendlySquadRuntimeDefinition(state, squad.type);
  const point = friendlySquadPosition(state, squad);
  const target = (state.combat?.defenses ?? [])
    .filter(defense => defense.hp > 0 && defense.hp < defense.maxHp && distance(point, defense.position) <= definition.repairRange)
    .sort((left, right) => (left.hp / left.maxHp) - (right.hp / right.maxHp) || distance(point, left.position) - distance(point, right.position))[0] ?? null;
  if (!target) return { ok: false, reason: `周囲${definition.repairRange}mに修復可能な設備がありません。` };
  const repairHp = Math.min(definition.repairAmount, target.maxHp - target.hp);
  const cost = repairCostForDefense(target, repairHp);
  const missing = missingBundle(state, cost);
  if (Object.keys(missing).length) return { ok: false, reason: '現地修復に必要な資源が不足しています。', missing, cost, target };
  if (!consumeBundle(state, cost)) return { ok: false, reason: '現地修復の確定時に資源が不足しました。' };
  target.hp = Math.min(target.maxHp, target.hp + repairHp);
  state.statistics.totalRepairHpPaid = (state.statistics.totalRepairHpPaid ?? 0) + repairHp;
  events?.emit('friendly:engineer-repair', { squadId, defenseId: target.id, repairHp, cost });
  events?.emit('message', { text: `工兵部隊が${Math.round(repairHp)}HPを現地修復しました。` });
  return { ok: true, target, repairHp, cost };
}

export class FriendlyForceSystem {
  constructor(events = null) {
    this.events = events;
  }

  previewDeployment(state, originBaseId, targetId, squadType = 'assault', targetKind = 'enemyBase') {
    return previewFriendlyDeployment(state, squadType, originBaseId, targetId, null, targetKind);
  }

  dispatch(state, originBaseId, targetId, squadType = 'assault', targetKind = 'enemyBase') {
    return dispatchFriendlySquad(state, squadType, originBaseId, targetId, this.events, targetKind);
  }

  previewCoordinatedDeployment(state, targetBaseId, squadTypes) {
    return previewCoordinatedDeployment(state, targetBaseId, squadTypes);
  }

  dispatchCoordinated(state, targetBaseId, squadTypes) {
    return dispatchCoordinatedSquads(state, targetBaseId, squadTypes, this.events);
  }

  hold(state, squadId) {
    return holdFriendlySquad(state, squadId, this.events);
  }

  repairNearby(state, squadId) {
    return repairNearbyDefenseWithEngineer(state, squadId, this.events);
  }

  issueRouteOrder(state, squadId, order) {
    return issueFriendlyRouteOrder(state, squadId, order, this.events);
  }

  update(state, deltaSeconds, spatial, shouldUpdate = null) {
    const remove = new Set();
    for (const squad of state.combat.friendlySquads) {
      if (squad.hp <= 0) {
        const dropped = releaseSquadRecoveryItem(state, squad, true);
        if (dropped) {
          this.events?.emit('friendly:recovery-item-dropped', { squadId: squad.id, itemId: dropped.id, position: recoveryItemPoint(state, dropped) });
          this.events?.emit('message', { text: '回収部隊が全滅し、特殊アイテムが道路上へ残されました。' });
        }
        remove.add(squad.id);
        continue;
      }
      if (shouldUpdate && !shouldUpdate(squad)) continue;
      const definition = friendlySquadRuntimeDefinition(state, squad.type);
      synchronizeCarriedItem(state, squad);
      if (squad.status === FRIENDLY_SQUAD_STATUS.READY) continue;
      if (squad.status === FRIENDLY_SQUAD_STATUS.RECOVERING) {
        const recovery = updateFriendlyRecovery(state, squad, deltaSeconds, this.events);
        if (recovery.stranded) redirectRecoverySquadToMajorBase(state, squad, this.events);
        continue;
      }
      let activeSeconds = Math.max(0, Number(deltaSeconds) || 0);
      if (squad.departDelay > 0) {
        const waitingSeconds = Math.min(squad.departDelay, activeSeconds);
        squad.departDelay = Math.max(0, squad.departDelay - waitingSeconds);
        activeSeconds -= waitingSeconds;
        if (activeSeconds <= 1e-9) continue;
      }

      if (squad.missionType === FRIENDLY_SQUAD_MISSION.INTERCEPT && squad.order === FRIENDLY_SQUAD_ORDER.ADVANCE) {
        const target = currentTargetEnemy(state, squad);
        if (!target) {
          planReturn(state, squad);
          continue;
        }
        const destinationNodeId = enemyPursuitNodeId(state, target);
        if (destinationNodeId && (squad.commandDestinationNodeId !== destinationNodeId || (!squad.path && squad.nodeId !== destinationNodeId))) {
          if (!replanIntercept(state, squad, target)) {
            squad.status = FRIENDLY_SQUAD_STATUS.STRANDED;
            squad.path = null;
            squad.edgeId = null;
            continue;
          }
        }
      }

      const evasive = [FRIENDLY_SQUAD_ORDER.RETREAT, FRIENDLY_SQUAD_ORDER.WITHDRAW].includes(squad.order);
      if (evasive) exposeEvasiveSquad(state, squad, definition, spatial);
      if (!evasive && updateEngagement(state, squad, definition, activeSeconds, spatial, this.events)) continue;
      if (squad.status === FRIENDLY_SQUAD_STATUS.ENGAGED) squad.status = statusForOrder(squad.order);
      updateNonCombatRecovery(squad, definition, activeSeconds);

      if (squad.order === FRIENDLY_SQUAD_ORDER.HOLD) {
        squad.status = FRIENDLY_SQUAD_STATUS.HALTED;
        if (squad.missionType === FRIENDLY_SQUAD_MISSION.RECOVERY) {
          if (squad.targetRecoveryItemId && !currentRecoveryItem(state, squad)) planReturn(state, squad);
        } else if (squad.missionType === FRIENDLY_SQUAD_MISSION.INTERCEPT) {
          if (squad.targetEnemyId && !currentTargetEnemy(state, squad)) planReturn(state, squad);
        } else {
          const missionId = squad.missionTargetBaseId ?? squad.targetBaseId;
          if (missionId && !state.world.enemyBases.some(base => base.id === missionId && base.alive && base.hp > 0)) planReturn(state, squad);
        }
        continue;
      }

      if (squad.recoveryCollectionProgressSec != null || squad.status === FRIENDLY_SQUAD_STATUS.COLLECTING_ITEM) {
        updateRecoveryCollection(state, squad, definition, activeSeconds, this.events);
        continue;
      }

      if (squad.status === FRIENDLY_SQUAD_STATUS.ATTACKING_BASE) {
        attackEnemyBase(state, squad, definition, activeSeconds, this.events);
        continue;
      }
      if (squad.status === FRIENDLY_SQUAD_STATUS.STRANDED) {
        replanStranded(state, squad);
        continue;
      }

      const movement = advanceAlongPath(state, squad, definition, activeSeconds);
      if (movement.status === 'BROKEN') {
        squad.status = FRIENDLY_SQUAD_STATUS.STRANDED;
        squad.path = null;
        squad.edgeId = null;
        continue;
      }
      if (movement.status !== 'ARRIVED') continue;

      if ([FRIENDLY_SQUAD_ORDER.RETURN, FRIENDLY_SQUAD_ORDER.WITHDRAW].includes(squad.order)) {
        clearEnemyEngagements(state, squad.id);
        const recoveryBaseId = squad.recoveryBaseId ?? squad.originBaseId;
        if (squad.missionType === FRIENDLY_SQUAD_MISSION.RECOVERY && squad.targetRecoveryItemId) {
          const item = currentRecoveryItem(state, squad);
          if (item?.status === RECOVERY_ITEM_STATUS.CARRIED) {
            const delivered = deliverRecoveryItem(state, item.id, squad.id);
            if (delivered.ok) {
              this.events?.emit('exploration:recovery-collected', delivered);
              const presentation = recoveryItemPresentation(item);
              const lootText = Object.keys(delivered.loot ?? {}).length ? ` 資源：${presentation.lootText}。` : '';
              this.events?.emit('message', { text: `${presentation.name}を拠点へ持ち帰りました。${lootText}` });
            }
          } else releaseSquadRecoveryItem(state, squad);
          squad.targetRecoveryItemId = null;
          squad.recoveryCollectionProgressSec = null;
        }
        const recovery = beginFriendlyRecovery(state, squad, recoveryBaseId);
        if (!recovery.ok) {
          squad.status = FRIENDLY_SQUAD_STATUS.STRANDED;
          squad.path = null;
          squad.edgeId = null;
          continue;
        }
        this.events?.emit('friendly:squad-returned', { squadId: squad.id, originBaseId: recoveryBaseId, hp: squad.hp, withdrawal: squad.order === FRIENDLY_SQUAD_ORDER.WITHDRAW });
        this.events?.emit('message', { text: recovery.profile?.kind === 'MAJOR'
          ? '部隊が主要拠点へ帰還し、補給・回復・再編成を開始しました。'
          : '部隊が簡易拠点へ帰還し、再編成を開始しました。回復には回復施設の範囲内での待機が必要です。' });
      } else if (squad.order === FRIENDLY_SQUAD_ORDER.RETREAT) {
        squad.order = FRIENDLY_SQUAD_ORDER.HOLD;
        squad.heldOrder = FRIENDLY_SQUAD_ORDER.ADVANCE;
        squad.heldDestinationNodeId = squad.missionType === FRIENDLY_SQUAD_MISSION.RECOVERY
          ? currentRecoveryItem(state, squad)?.nodeId ?? null
          : squad.missionType === FRIENDLY_SQUAD_MISSION.INTERCEPT
            ? enemyPursuitNodeId(state, currentTargetEnemy(state, squad))
            : state.world.enemyBases.find(base => base.id === (squad.missionTargetBaseId ?? squad.targetBaseId) && base.alive && base.hp > 0)?.nodeId ?? null;
        squad.status = FRIENDLY_SQUAD_STATUS.HALTED;
        squad.path = null;
        squad.edgeId = null;
        squad.edgeProgress = 0;
        this.events?.emit('message', { text: '味方部隊が指定地点まで後退し、停止しました。' });
      } else if (squad.missionType === FRIENDLY_SQUAD_MISSION.RECOVERY) {
        squad.path = null;
        squad.edgeId = null;
        squad.edgeProgress = 0;
        squad.recoveryCollectionProgressSec = 0;
        updateRecoveryCollection(state, squad, definition, movement.remainingSeconds, this.events);
      } else if (squad.missionType === FRIENDLY_SQUAD_MISSION.INTERCEPT) {
        squad.path = null;
        squad.edgeId = null;
        squad.edgeProgress = 0;
        const target = currentTargetEnemy(state, squad);
        if (!target) planReturn(state, squad);
        else if (!replanIntercept(state, squad, target)) {
          squad.status = FRIENDLY_SQUAD_STATUS.STRANDED;
        }
      } else {
        attackEnemyBase(state, squad, definition, movement.remainingSeconds, this.events);
      }
    }
    if (remove.size) state.combat.friendlySquads = state.combat.friendlySquads.filter(squad => !remove.has(squad.id));
  }
}
