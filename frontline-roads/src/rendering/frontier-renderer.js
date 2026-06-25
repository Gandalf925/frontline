import { frontierPresentation } from '../exploration/frontier-system.js';

function visible(point, camera, margin = 60) {
  return point.x >= -margin && point.y >= -margin && point.x <= camera.viewportWidth + margin && point.y <= camera.viewportHeight + margin;
}

export function drawFrontierSignals(context, state, camera, timeMs = 0, preferences = {}) {
  const sources = state?.world?.frontierSources ?? [];
  const graph = state?.world?.roadGraph;
  if (!graph?.nodeById || sources.length === 0) return;
  const quality = preferences.quality ?? 'balanced';
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const source of sources) {
    if (source.status === 'CLEARED') continue;
    const node = graph.nodeById.get(source.entryNodeId);
    if (!node) continue;
    const point = camera.worldToScreen(node);
    if (!visible(point, camera)) continue;
    const presentation = frontierPresentation(source);
    const direction = source.direction ?? { x: 0, y: -1 };
    const pulse = 0.55 + Math.sin(timeMs * 0.004 + source.threat) * 0.2;
    const length = quality === 'minimal' ? 20 : 30;
    const tip = { x: point.x + direction.x * length, y: point.y + direction.y * length };
    context.strokeStyle = `rgba(255,132,82,${0.6 + pulse * 0.25})`;
    context.fillStyle = `rgba(255,91,65,${0.12 + pulse * 0.12})`;
    context.lineWidth = 1.5;
    context.setLineDash?.([4, 4]);
    context.beginPath(); context.moveTo(point.x, point.y); context.lineTo(tip.x, tip.y); context.stroke();
    context.setLineDash?.([]);
    context.beginPath(); context.arc(tip.x, tip.y, 7 + source.threat, 0, Math.PI * 2); context.fill(); context.stroke();
    context.beginPath();
    context.moveTo(tip.x - direction.y * 4, tip.y + direction.x * 4);
    context.lineTo(tip.x + direction.x * 8, tip.y + direction.y * 8);
    context.lineTo(tip.x + direction.y * 4, tip.y - direction.x * 4);
    context.closePath?.(); context.fill(); context.stroke();
    if (quality !== 'minimal' && typeof context.fillText === 'function') {
      context.font = '11px monospace';
      context.fillStyle = 'rgba(255,190,150,0.92)';
      context.fillText(`${presentation.stage} T${presentation.threat}`, tip.x + 11, tip.y - 8);
    }
  }
  context.restore();
}
