import { BUILD_RANGE_METERS, DEFENSE_DEFINITIONS } from '../combat/definitions.js';

const TAU = Math.PI * 2;

export function clipSegmentToCircle(a, b, center, radius) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const fx = a.x - center.x;
  const fy = a.y - center.y;
  const qa = dx * dx + dy * dy;
  if (qa === 0) return Math.hypot(fx, fy) <= radius ? { a: { ...a }, b: { ...b } } : null;

  const qb = 2 * (fx * dx + fy * dy);
  const qc = fx * fx + fy * fy - radius * radius;
  const discriminant = qb * qb - 4 * qa * qc;
  const aInside = fx * fx + fy * fy <= radius * radius;
  const bx = b.x - center.x;
  const by = b.y - center.y;
  const bInside = bx * bx + by * by <= radius * radius;

  if (discriminant < 0) return aInside && bInside ? { a: { ...a }, b: { ...b } } : null;
  const root = Math.sqrt(discriminant);
  const first = (-qb - root) / (2 * qa);
  const second = (-qb + root) / (2 * qa);
  const start = Math.max(0, Math.min(first, second));
  const end = Math.min(1, Math.max(first, second));
  if (end < start) return null;
  return {
    a: { x: a.x + dx * start, y: a.y + dy * start },
    b: { x: a.x + dx * end, y: a.y + dy * end }
  };
}

function drawWorldCircle(context, camera, world, radiusMeters, { stroke, fill = null, dash = [], width = 1 }) {
  const point = camera.worldToScreen(world);
  const radius = Math.max(1, radiusMeters * camera.scale);
  context.save();
  context.strokeStyle = stroke;
  context.fillStyle = fill ?? 'transparent';
  context.lineWidth = width;
  context.setLineDash(dash);
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, TAU);
  if (fill) context.fill();
  context.stroke();
  context.restore();
}

function anchorPalette(anchor, affordable) {
  if (!affordable) return {
    stroke: 'rgba(255,180,84,0.52)',
    fill: 'rgba(255,180,84,0.014)',
    marker: '#ffb454'
  };
  if (anchor.id === 'player') return {
    stroke: 'rgba(255,209,102,0.58)',
    fill: 'rgba(255,209,102,0.018)',
    marker: '#ffd166'
  };
  if (anchor.kind === 'FIELD') return {
    stroke: 'rgba(101,215,255,0.50)',
    fill: 'rgba(101,215,255,0.016)',
    marker: '#65d7ff'
  };
  if (anchor.kind === 'EXPEDITION') return {
    stroke: 'rgba(244,245,154,0.62)',
    fill: 'rgba(244,245,154,0.020)',
    marker: '#f4f59a'
  };
  return {
    stroke: 'rgba(101,255,208,0.48)',
    fill: 'rgba(101,255,208,0.014)',
    marker: '#65ffd0'
  };
}

function drawAnchor(context, camera, anchor, affordable, quality) {
  const palette = anchorPalette(anchor, affordable);
  drawWorldCircle(context, camera, anchor.point, anchor.range ?? BUILD_RANGE_METERS, {
    stroke: palette.stroke,
    fill: palette.fill,
    dash: anchor.id === 'player' ? [4, 5] : anchor.kind === 'FIELD' ? [3, 4] : anchor.kind === 'EXPEDITION' ? [2, 3] : [8, 7],
    width: 1.2
  });
  const point = camera.worldToScreen(anchor.point);
  context.save();
  context.strokeStyle = palette.marker;
  context.fillStyle = anchor.id === 'player' ? 'rgba(255,209,102,0.22)' : anchor.kind === 'EXPEDITION' ? 'rgba(244,245,154,0.24)' : 'rgba(101,255,208,0.22)';
  context.lineWidth = 1.4;
  if (quality === 'full') {
    context.shadowColor = palette.marker;
    context.shadowBlur = 8;
  }
  context.beginPath();
  context.arc(point.x, point.y, anchor.id === 'player' ? 6 : 5, 0, TAU);
  context.fill();
  context.stroke();
  context.restore();
}

function drawTowerSites(context, camera, sites, color, quality) {
  context.save();
  context.strokeStyle = color;
  context.fillStyle = quality === 'minimal' ? 'rgba(101,255,208,0.10)' : 'rgba(101,255,208,0.17)';
  context.lineWidth = 1;
  if (quality === 'full') {
    context.shadowColor = color;
    context.shadowBlur = 6;
  }
  for (const site of sites) {
    const point = camera.worldToScreen(site.point);
    context.beginPath();
    context.arc(point.x, point.y, 5, 0, TAU);
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(point.x - 8, point.y);
    context.lineTo(point.x + 8, point.y);
    context.moveTo(point.x, point.y - 8);
    context.lineTo(point.x, point.y + 8);
    context.stroke();
  }
  context.restore();
}

