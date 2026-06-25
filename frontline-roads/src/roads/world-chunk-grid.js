import { ROAD_CONFIG } from '../core/constants.js';
import { latLonToXY, xyToLatLon } from '../location/location-privacy.js';

export const ROAD_CHUNK_VERSION = 4;
export const ROAD_ACQUISITION_SPEC_VERSION = 3;

export function chunkId(x, y) {
  return `${x}:${y}`;
}

export function parseChunkId(id) {
  const [x, y] = String(id).split(':').map(Number);
  if (!Number.isInteger(x) || !Number.isInteger(y)) throw new TypeError(`Invalid road chunk id: ${id}`);
  return { x, y, id: chunkId(x, y) };
}

export function chunkForWorldPoint(point, sizeMeters = ROAD_CONFIG.chunkSizeMeters) {
  const x = Math.floor(Number(point.x) / sizeMeters);
  const y = Math.floor(Number(point.y) / sizeMeters);
  return { x, y, id: chunkId(x, y) };
}

export function chunkForLocation(location, worldCenter, sizeMeters = ROAD_CONFIG.chunkSizeMeters) {
  return chunkForWorldPoint(latLonToXY(location.lat, location.lon, worldCenter), sizeMeters);
}

export function chunkBounds(chunk, sizeMeters = ROAD_CONFIG.chunkSizeMeters) {
  return {
    minX: chunk.x * sizeMeters,
    minY: chunk.y * sizeMeters,
    maxX: (chunk.x + 1) * sizeMeters,
    maxY: (chunk.y + 1) * sizeMeters
  };
}


export function chunkFullyInsideCircle(chunk, centerPoint, radiusMeters, sizeMeters = ROAD_CONFIG.chunkSizeMeters) {
  const bounds = chunkBounds(chunk, sizeMeters);
  return [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.minX, y: bounds.maxY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY }
  ].every(point => Math.hypot(point.x - centerPoint.x, point.y - centerPoint.y) <= radiusMeters);
}

export function chunkCenterWorld(chunk, sizeMeters = ROAD_CONFIG.chunkSizeMeters) {
  return {
    x: (chunk.x + 0.5) * sizeMeters,
    y: (chunk.y + 0.5) * sizeMeters
  };
}

export function chunkCenterLocation(chunk, worldCenter, sizeMeters = ROAD_CONFIG.chunkSizeMeters) {
  const point = chunkCenterWorld(chunk, sizeMeters);
  return xyToLatLon(point.x, point.y, worldCenter);
}

export function chunksNearWorldPoint(point, sizeMeters = ROAD_CONFIG.chunkSizeMeters, edgeDistanceMeters = ROAD_CONFIG.chunkPrefetchDistanceMeters) {
  const current = chunkForWorldPoint(point, sizeMeters);
  const bounds = chunkBounds(current, sizeMeters);
  const xs = [current.x];
  const ys = [current.y];
  if (point.x - bounds.minX <= edgeDistanceMeters) xs.push(current.x - 1);
  if (bounds.maxX - point.x <= edgeDistanceMeters) xs.push(current.x + 1);
  if (point.y - bounds.minY <= edgeDistanceMeters) ys.push(current.y - 1);
  if (bounds.maxY - point.y <= edgeDistanceMeters) ys.push(current.y + 1);
  const result = [];
  for (const y of [...new Set(ys)]) {
    for (const x of [...new Set(xs)]) result.push({ x, y, id: chunkId(x, y) });
  }
  return result;
}

export function neighboringChunks(chunk, radius = 1) {
  const result = [];
  for (let y = chunk.y - radius; y <= chunk.y + radius; y += 1) {
    for (let x = chunk.x - radius; x <= chunk.x + radius; x += 1) result.push({ x, y, id: chunkId(x, y) });
  }
  return result;
}


export function chunksIntersectingCircle(centerPoint, radiusMeters, sizeMeters = ROAD_CONFIG.chunkSizeMeters) {
  const min = chunkForWorldPoint({ x: centerPoint.x - radiusMeters, y: centerPoint.y - radiusMeters }, sizeMeters);
  const max = chunkForWorldPoint({ x: centerPoint.x + radiusMeters, y: centerPoint.y + radiusMeters }, sizeMeters);
  const result = [];
  for (let y = min.y; y <= max.y; y += 1) {
    for (let x = min.x; x <= max.x; x += 1) {
      const chunk = { x, y, id: chunkId(x, y) };
      const bounds = chunkBounds(chunk, sizeMeters);
      const nearestX = Math.max(bounds.minX, Math.min(centerPoint.x, bounds.maxX));
      const nearestY = Math.max(bounds.minY, Math.min(centerPoint.y, bounds.maxY));
      if (Math.hypot(centerPoint.x - nearestX, centerPoint.y - nearestY) > radiusMeters) continue;
      chunk.center = chunkCenterWorld(chunk, sizeMeters);
      result.push(chunk);
    }
  }
  return result;
}


function uniqueChunkIds(values = []) {
  return [...new Set(values.map(String))];
}

export function graphCoveredChunkIds(graph, sizeMeters = ROAD_CONFIG.chunkSizeMeters) {
  const ids = new Set();
  for (const node of graph?.nodes ?? []) {
    for (const id of node.chunkIds ?? []) ids.add(String(id));
    if (Number.isFinite(Number(node.x)) && Number.isFinite(Number(node.y))) {
      ids.add(chunkForWorldPoint(node, sizeMeters).id);
    }
  }
  for (const edge of graph?.edges ?? []) for (const id of edge.chunkIds ?? []) ids.add(String(id));
  return [...ids];
}

