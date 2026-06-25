import { distance, stableId } from '../core/utilities.js';
import { clusterSegmentEndpoints } from './intersection-clustering.js';
import { segmentAngle, segmentMidpoint } from './geometry.js';

const GRAPH_SPATIAL_CELL_METERS = 400;
const MIN_EDGE_METERS = 1.5;
const MAX_EDGE_METERS = 320;

function cellKey(x, y) {
  return `${x},${y}`;
}

function cellRange(bounds, cellSize) {
  return {
    minX: Math.floor(bounds.minX / cellSize),
    maxX: Math.floor(bounds.maxX / cellSize),
    minY: Math.floor(bounds.minY / cellSize),
    maxY: Math.floor(bounds.maxY / cellSize)
  };
}

function addToBuckets(buckets, value, range) {
  for (let x = range.minX; x <= range.maxX; x += 1) {
    for (let y = range.minY; y <= range.maxY; y += 1) {
      const key = cellKey(x, y);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(value);
    }
  }
}

function createSpatialIndex(graph, nodeById, cellSize = GRAPH_SPATIAL_CELL_METERS) {
  const nodeBuckets = new Map();
  const edgeBuckets = new Map();
  for (const node of graph.nodes) {
    const x = Math.floor(node.x / cellSize);
    const y = Math.floor(node.y / cellSize);
    const key = cellKey(x, y);
    if (!nodeBuckets.has(key)) nodeBuckets.set(key, []);
    nodeBuckets.get(key).push(node);
  }
  for (const edge of graph.edges) {
    const a = nodeById.get(edge.a);
    const b = nodeById.get(edge.b);
    if (!a || !b) continue;
    addToBuckets(edgeBuckets, edge, cellRange({
      minX: Math.min(a.x, b.x),
      minY: Math.min(a.y, b.y),
      maxX: Math.max(a.x, b.x),
      maxY: Math.max(a.y, b.y)
    }, cellSize));
  }
  return { cellSize, nodeBuckets, edgeBuckets };
}

function valuesInBounds(buckets, range) {
  const values = new Set();
  for (let x = range.minX; x <= range.maxX; x += 1) {
    for (let y = range.minY; y <= range.maxY; y += 1) {
      for (const value of buckets.get(cellKey(x, y)) ?? []) values.add(value);
    }
  }
  return [...values];
}

export function graphElementsInBounds(graph, bounds) {
  const index = graph?.spatialIndex;
  if (!index) return { nodes: graph?.nodes ?? [], edges: graph?.edges ?? [] };
  const range = cellRange(bounds, index.cellSize);
  return {
    nodes: valuesInBounds(index.nodeBuckets, range),
    edges: valuesInBounds(index.edgeBuckets, range)
  };
}

export function graphElementsNearPoint(graph, point, radius) {
  return graphElementsInBounds(graph, {
    minX: point.x - radius,
    minY: point.y - radius,
    maxX: point.x + radius,
    maxY: point.y + radius
  });
}

export function buildRoadGraphFromSegments(segments, center) {
  const clustered = clusterSegmentEndpoints(segments, center);
  const edges = [];
  const edgeKeys = new Set();

  for (const segment of segments) {
    const a = clustered.nodeByRoot.get(clustered.find(segment.pointA));
    const b = clustered.nodeByRoot.get(clustered.find(segment.pointB));
    if (!a || !b || a.id === b.id) continue;
    const length = distance(a, b);
    if (length < MIN_EDGE_METERS || length > MAX_EDGE_METERS) continue;
    const pair = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
    const wayId = String(segment.wayId ?? segment.id);
    const edgeKey = `${pair}|${wayId}`;
    if (edgeKeys.has(edgeKey)) continue;
    edgeKeys.add(edgeKey);

    const edge = {
      id: stableId('edge', pair, wayId, segment.id),
      a: a.id,
      b: b.id,
      length,
      points: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }],
      barrier: null,
      roadWidth: segment.roadWidth,
      lanes: segment.lanes,
      highway: segment.highway,
      name: segment.name,
      oneway: segment.oneway,
      sourceWayIds: [wayId],
      mergedSegmentIds: [...(segment.mergedSegmentIds ?? [segment.id])]
    };
    edge.angle = segmentAngle({ a, b });
    edge.mid = segmentMidpoint({ a, b });
    edges.push(edge);
  }

  return attachGraphIndexes({ nodes: clustered.nodes, edges, center, source: 'osm', roadSpecVersion: 3 });
}

export function attachGraphIndexes(graph) {
  const nodeById = new Map(graph.nodes.map(node => [node.id, node]));
  const edgeById = new Map();
  const adjacency = new Map(graph.nodes.map(node => [node.id, []]));
  for (const node of graph.nodes) {
    node.sourceNodeIds = [...new Set((node.sourceNodeIds ?? []).map(String))];
  }
  for (const edge of graph.edges) {
    const a = nodeById.get(edge.a);
    const b = nodeById.get(edge.b);
    if (a && b) {
      edge.points ??= [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
      edge.angle ??= segmentAngle({ a, b });
      edge.mid ??= segmentMidpoint({ a, b });
    }
    edge.mergedSegmentIds ??= [edge.id];
    edge.sourceWayIds = [...new Set((edge.sourceWayIds ?? []).map(String))];
    edgeById.set(edge.id, edge);
    adjacency.get(edge.a)?.push({ to: edge.b, edgeId: edge.id, length: edge.length });
    adjacency.get(edge.b)?.push({ to: edge.a, edgeId: edge.id, length: edge.length });
  }
  const spatialIndex = createSpatialIndex(graph, nodeById);
  const terminalNodes = graph.nodes.filter(node => (adjacency.get(node.id)?.length ?? 0) === 1);
  Object.defineProperties(graph, {
    nodeById: { value: nodeById, enumerable: false, writable: true, configurable: true },
    edgeById: { value: edgeById, enumerable: false, writable: true, configurable: true },
    adjacency: { value: adjacency, enumerable: false, writable: true, configurable: true },
    spatialIndex: { value: spatialIndex, enumerable: false, writable: true, configurable: true },
    terminalNodes: { value: terminalNodes, enumerable: false, writable: true, configurable: true }
  });
  return graph;
}
