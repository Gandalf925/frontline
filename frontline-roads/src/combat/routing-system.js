import { distance } from '../core/utilities.js';
import { pointToSegmentProjection } from '../roads/geometry.js';
import { DEFENSE_DEFINITIONS, ENEMY_DEFINITIONS, defenseRuntimeDefinition } from './definitions.js';
import { enemyBehaviorForDefinition } from './enemy-personalities.js';
import { scaleEnemyDefinition } from './enemy-scaling.js';
import { edgeMidpoint } from './combat-geometry.js';

class MinHeap {
  constructor() { this.items = []; }
  push(value) {
    const items = this.items;
    items.push(value);
    let index = items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (items[parent].distance <= value.distance) break;
      items[index] = items[parent];
      index = parent;
    }
    items[index] = value;
  }
  pop() {
    const items = this.items;
    if (items.length === 0) return null;
    const root = items[0];
    const tail = items.pop();
    if (items.length === 0) return root;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= items.length) break;
      let child = left;
      if (right < items.length && items[right].distance < items[left].distance) child = right;
      if (items[child].distance >= tail.distance) break;
      items[index] = items[child];
      index = child;
    }
    items[index] = tail;
    return root;
  }
  get length() { return this.items.length; }
}

function defenseMaps(state) {
  const barriers = new Map();
  const towers = [];
  for (const defense of state.combat.defenses) {
    if (defense.hp <= 0) continue;
    if (defense.kind === 'barrier') barriers.set(defense.edgeId, defense);
    else towers.push(defense);
  }
  return { barriers, towers };
}

function enemyCountMap(state) {
  const counts = new Map();
  for (const enemy of state.combat.enemies) {
    if (!enemy.edgeId || enemy.hp <= 0) continue;
    counts.set(enemy.edgeId, (counts.get(enemy.edgeId) ?? 0) + 1);
  }
  return counts;
}

function edgeTowerThreat(state, edgeId, towers, cache) {
  if (cache.has(edgeId)) return cache.get(edgeId);
  const graph = state.world.roadGraph;
  const middle = edgeMidpoint(graph, edgeId);
  if (!middle) return 0;
  let threat = 0;
  for (const tower of towers) {
    if (tower.kind !== 'tower' || ['relay', 'survey', 'medical', 'fieldBarracks'].includes(tower.type)) continue;
    const node = graph.nodeById.get(tower.nodeId);
    const range = defenseRuntimeDefinition(tower).range ?? 80;
    if (node && distance(middle, node) <= range) threat += 1;
  }
  cache.set(edgeId, threat);
  return threat;
}

function barrierDelaySeconds(enemyDefinition, barrier, routeBias, behavior) {
  const dps = Math.max(0.1, Number(enemyDefinition.barrierDps) || 0.1);
  const breakSeconds = Math.max(0, Number(barrier.hp) || 0) / dps;
  const strategy = enemyDefinition.barrierStrategy ?? 'balanced';
  const factor = Math.max(0.05, Number(enemyDefinition.barrierCostFactor) || 1) * Math.max(0.05, Number(behavior?.barrierCostMultiplier) || 1);
  const bias = Math.max(0.75, Math.min(1.25, Number(routeBias) || 1));
  if (strategy === 'avoid') return 900 + breakSeconds * factor * bias;
  return breakSeconds * factor * bias;
}

function reconstructPath(previous, startId, targetId, cost, extra = {}) {
  const nodeIds = [targetId];
  const edgeIds = [];
  let cursor = targetId;
  while (cursor !== startId) {
    const step = previous.get(cursor);
    if (!step) return null;
    edgeIds.push(step.edgeId);
    nodeIds.push(step.from);
    cursor = step.from;
  }
  nodeIds.reverse();
  edgeIds.reverse();
  return { nodeIds, edgeIds, cost, targetId, ...extra };
}

function pathGeometryMetrics(state, path, startId, targetId) {
  const graph = state.world.roadGraph;
  const start = graph.nodeById.get(startId);
  const target = graph.nodeById.get(targetId);
  let distanceMeters = 0;
  let maxLateralDistance = 0;
  for (const edgeId of path.edgeIds) {
    const edge = graph.edgeById.get(edgeId);
    if (!edge) continue;
    distanceMeters += Math.max(0, Number(edge.length) || 0);
    if (start && target) {
      const middle = edgeMidpoint(graph, edgeId);
      if (middle) maxLateralDistance = Math.max(maxLateralDistance, pointToSegmentProjection(middle, start, target).distance);
    }
  }
  return { distanceMeters, maxLateralDistance };
}

function flankWeightMultiplier(state, edge, startId, targetId, behavior) {
  const graph = state.world.roadGraph;
  const start = graph.nodeById.get(startId);
  const target = graph.nodeById.get(targetId);
  const middle = edgeMidpoint(graph, edge.id);
  if (!start || !target || !middle) return 1;
  const lineDistance = Math.max(1, distance(start, target));
  const width = Math.max(45, Math.min(behavior.flankWidthMeters, lineDistance * 0.75));
  const projection = pointToSegmentProjection(middle, start, target);
  const proximity = Math.max(0, 1 - projection.distance / width);
  const centerFactor = Math.sin(Math.PI * projection.t);
  return 1 + Math.max(0, behavior.flankPreference) * proximity * centerFactor;
}