export function createRoadChunkState({
  initialLoadedChunkIds = [],
  initialIntegratedChunkIds = initialLoadedChunkIds,
  initialRefreshChunkIds = [],
  initialObservedChunkIds = []
} = {}) {
  const loaded = uniqueChunkIds(initialLoadedChunkIds);
  const integrated = uniqueChunkIds([...initialIntegratedChunkIds, ...loaded]);
  const refresh = uniqueChunkIds(initialRefreshChunkIds).filter(id => integrated.includes(id));
  const observed = uniqueChunkIds(initialObservedChunkIds).filter(id => loaded.includes(id));
  return {
    version: ROAD_CHUNK_VERSION,
    acquisitionSpecVersion: ROAD_ACQUISITION_SPEC_VERSION,
    sizeMeters: ROAD_CONFIG.chunkSizeMeters,
    loaded,
    empty: [],
    cached: [],
    integrated,
    refresh,
    playerObserved: observed,
    surveyed: [],
    failed: {},
    lastAcquisition: null,
    updatedAt: Date.now()
  };
}

function migrateLegacyRoadChunkState(world, legacy) {
  const explicitGraphIds = new Set(graphCoveredChunkIds(world?.roadGraph));
  const surveyed = uniqueChunkIds(Array.isArray(legacy?.surveyed) ? legacy.surveyed : []);
  const legacyIntegrated = new Set(uniqueChunkIds(Array.isArray(legacy?.integrated) ? legacy.integrated : []));
  // v2 accepted a single empty response and old IndexedDB payloads. Neither is
  // trusted after the acquisition rewrite, so those areas are made eligible for
  // a fresh, independently confirmed request.
  const confirmed = new Set([...explicitGraphIds, ...surveyed]);
  const loaded = uniqueChunkIds(Array.isArray(legacy?.loaded) ? legacy.loaded : []).filter(id => confirmed.has(id));
  for (const id of explicitGraphIds) if (!loaded.includes(id)) loaded.push(id);
  const known = new Set(loaded);
  const playerObserved = uniqueChunkIds(Array.isArray(legacy?.playerObserved) ? legacy.playerObserved : [])
    .filter(id => known.has(id));
  return {
    version: ROAD_CHUNK_VERSION,
    acquisitionSpecVersion: ROAD_ACQUISITION_SPEC_VERSION,
    sizeMeters: ROAD_CONFIG.chunkSizeMeters,
    loaded,
    empty: [],
    cached: [],
    integrated: loaded.filter(id => explicitGraphIds.has(id) || legacyIntegrated.has(id)),
    refresh: [...loaded],
    playerObserved,
    surveyed: surveyed.filter(id => loaded.includes(id)),
    failed: {},
    lastAcquisition: null,
    updatedAt: Number(legacy?.updatedAt) || Date.now()
  };
}

export function ensureRoadChunkState(world) {
  if (!world || typeof world !== 'object') return null;
  const current = world.roadChunks;
  if (!current || !Array.isArray(current.loaded)) {
    world.roadChunks = createRoadChunkState();
    return world.roadChunks;
  }
  if (current.version !== ROAD_CHUNK_VERSION || current.acquisitionSpecVersion !== ROAD_ACQUISITION_SPEC_VERSION) {
    world.roadChunks = migrateLegacyRoadChunkState(world, current);
    return world.roadChunks;
  }
  current.acquisitionSpecVersion = ROAD_ACQUISITION_SPEC_VERSION;
  current.sizeMeters = ROAD_CONFIG.chunkSizeMeters;
  current.empty = Array.isArray(current.empty) ? current.empty : [];
  current.cached = Array.isArray(current.cached) ? current.cached : [];
  current.integrated = Array.isArray(current.integrated) ? current.integrated : [...current.loaded];
  current.refresh = Array.isArray(current.refresh) ? current.refresh : [];
  current.failed = current.failed && typeof current.failed === 'object' ? current.failed : {};
  current.lastAcquisition = current.lastAcquisition && typeof current.lastAcquisition === 'object' ? current.lastAcquisition : null;
  current.surveyed = Array.isArray(current.surveyed) ? current.surveyed : [];
  current.playerObserved = Array.isArray(current.playerObserved) ? current.playerObserved : current.loaded.filter(id => !current.surveyed.includes(id));
  current.updatedAt = Number(current.updatedAt) || Date.now();
  const graphIds = graphCoveredChunkIds(world.roadGraph, current.sizeMeters);
  current.loaded = uniqueChunkIds([...current.loaded, ...graphIds]);
  current.empty = uniqueChunkIds(current.empty).filter(id => !current.loaded.includes(id));
  current.cached = uniqueChunkIds(current.cached);
  current.refresh = uniqueChunkIds(current.refresh).filter(id => current.loaded.includes(id) || current.empty.includes(id) || current.integrated.includes(id));
  current.integrated = uniqueChunkIds([...current.integrated, ...graphIds]);
  current.playerObserved = uniqueChunkIds(current.playerObserved).filter(id => current.loaded.includes(id) || current.empty.includes(id));
  current.surveyed = uniqueChunkIds(current.surveyed).filter(id => current.loaded.includes(id));
  return current;
}
