import { ROAD_CONFIG } from '../core/constants.js';
import { AppError, ErrorCode } from '../core/errors.js';
import { distance, stableId } from '../core/utilities.js';
import { latLonToXY } from '../location/location-privacy.js';
import { isAllowedWay, normalizeRoadName, parseLaneCount, roadWidthMeters } from './road-filter.js';
import { segmentAngle, segmentMidpoint, pointToSegmentProjection } from './geometry.js';

function interpolateLocation(a, b, t) {
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
}

function segmentTouchesBounds(a, b, bounds) {
  if (!bounds) return true;
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x, b.x);
  const maxY = Math.max(a.y, b.y);
  return maxX >= bounds.minX && minX <= bounds.maxX && maxY >= bounds.minY && minY <= bounds.maxY;
}

function exclusionReason(tags, way) {
  if (!Array.isArray(way?.geometry) || way.geometry.length < 2) return 'missing-geometry';
  if (!tags.highway) return 'missing-highway';
  if (tags.access === 'private' || tags.access === 'no') return 'restricted-access';
  if (tags.area === 'yes') return 'area';
  if (!isAllowedWay(tags)) return 'unsupported-highway-or-service';
  return null;
}

export function createRoadAcquisitionDiagnostics(data = null) {
  return {
    responseElements: Array.isArray(data?.elements) ? data.elements.length : 0,
    candidateWays: 0,
    acceptedWays: 0,
    excludedWays: 0,
    excludedByReason: {},
    highwayWayCounts: {},
    rawSegmentCount: 0,
    retainedSegmentCount: 0,
    clippedSegmentCount: 0,
    tooShortSegmentCount: 0
  };
}

function recordCount(target, key) {
  target[key] = (target[key] ?? 0) + 1;
}

export function parseOverpassSegments(data, center, {
  clipCenter = center,
  clipBounds = null,
  maxDistanceMeters = ROAD_CONFIG.maxDistanceFromCenterMeters,
  minimumRawSegments = ROAD_CONFIG.minimumRawSegments,
  diagnostics = createRoadAcquisitionDiagnostics(data)
} = {}) {
  if (!Array.isArray(data?.elements)) {
    throw new AppError(ErrorCode.ROAD_DATA_INVALID, '道路データの形式が不正です。');
  }

  diagnostics.responseElements = data.elements.length;
  const clipPoint = clipCenter ? latLonToXY(clipCenter.lat, clipCenter.lon, center) : null;
  const segments = [];
  for (const way of data.elements) {
    if (way?.type && way.type !== 'way') continue;
    diagnostics.candidateWays += 1;
    const tags = way.tags ?? {};
    const excluded = exclusionReason(tags, way);
    if (excluded) {
      diagnostics.excludedWays += 1;
      recordCount(diagnostics.excludedByReason, excluded);
      continue;
    }

    diagnostics.acceptedWays += 1;
    recordCount(diagnostics.highwayWayCounts, tags.highway);
    const highway = tags.highway;
    const lanes = parseLaneCount(tags, highway);
    const width = roadWidthMeters(highway, lanes, tags);
    const name = normalizeRoadName(tags);
    const oneway = tags.oneway === 'yes' || tags.oneway === '1' || tags.junction === 'roundabout';
    const layer = Number.parseInt(tags.layer ?? '0', 10) || 0;
    const bridge = Boolean(tags.bridge && tags.bridge !== 'no');
    const tunnel = Boolean(tags.tunnel && tags.tunnel !== 'no');

    for (let index = 0; index < way.geometry.length - 1; index += 1) {
      const sourceA = way.geometry[index];
      const sourceB = way.geometry[index + 1];
      const rawA = latLonToXY(sourceA.lat, sourceA.lon, center);
      const rawB = latLonToXY(sourceB.lat, sourceB.lon, center);
      const rawLength = distance(rawA, rawB);
      diagnostics.rawSegmentCount += 1;
      if (rawLength < ROAD_CONFIG.minSegmentLengthMeters) {
        diagnostics.tooShortSegmentCount += 1;
        continue;
      }
      const partCount = Math.max(1, Math.ceil(rawLength / ROAD_CONFIG.maxSegmentLengthMeters));
      for (let part = 0; part < partCount; part += 1) {
        const tA = part / partCount;
        const tB = (part + 1) / partCount;
        const locationA = interpolateLocation(sourceA, sourceB, tA);
        const locationB = interpolateLocation(sourceA, sourceB, tB);
        const a = latLonToXY(locationA.lat, locationA.lon, center);
        const b = latLonToXY(locationB.lat, locationB.lon, center);
        const length = distance(a, b);
        if (length < ROAD_CONFIG.minSegmentLengthMeters) {
          diagnostics.tooShortSegmentCount += 1;
          continue;
        }
        const insideBounds = segmentTouchesBounds(a, b, clipBounds);
        const insideRadius = !clipPoint || !Number.isFinite(maxDistanceMeters)
          || pointToSegmentProjection(clipPoint, a, b).distance <= maxDistanceMeters;
        if (!insideBounds || !insideRadius) {
          diagnostics.clippedSegmentCount += 1;
          continue;
        }
        const sourceNodeA = part === 0 ? way.nodes?.[index] ?? null : `${way.id}:${index}:${part}`;
        const sourceNodeB = part === partCount - 1 ? way.nodes?.[index + 1] ?? null : `${way.id}:${index}:${part + 1}`;
        const segment = {
          id: stableId('segment', way.id, index, part, sourceA.lat, sourceA.lon, sourceB.lat, sourceB.lon),
          wayId: String(way.id),
          sourceNodeA: sourceNodeA == null ? null : String(sourceNodeA),
          sourceNodeB: sourceNodeB == null ? null : String(sourceNodeB),
          a,
          b,
          highway,
          lanes,
          roadWidth: width,
          name,
          oneway,
          layer,
          bridge,
          tunnel
        };
        segment.mid = segmentMidpoint(segment);
        segment.angle = segmentAngle(segment);
        segments.push(segment);
        diagnostics.retainedSegmentCount += 1;
      }
    }
  }

  if (segments.length < minimumRawSegments) {
    throw new AppError(ErrorCode.ROAD_NETWORK_TOO_SMALL, '周辺の利用可能な道路が少なすぎます。別の場所で再試行してください。', {
      details: `elements=${diagnostics.responseElements}, ways=${diagnostics.acceptedWays}, segments=${segments.length}`
    });
  }

  return segments;
}