function searchCombatPathCore(state, startId, targetCandidates, enemyType, previewBarrierEdgeId, routeBias, enemyLevel = 1, flankTargetId = null, doctrineKey = null) {
  const graph = state.world.roadGraph;
  if (!graph?.nodeById?.has(startId) || !targetCandidates.length) return null;
  const enemyDefinition = scaleEnemyDefinition(ENEMY_DEFINITIONS[enemyType] ?? ENEMY_DEFINITIONS.infantry, enemyLevel);
  const behavior = enemyBehaviorForDefinition(enemyDefinition, doctrineKey);
  const { barriers, towers } = defenseMaps(state);
  const edgeCounts = behavior.avoidCongestion ? enemyCountMap(state) : null;
  const threatCache = new Map();
  const targetsByNode = new Map();
  for (const candidate of targetCandidates) {
    if (!graph.nodeById.has(candidate.nodeId)) continue;
    const entries = targetsByNode.get(candidate.nodeId) ?? [];
    entries.push(candidate);
    targetsByNode.set(candidate.nodeId, entries);
  }
  if (!targetsByNode.size) return null;

  const distances = new Map([[startId, 0]]);
  const previous = new Map();
  const visited = new Set();
  const queue = new MinHeap();
  queue.push({ id: startId, distance: 0 });
  let best = null;

  while (queue.length > 0) {
    const current = queue.pop();
    if (visited.has(current.id)) continue;
    if (best && current.distance > best.totalCost) break;
    visited.add(current.id);

    for (const target of targetsByNode.get(current.id) ?? []) {
      const totalCost = current.distance + Math.max(0, Number(target.priorityPenalty) || 0);
      if (!best || totalCost < best.totalCost) best = { ...target, routeCost: current.distance, totalCost };
    }

    for (const connection of graph.adjacency.get(current.id) ?? []) {
      const edge = graph.edgeById.get(connection.edgeId);
      if (!edge) continue;
      let weight = edge.length / Math.max(0.1, enemyDefinition.speed ?? 1);
      const barrier = connection.edgeId === previewBarrierEdgeId
        ? { hp: DEFENSE_DEFINITIONS.barrier.hp }
        : barriers.get(connection.edgeId);
      if (barrier?.hp > 0) weight += barrierDelaySeconds(enemyDefinition, barrier, routeBias, behavior);
      if (behavior.avoidTowers) weight *= 1 + edgeTowerThreat(state, edge.id, towers, threatCache) * 0.9;
      if (behavior.avoidCongestion) weight *= 1 + (edgeCounts.get(edge.id) ?? 0) / 12;
      if (flankTargetId) weight *= flankWeightMultiplier(state, edge, startId, flankTargetId, behavior);
      const nextDistance = current.distance + weight;
      if (nextDistance >= (distances.get(connection.to) ?? Infinity)) continue;
      distances.set(connection.to, nextDistance);
      previous.set(connection.to, { from: current.id, edgeId: connection.edgeId });
      queue.push({ id: connection.to, distance: nextDistance });
    }
  }

  if (!best) return null;
  const path = reconstructPath(previous, startId, best.nodeId, best.routeCost, { targetObjectId: best.targetObjectId ?? null });
  return path ? { ...path, ...pathGeometryMetrics(state, path, startId, best.nodeId) } : null;
}

function pathsDiffer(left, right) {
  if (!left || !right || left.edgeIds.length !== right.edgeIds.length) return true;
  return left.edgeIds.some((edgeId, index) => edgeId !== right.edgeIds[index]);
}

function withRoutePresentation(path, behavior, routeMode = behavior.routeMode, detourPercent = 0) {
  return path ? { ...path, routeMode, personalityKey: behavior.personalityKey, detourPercent } : null;
}

