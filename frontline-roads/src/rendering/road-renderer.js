import { graphElementsInBounds } from '../roads/road-graph.js';

function drawEdge(context, a, b, width, style, shadow = null, blur = 0) {
  context.strokeStyle = style;
  context.lineWidth = width;
  context.shadowColor = shadow ?? 'transparent';
  context.shadowBlur = blur;
  context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
}

function lineVisible(a, b, width, height, margin = 16) {
  if (a.x < -margin && b.x < -margin) return false;
  if (a.y < -margin && b.y < -margin) return false;
  if (a.x > width + margin && b.x > width + margin) return false;
  if (a.y > height + margin && b.y > height + margin) return false;
  return true;
}

function visibleWorldBounds(camera, marginPixels = 24) {
  const margin = marginPixels / Math.max(0.001, camera.scale);
  const halfWidth = camera.viewportWidth / (2 * camera.scale);
  const halfHeight = camera.viewportHeight / (2 * camera.scale);
  return {
    minX: camera.x - halfWidth - margin,
    minY: camera.y - halfHeight - margin,
    maxX: camera.x + halfWidth + margin,
    maxY: camera.y + halfHeight + margin
  };
}

export function drawRoadGraph(context, graph, camera, { selectedEdgeId = null, timeMs = 0, preferences = {} } = {}) {
  const quality = preferences.quality ?? 'balanced';
  const baseSelection = preferences.sceneMode === 'base-selection';
  const visible = graphElementsInBounds(graph, visibleWorldBounds(camera));
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.globalCompositeOperation = baseSelection ? 'source-over' : 'screen';
  for (const edge of visible.edges) {
    const nodeA = graph.nodeById.get(edge.a);
    const nodeB = graph.nodeById.get(edge.b);
    if (!nodeA || !nodeB) continue;
    const a = camera.worldToScreen(nodeA);
    const b = camera.worldToScreen(nodeB);
    if (!lineVisible(a, b, camera.viewportWidth, camera.viewportHeight)) continue;
    const widthScale = baseSelection ? 1.28 : 1;
    const maxWidth = baseSelection ? 10 : (quality === 'minimal' ? 5 : 8);
    const baseWidth = Math.max(1, Math.min(maxWidth, edge.roadWidth * camera.scale * 0.25 * widthScale));
    const selected = edge.id === selectedEdgeId;
    const pulse = selected ? 0.78 + Math.sin(timeMs * 0.006) * 0.18 : 0;
    const haloColor = baseSelection
      ? (selected ? `rgba(79,255,205,${0.28 + pulse * 0.16})` : 'rgba(18,132,116,0.24)')
      : (selected ? `rgba(79,255,205,${0.18 + pulse * 0.14})` : 'rgba(0,103,94,0.17)');
    const bodyColor = baseSelection
      ? (selected ? '#6dffe2' : 'rgba(76,232,212,0.76)')
      : (selected ? '#48ffd0' : 'rgba(17,174,157,0.4)');
    const coreColor = baseSelection
      ? (selected ? '#f2fffb' : 'rgba(214,255,246,0.88)')
      : (selected ? '#d4fff2' : 'rgba(113,255,222,0.62)');
    const shadowColor = selected ? '#4affd3' : (baseSelection ? 'rgba(88,255,227,0.36)' : null);
    const shadowBlur = selected ? 10 : (baseSelection ? 6 : 0);
    if (quality === 'full' || selected || baseSelection) drawEdge(context, a, b, baseWidth + (baseSelection ? 5 : 4), haloColor);
    drawEdge(context, a, b, baseWidth + (quality === 'minimal' ? (baseSelection ? 1.1 : 0.5) : (baseSelection ? 2.25 : 1.5)), bodyColor, shadowColor, shadowBlur);
    if (quality !== 'minimal' || baseSelection) drawEdge(context, a, b, Math.max(baseSelection ? 1.1 : 0.7, baseWidth * (baseSelection ? 0.52 : 0.38)), coreColor);
  }
  if ((quality === 'full' && camera.scale >= 0.85) || (baseSelection && camera.scale >= 0.6)) {
    context.fillStyle = baseSelection ? 'rgba(176,255,235,0.42)' : 'rgba(112,255,223,0.28)';
    for (const node of visible.nodes) {
      const point = camera.worldToScreen(node);
      if (point.x < -4 || point.y < -4 || point.x > camera.viewportWidth + 4 || point.y > camera.viewportHeight + 4) continue;
      context.beginPath(); context.arc(point.x, point.y, baseSelection ? 1.2 : 1, 0, Math.PI * 2); context.fill();
    }
  }
  context.restore();
}
