import { clamp, distance } from '../core/utilities.js';

export function normalizeUndirectedAngle(angle) {
  let result = angle;
  while (result < 0) result += Math.PI;
  while (result >= Math.PI) result -= Math.PI;
  return result;
}

export function segmentAngle(segment) {
  return normalizeUndirectedAngle(Math.atan2(segment.b.y - segment.a.y, segment.b.x - segment.a.x));
}

export function segmentMidpoint(segment) {
  return { x: (segment.a.x + segment.b.x) / 2, y: (segment.a.y + segment.b.y) / 2 };
}

export function pointToSegmentProjection(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return { point: { ...a }, t: 0, distance: distance(point, a) };
  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared, 0, 1);
  const projected = { x: a.x + dx * t, y: a.y + dy * t };
  return { point: projected, t, distance: distance(point, projected) };
}
