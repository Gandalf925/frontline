import { distance, stableId } from '../core/utilities.js';
import { attachGraphIndexes } from './road-graph.js';
import { segmentAngle, segmentMidpoint } from './geometry.js';

const COORDINATE_FALLBACK_METERS = 1.5;

function bucketKey(point, size) {
  return `${Math.floor(point.x / size)},${Math.floor(point.y / size)}`;
}

function candidateBuckets(point, size) {
  const x = Math.floor(point.x / size);
  const y = Math.floor(point.y / size);
  const result = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) result.push(`${x + dx},${y + dy}`);
  }
  return result;
}

function createNodeIndexes(nodes, size) {
  const buckets = new Map();
  const bySourceNodeId = new Map();
  for (const node of nodes) {
    const key = bucketKey(node, size);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(node);
    for (const sourceId of node.sourceNodeIds ?? []) bySourceNodeId.set(String(sourceId), node);
  }
  return { buckets, bySourceNodeId };
}

function nearestCoordinateNode(node, buckets, threshold) {
  let best = null;
  let bestDistance = threshold;
  for (const key of candidateBuckets(node, threshold)) {
    for (const candidate of buckets.get(key) ?? []) {
      const gap = distance(node, candidate);
      if (gap <= bestDistance) {
        best = candidate;
        bestDistance = gap;
      }
    }
  }
  return best;
}

function compatibleExistingNode(node, indexes) {
  const sourceIds = (node.sourceNodeIds ?? []).map(String);
  for (const sourceId of sourceIds) {
    const exact = indexes.bySourceNodeId.get(sourceId);
    if (exact) return exact;
  }
  const coordinate = nearestCoordinateNode(node, indexes.buckets, COORDINATE_FALLBACK_METERS);
  if (!coordinate) return null;
  const candidateSourceIds = coordinate.sourceNodeIds ?? [];
  if (sourceIds.length > 0 && candidateSourceIds.length > 0) return null;
  return coordinate;
}

function uniqueNodeId(node, used) {
  let id = node.id || stableId('node', Math.round(node.x * 10), Math.round(node.y * 10));
  let sequence = 1;
  while (used.has(id)) id = `${stableId('node', Math.round(node.x * 100), Math.round(node.y * 100))}_${sequence++}`;
  used.add(id);
  return id;
}

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function mergeEdgeMetadata(target, source) {
  target.roadWidth = Math.max(Number(target.roadWidth) || 0, Number(source.roadWidth) || 0);
  target.lanes = Math.max(Number(target.lanes) || 1, Number(source.lanes) || 1);
  if (!target.name && source.name) target.name = source.name;
  if (!target.highway && source.highway) target.highway = source.highway;
  target.oneway = Boolean(target.oneway && source.oneway);
  target.chunkIds = [...new Set([...(target.chunkIds ?? []), ...(source.chunkIds ?? [])])];
  target.sourceWayIds = [...new Set([...(target.sourceWayIds ?? []), ...(source.sourceWayIds ?? [])].map(String))];
  target.mergedSegmentIds = [...new Set([...(target.mergedSegmentIds ?? []), ...(source.mergedSegmentIds ?? [source.id])])];
}

function matchingEdge(candidates, sourceEdge) {
  const sourceWays = new Set((sourceEdge.sourceWayIds ?? []).map(String));
  if (sourceWays.size > 0) {
    const exact = candidates.find(candidate => (candidate.sourceWayIds ?? []).some(id => sourceWays.has(String(id))));
    if (exact) return exact;
  }
  return candidates.find(candidate =>
    (candidate.sourceWayIds?.length ?? 0) === 0
    && String(candidate.name ?? '') === String(sourceEdge.name ?? '')
    && String(candidate.highway ?? '') === String(sourceEdge.highway ?? '')
  ) ?? null;
}

