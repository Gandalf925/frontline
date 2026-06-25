import { stableId } from '../core/utilities.js';
import { xyToLatLon } from '../location/location-privacy.js';

class DisjointSet {
  constructor(size) {
    this.parent = Array.from({ length: size }, (_, index) => index);
    this.rank = Array(size).fill(0);
  }
  find(index) {
    if (this.parent[index] !== index) this.parent[index] = this.find(this.parent[index]);
    return this.parent[index];
  }
  union(a, b) {
    let rootA = this.find(a);
    let rootB = this.find(b);
    if (rootA === rootB) return;
    if (this.rank[rootA] < this.rank[rootB]) [rootA, rootB] = [rootB, rootA];
    this.parent[rootB] = rootA;
    if (this.rank[rootA] === this.rank[rootB]) this.rank[rootA] += 1;
  }
}

function sameElevationModel(first, second) {
  return first.segment.layer === second.segment.layer
    && first.segment.bridge === second.segment.bridge
    && first.segment.tunnel === second.segment.tunnel;
}

function canConnect(first, second) {
  if (!sameElevationModel(first, second)) return false;
  const firstId = first.sourceNodeId;
  const secondId = second.sourceNodeId;
  if (firstId && secondId) return firstId === secondId;
  return Math.hypot(first.x - second.x, first.y - second.y) <= 1.5;
}

function nodeIdForGroup(group) {
  const sourceIds = [...new Set(group.map(point => point.sourceNodeId).filter(Boolean))].sort();
  if (sourceIds.length > 0) return stableId('osm-node', ...sourceIds);
  const x = group.reduce((sum, point) => sum + point.x, 0) / group.length;
  const y = group.reduce((sum, point) => sum + point.y, 0) / group.length;
  return stableId('road-node', Math.round(x * 10), Math.round(y * 10));
}

export function clusterSegmentEndpoints(segments, center) {
  const points = [];
  for (const segment of segments) {
    segment.pointA = points.length;
    points.push({ x: segment.a.x, y: segment.a.y, segment, sourceNodeId: segment.sourceNodeA });
    segment.pointB = points.length;
    points.push({ x: segment.b.x, y: segment.b.y, segment, sourceNodeId: segment.sourceNodeB });
  }

  const sets = new DisjointSet(points.length);
  const cellSize = 4;
  const buckets = new Map();

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const cx = Math.floor(point.x / cellSize);
    const cy = Math.floor(point.y / cellSize);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const otherIndex of buckets.get(`${cx + dx},${cy + dy}`) ?? []) {
          const other = points[otherIndex];
          if (point.segment === other.segment || !canConnect(point, other)) continue;
          sets.union(index, otherIndex);
        }
      }
    }
    const key = `${cx},${cy}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(index);
  }

  const groups = new Map();
  for (let index = 0; index < points.length; index += 1) {
    const root = sets.find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(points[index]);
  }

  const nodes = [];
  const nodeByRoot = new Map();
  const usedIds = new Set();
  for (const [root, group] of groups) {
    const x = group.reduce((sum, point) => sum + point.x, 0) / group.length;
    const y = group.reduce((sum, point) => sum + point.y, 0) / group.length;
    const location = xyToLatLon(x, y, center);
    const sourceNodeIds = [...new Set(group.map(point => point.sourceNodeId).filter(Boolean))].sort();
    let id = nodeIdForGroup(group);
    let sequence = 1;
    while (usedIds.has(id)) id = `${nodeIdForGroup(group)}_${sequence++}`;
    usedIds.add(id);
    const node = { id, x, y, lat: location.lat, lon: location.lon, sourceNodeIds };
    nodes.push(node);
    nodeByRoot.set(root, node);
  }

  return { nodes, nodeByRoot, find: index => sets.find(index) };
}