function drawBarrierSites(context, camera, sites, anchors, color, quality) {
  context.save();
  context.strokeStyle = color;
  context.lineWidth = quality === 'minimal' ? 2 : 3;
  context.setLineDash([5, 5]);
  if (quality === 'full') {
    context.shadowColor = color;
    context.shadowBlur = 7;
  }
  for (const site of sites) {
    for (const anchor of anchors) {
      if (site.anchorIds?.length && !site.anchorIds.includes(anchor.id)) continue;
      const segment = clipSegmentToCircle(site.a, site.b, anchor.point, anchor.range ?? BUILD_RANGE_METERS);
      if (!segment) continue;
      const a = camera.worldToScreen(segment.a);
      const b = camera.worldToScreen(segment.b);
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.stroke();
    }
  }
  context.restore();
}

function drawCandidateAnchorLink(context, camera, placement, candidate, affordable) {
  const anchor = placement.anchors.find(item => item.id === candidate.anchorId);
  if (!anchor) return;
  const from = camera.worldToScreen(anchor.point);
  const to = camera.worldToScreen(candidate.point);
  context.save();
  context.strokeStyle = affordable ? 'rgba(255,255,255,0.34)' : 'rgba(255,180,84,0.40)';
  context.lineWidth = 1;
  context.setLineDash([3, 5]);
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
  context.restore();
}

function drawCandidate(context, camera, placement, timeMs, quality) {
  const candidate = placement.candidate;
  if (!candidate) return;
  const definition = DEFENSE_DEFINITIONS[placement.type];
  const point = camera.worldToScreen(candidate.point);
  const pulse = quality === 'minimal' ? 12 : 13 + Math.sin(timeMs * 0.006) * 1.5;
  const affordable = placement.affordable !== false;
  const color = affordable ? '#ffffff' : '#ffb454';

  drawCandidateAnchorLink(context, camera, placement, candidate, affordable);
  const effectRadius = definition?.type === 'survey' ? definition.surveyRadius : definition?.type === 'fieldBarracks' ? 0 : definition?.range;
  if (definition?.kind === 'tower' && effectRadius > 0) {
    drawWorldCircle(context, camera, candidate.point, effectRadius, {
      stroke: definition?.type === 'survey' ? 'rgba(255,209,102,0.72)' : affordable ? 'rgba(101,215,255,0.72)' : 'rgba(255,180,84,0.68)',
      fill: definition?.type === 'survey' ? 'rgba(255,209,102,0.025)' : affordable ? 'rgba(101,215,255,0.035)' : 'rgba(255,180,84,0.025)',
      dash: [6, 5],
      width: 1.2
    });
  }

  context.save();
  context.strokeStyle = color;
  context.fillStyle = affordable ? 'rgba(255,255,255,0.16)' : 'rgba(255,180,84,0.18)';
  context.lineWidth = 1.8;
  if (quality !== 'minimal') {
    context.shadowColor = color;
    context.shadowBlur = quality === 'full' ? 14 : 8;
  }
  context.beginPath();
  context.arc(point.x, point.y, pulse, 0, TAU);
  context.fill();
  context.stroke();
  context.beginPath();
  context.moveTo(point.x - pulse - 4, point.y);
  context.lineTo(point.x + pulse + 4, point.y);
  context.moveTo(point.x, point.y - pulse - 4);
  context.lineTo(point.x, point.y + pulse + 4);
  context.stroke();
  if (definition?.kind === 'barrier') {
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(point.x - 9, point.y);
    context.lineTo(point.x + 9, point.y);
    context.stroke();
  }
  context.restore();
}

export function drawBuildPlacement(context, camera, placement, timeMs = 0, preferences = {}) {
  if (!placement?.type || !placement.anchors?.length) return;
  const definition = DEFENSE_DEFINITIONS[placement.type];
  if (!definition) return;
  const quality = preferences.quality ?? 'balanced';
  const affordable = placement.affordable !== false;
  const siteColor = affordable ? 'rgba(101,255,208,0.78)' : 'rgba(255,180,84,0.72)';

  for (const anchor of placement.anchors) drawAnchor(context, camera, anchor, affordable, quality);
  const sites = placement.sites ?? [];
  if (definition.kind === 'barrier') drawBarrierSites(context, camera, sites, placement.anchors, siteColor, quality);
  else drawTowerSites(context, camera, sites, siteColor, quality);
  drawCandidate(context, camera, placement, timeMs, quality);
}
