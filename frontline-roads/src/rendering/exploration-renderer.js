import { explorationSitePresentation } from '../exploration/exploration-system.js';

export function drawExplorationSites(context, state, camera, timeMs = 0, preferences = {}) {
  const sites = state?.world?.explorationSites ?? [];
  const graph = state?.world?.roadGraph;
  if (!graph?.nodeById || sites.length === 0) return;
  const quality = preferences.quality ?? 'balanced';
  context.save();
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  for (const site of sites) {
    if (site.status === 'CLEARED') continue;
    const node = graph.nodeById.get(site.nodeId);
    if (!node) continue;
    const point = camera.worldToScreen(node);
    if (point.x < -30 || point.y < -30 || point.x > camera.viewportWidth + 30 || point.y > camera.viewportHeight + 30) continue;
    const presentation = explorationSitePresentation(site);
    const pulse = 1 + Math.sin(timeMs * 0.004 + site.id.length) * 0.15;
    const radius = (site.type === 'enemySource' ? 10 : 8) * pulse;
    const hostile = site.type === 'enemySource';
    context.strokeStyle = hostile ? 'rgba(255,89,80,0.95)' : 'rgba(255,209,102,0.95)';
    context.fillStyle = hostile ? 'rgba(255,66,58,0.16)' : 'rgba(255,209,102,0.14)';
    context.lineWidth = site.interactionActive ? 2.5 : 1.5;
    context.beginPath(); context.arc(point.x, point.y, radius, 0, Math.PI * 2); context.fill(); context.stroke();
    context.beginPath(); context.arc(point.x, point.y, radius + 5, 0, Math.PI * 2); context.stroke();
    if (quality !== 'minimal' && typeof context.fillText === 'function') {
      context.font = 'bold 10px monospace';
      context.fillStyle = hostile ? '#ff9a84' : '#ffe29a';
      context.fillText(presentation.icon, point.x, point.y + 0.5);
    }
  }
  context.restore();
}