function searchCombatPath(state, startId, targetCandidates, enemyType, previewBarrierEdgeId, routeBias, enemyLevel = 1, doctrineKey = null) {
  const definition = scaleEnemyDefinition(ENEMY_DEFINITIONS[enemyType] ?? ENEMY_DEFINITIONS.infantry, enemyLevel);
  const behavior = enemyBehaviorForDefinition(definition, doctrineKey);
  const baseline = searchCombatPathCore(state, startId, targetCandidates, enemyType, previewBarrierEdgeId, routeBias, enemyLevel, null, doctrineKey);
  if (!baseline || !behavior.prefersDetour || baseline.edgeIds.length < 2) return withRoutePresentation(baseline, behavior);

  const selectedTarget = targetCandidates.find(target =>
    target.nodeId === baseline.targetId && (target.targetObjectId ?? null) === (baseline.targetObjectId ?? null)
  ) ?? { nodeId: baseline.targetId, targetObjectId: baseline.targetObjectId ?? null };
  const flanking = searchCombatPathCore(state, startId, [selectedTarget], enemyType, previewBarrierEdgeId, routeBias, enemyLevel, baseline.targetId, doctrineKey);
  const shortest = findRoadPath(state, startId, baseline.targetId);
  if (!flanking || !shortest || shortest.cost <= 0 || !pathsDiffer(flanking, baseline)) return withRoutePresentation(baseline, behavior, 'EVASIVE');

  const ratio = flanking.distanceMeters / shortest.cost;
  const lateralEnough = flanking.maxLateralDistance >= Math.min(behavior.minimumLateralMeters, Math.max(12, shortest.cost * 0.18));
  if (ratio > behavior.maxDetourRatio || !lateralEnough) return withRoutePresentation(baseline, behavior, 'EVASIVE');
  const detourPercent = Math.max(0, Math.round((ratio - 1) * 100));
  return withRoutePresentation(flanking, behavior, 'FLANK', detourPercent);
}

export function findRoadPath(state, startId, targetId) {
  const graph = state.world.roadGraph;
  if (!graph?.nodeById?.has(startId) || !graph.nodeById.has(targetId)) return null;
  if (startId === targetId) return { nodeIds: [startId], edgeIds: [], cost: 0, targetId };
  const distances = new Map([[startId, 0]]);
  const previous = new Map();
  const visited = new Set();
  const queue = new MinHeap();
  queue.push({ id: startId, distance: 0 });
  while (queue.length > 0) {
    const current = queue.pop();
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    if (current.id === targetId) return reconstructPath(previous, startId, targetId, current.distance);
    for (const connection of graph.adjacency.get(current.id) ?? []) {
      if (!graph.edgeById.has(connection.edgeId)) continue;
      const nextDistance = current.distance + connection.length;
      if (nextDistance >= (distances.get(connection.to) ?? Infinity)) continue;
      distances.set(connection.to, nextDistance);
      previous.set(connection.to, { from: current.id, edgeId: connection.edgeId });
      queue.push({ id: connection.to, distance: nextDistance });
    }
  }
  return null;
}

export function findRoadPathWeighted(state, startId, targetId, edgeWeight = null) {
  const graph = state.world.roadGraph;
  if (!graph?.nodeById?.has(startId) || !graph.nodeById.has(targetId)) return null;
  if (startId === targetId) return { nodeIds: [startId], edgeIds: [], cost: 0, targetId };
  const distances = new Map([[startId, 0]]);
  const previous = new Map();
  const visited = new Set();
  const queue = new MinHeap();
  queue.push({ id: startId, distance: 0 });
  while (queue.length > 0) {
    const current = queue.pop();
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    if (current.id === targetId) return reconstructPath(previous, startId, targetId, current.distance);
    for (const connection of graph.adjacency.get(current.id) ?? []) {
      const edge = graph.edgeById.get(connection.edgeId);
      if (!edge) continue;
      const rawWeight = edgeWeight ? edgeWeight(edge, current.id, connection.to) : edge.length;
      const weight = Number.isFinite(rawWeight) ? Math.max(0.001, rawWeight) : edge.length;
      const nextDistance = current.distance + weight;
      if (nextDistance >= (distances.get(connection.to) ?? Infinity)) continue;
      distances.set(connection.to, nextDistance);
      previous.set(connection.to, { from: current.id, edgeId: connection.edgeId });
      queue.push({ id: connection.to, distance: nextDistance });
    }
  }
  return null;
}

export function combineRoadPaths(paths) {
  const valid = paths.filter(Boolean);
  if (!valid.length) return null;
  const nodeIds = [...valid[0].nodeIds];
  const edgeIds = [...valid[0].edgeIds];
  let cost = Number(valid[0].cost) || 0;
  for (let index = 1; index < valid.length; index += 1) {
    const path = valid[index];
    if (nodeIds[nodeIds.length - 1] !== path.nodeIds[0]) return null;
    nodeIds.push(...path.nodeIds.slice(1));
    edgeIds.push(...path.edgeIds);
    cost += Number(path.cost) || 0;
  }
  return { nodeIds, edgeIds, cost, targetId: nodeIds[nodeIds.length - 1] };
}

export function findCombatPath(state, startId, targetId, enemyType = 'infantry', previewBarrierEdgeId = null, routeBias = 1, enemyLevel = 1, doctrineKey = null) {
  return searchCombatPath(state, startId, [{ nodeId: targetId }], enemyType, previewBarrierEdgeId, routeBias, enemyLevel, doctrineKey);
}

export function findCombatPathToTargets(state, startId, targets, enemyType = 'infantry', routeBias = 1, enemyLevel = 1, doctrineKey = null) {
  return searchCombatPath(state, startId, targets, enemyType, null, routeBias, enemyLevel, doctrineKey);
}