export function mergeRoadGraphs(baseGraph, incomingGraph, { chunkId = null } = {}) {
  if (!baseGraph?.nodes || !baseGraph?.edges) throw new TypeError('baseGraph is required');
  if (!incomingGraph?.nodes || !incomingGraph?.edges) {
    return { graph: attachGraphIndexes(baseGraph), addedNodes: 0, addedEdges: 0, mergedEdges: 0 };
  }

  const usedNodeIds = new Set(baseGraph.nodes.map(node => node.id));
  const indexes = createNodeIndexes(baseGraph.nodes, COORDINATE_FALLBACK_METERS);
  const nodeMap = new Map();
  let addedNodes = 0;

  for (const sourceNode of incomingGraph.nodes) {
    const existing = compatibleExistingNode(sourceNode, indexes);
    if (existing) {
      nodeMap.set(sourceNode.id, existing.id);
      existing.chunkIds = [...new Set([...(existing.chunkIds ?? []), ...(sourceNode.chunkIds ?? []), ...(chunkId ? [chunkId] : [])])];
      existing.sourceNodeIds = [...new Set([...(existing.sourceNodeIds ?? []), ...(sourceNode.sourceNodeIds ?? [])].map(String))];
      for (const sourceId of existing.sourceNodeIds) indexes.bySourceNodeId.set(sourceId, existing);
      continue;
    }
    const node = {
      ...sourceNode,
      id: uniqueNodeId(sourceNode, usedNodeIds),
      sourceNodeIds: [...new Set((sourceNode.sourceNodeIds ?? []).map(String))],
      chunkIds: [...new Set([...(sourceNode.chunkIds ?? []), ...(chunkId ? [chunkId] : [])])]
    };
    baseGraph.nodes.push(node);
    const key = bucketKey(node, COORDINATE_FALLBACK_METERS);
    if (!indexes.buckets.has(key)) indexes.buckets.set(key, []);
    indexes.buckets.get(key).push(node);
    for (const sourceId of node.sourceNodeIds) indexes.bySourceNodeId.set(sourceId, node);
    nodeMap.set(sourceNode.id, node.id);
    addedNodes += 1;
  }

  const nodeById = new Map(baseGraph.nodes.map(node => [node.id, node]));
  const edgesByPair = new Map();
  for (const edge of baseGraph.edges) {
    const pair = pairKey(edge.a, edge.b);
    if (!edgesByPair.has(pair)) edgesByPair.set(pair, []);
    edgesByPair.get(pair).push(edge);
  }
  const usedEdgeIds = new Set(baseGraph.edges.map(edge => edge.id));
  let addedEdges = 0;
  let mergedEdges = 0;

  for (const sourceEdge of incomingGraph.edges) {
    const a = nodeMap.get(sourceEdge.a);
    const b = nodeMap.get(sourceEdge.b);
    if (!a || !b || a === b) continue;
    const pair = pairKey(a, b);
    const edgeChunkIds = [...new Set([...(sourceEdge.chunkIds ?? []), ...(chunkId ? [chunkId] : [])])];
    const normalizedSource = {
      ...sourceEdge,
      chunkIds: edgeChunkIds,
      sourceWayIds: [...new Set((sourceEdge.sourceWayIds ?? []).map(String))]
    };
    const candidates = edgesByPair.get(pair) ?? [];
    const existing = matchingEdge(candidates, normalizedSource);
    if (existing) {
      mergeEdgeMetadata(existing, normalizedSource);
      mergedEdges += 1;
      continue;
    }
    const nodeA = nodeById.get(a);
    const nodeB = nodeById.get(b);
    if (!nodeA || !nodeB) continue;
    let id = sourceEdge.id || stableId('edge', pair, ...(normalizedSource.sourceWayIds ?? []));
    let sequence = 1;
    while (usedEdgeIds.has(id)) id = `${stableId('edge', pair, sourceEdge.id)}_${sequence++}`;
    usedEdgeIds.add(id);
    const edge = {
      ...normalizedSource,
      id,
      a,
      b,
      length: distance(nodeA, nodeB),
      points: [{ x: nodeA.x, y: nodeA.y }, { x: nodeB.x, y: nodeB.y }],
      mid: segmentMidpoint({ a: nodeA, b: nodeB }),
      angle: segmentAngle({ a: nodeA, b: nodeB }),
      mergedSegmentIds: [...(sourceEdge.mergedSegmentIds ?? [sourceEdge.id])]
    };
    baseGraph.edges.push(edge);
    if (!edgesByPair.has(pair)) edgesByPair.set(pair, []);
    edgesByPair.get(pair).push(edge);
    addedEdges += 1;
  }

  baseGraph.roadSpecVersion = Math.max(Number(baseGraph.roadSpecVersion) || 1, 3);
  attachGraphIndexes(baseGraph);
  return { graph: baseGraph, addedNodes, addedEdges, mergedEdges };
}
