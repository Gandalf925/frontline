import { ENEMY_BASE_DEFINITIONS } from './definitions.js';
import { chunkForWorldPoint } from '../roads/world-chunk-grid.js';

export const INITIAL_BASE_TYPES = Object.freeze(['barracks', 'engineer', 'raider', 'motor']);

const FRONT_DELAY_SECONDS = 120;
const FRONT_SECTOR_COUNT = 8;
const FRONT_INTERVAL_STEP = 0.5;

function distancesFrom(graph, startId) {
  const distances = new Map([[startId, 0]]);
  const queue = [{ id: startId, distance: 0 }];
  const visited = new Set();
  while (queue.length > 0) {
    queue.sort((a, b) => a.distance - b.distance);
    const current = queue.shift();
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    for (const connection of graph.adjacency.get(current.id) ?? []) {
      const next = current.distance + connection.length;
      if (next >= (distances.get(connection.to) ?? Infinity)) continue;
      distances.set(connection.to, next);
      queue.push({ id: connection.to, distance: next });
    }
  }
  return distances;
}

function bearingFrom(origin, point) {
  return Math.atan2(point.y - origin.y, point.x - origin.x);
}

function bearingSector(angle) {
  const circle = Math.PI * 2;
  const step = circle / FRONT_SECTOR_COUNT;
  const normalized = (angle + circle + step / 2) % circle;
  return Math.floor(normalized / step);
}

function angularDistance(a, b) {
  const difference = Math.abs(a - b) % (Math.PI * 2);
  return Math.min(difference, Math.PI * 2 - difference);
}

function frontMetadata(references, sector) {
  const frontIndex = references.filter(item => item.sector === sector).length;
  return {
    frontIndex,
    initialDelayBonusSec: frontIndex * FRONT_DELAY_SECONDS,
    frontPressureMultiplier: 1 + frontIndex * FRONT_INTERVAL_STEP
  };
}

function compareCandidate(a, b, references, target) {
  if (references.length === 0) {
    return Math.abs(a.routeDistance - target) - Math.abs(b.routeDistance - target)
      || a.routeDistance - b.routeDistance
      || a.node.id.localeCompare(b.node.id);
  }
  const sectorUseA = references.filter(item => item.sector === a.sector).length;
  const sectorUseB = references.filter(item => item.sector === b.sector).length;
  if (sectorUseA !== sectorUseB) return sectorUseA - sectorUseB;
  const separationA = Math.min(...references.map(item => angularDistance(item.angle, a.angle)));
  const separationB = Math.min(...references.map(item => angularDistance(item.angle, b.angle)));
  return separationB - separationA
    || Math.abs(a.routeDistance - target) - Math.abs(b.routeDistance - target)
    || a.routeDistance - b.routeDistance
    || a.node.id.localeCompare(b.node.id);
}

function candidateForNode(node, cityNode, routeDistance) {
  const angle = bearingFrom(cityNode, node);
  return { node, angle, sector: bearingSector(angle), routeDistance };
}

function publicPlacement(type, candidate, references) {
  return {
    type,
    nodeId: candidate.node.id,
    routeDistance: candidate.routeDistance,
    sector: candidate.sector,
    ...frontMetadata(references, candidate.sector)
  };
}

export function selectInitialEnemyBasePlacements(graph, cityNodeId) {
  const distances = distancesFrom(graph, cityNodeId);
  const cityNode = graph.nodeById.get(cityNodeId);
  const degree = nodeId => graph.adjacency.get(nodeId)?.length ?? 0;
  const available = graph.nodes
    .filter(node => node.id !== cityNodeId && degree(node.id) >= 2 && distances.has(node.id))
    .map(node => candidateForNode(node, cityNode, distances.get(node.id)))
    .sort((a, b) => a.routeDistance - b.routeDistance || a.node.id.localeCompare(b.node.id));
  const used = new Set();
  const references = [];
  const placements = [];

  for (const type of INITIAL_BASE_TYPES) {
    const definition = ENEMY_BASE_DEFINITIONS[type];
    const [minimum, maximum] = definition.range;
    const target = (minimum + maximum) / 2;
    const candidates = available.filter(item => !used.has(item.node.id));
    const inRange = candidates.filter(item => item.routeDistance >= minimum && item.routeDistance <= maximum);
    const pool = inRange.length > 0 ? inRange : candidates.filter(item => item.routeDistance >= 120);
    if (pool.length === 0) break;
    const chosen = pool.reduce((best, item) => compareCandidate(item, best, references, target) < 0 ? item : best, pool[0]);
    placements.push(publicPlacement(type, chosen, references));
    references.push(chosen);
    used.add(chosen.node.id);
  }
  return placements;
}

export function selectEnemyBaseNode(state, type, sourceNodeId = null) {
  const graph = state.world.roadGraph;
  const definition = ENEMY_BASE_DEFINITIONS[type];
  const cityNode = graph.nodeById.get(state.world.city.nodeId);
  const distances = distancesFrom(graph, state.world.city.nodeId);
  const sourceNode = sourceNodeId ? graph.nodeById.get(sourceNodeId) : null;
  const activeBases = state.world.enemyBases.filter(base => base.alive);
  const occupiedNodes = new Set([
    state.world.city.nodeId,
    ...activeBases.map(base => base.nodeId)
  ]);
  const occupiedPoints = [...occupiedNodes].map(id => graph.nodeById.get(id)).filter(Boolean);
  const references = activeBases
    .map(base => graph.nodeById.get(base.nodeId))
    .filter(Boolean)
    .map(node => candidateForNode(node, cityNode, distances.get(node.id) ?? 0));
  const target = (definition.range[0] + definition.range[1]) / 2;
  const physicallyObservedChunks = new Set(state.world.roadChunks?.playerObserved ?? state.world.roadChunks?.loaded ?? []);
  const candidates = graph.nodes
    .filter(node => physicallyObservedChunks.size === 0 || physicallyObservedChunks.has(chunkForWorldPoint(node, state.world.roadChunks?.sizeMeters).id))
    .filter(node => !occupiedNodes.has(node.id) && (graph.adjacency.get(node.id)?.length ?? 0) >= 2)
    .filter(node => !sourceNode || Math.hypot(node.x - sourceNode.x, node.y - sourceNode.y) >= 150)
    .filter(node => occupiedPoints.every(point => Math.hypot(node.x - point.x, node.y - point.y) >= 100))
    .map(node => candidateForNode(node, cityNode, distances.get(node.id) ?? Infinity))
    .filter(item => Number.isFinite(item.routeDistance));
  const inRange = candidates.filter(item => item.routeDistance >= definition.range[0] && item.routeDistance <= definition.range[1]);
  const pool = inRange.length ? inRange : candidates.filter(item => item.routeDistance >= 120);
  if (!pool.length) return null;
  const chosen = pool.reduce((best, item) => compareCandidate(item, best, references, target) < 0 ? item : best, pool[0]);
  return {
    node: chosen.node,
    route: chosen.routeDistance,
    sector: chosen.sector,
    ...frontMetadata(references, chosen.sector)
  };
}
