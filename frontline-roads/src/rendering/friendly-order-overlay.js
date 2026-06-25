import { friendlySquadPosition } from '../combat/friendly-force-system.js';
import { FRIENDLY_ORDER_MODE, validateRetreatDestination } from '../combat/friendly-route-planner.js';
import { graphElementsInBounds } from '../roads/road-graph.js';

function visible(point, camera, margin = 20) {
  return point.x >= -margin && point.y >= -margin && point.x <= camera.viewportWidth + margin && point.y <= camera.viewportHeight + margin;
}

function routePoints(state, route, squad) {
  const points = [friendlySquadPosition(state, squad)];
  for (const nodeId of route?.path?.nodeIds ?? []) {
    const node = state.world.roadGraph.nodeById.get(nodeId);
    if (!node) continue;
    const previous = points[points.length - 1];
    if (!previous || previous.x !== node.x || previous.y !== node.y) points.push(node);
  }
  return points;
}

function drawRoute(context, camera, points, selected, index) {
  if (points.length < 2) return;
  context.save();
  context.strokeStyle = selected ? '#fff2a8' : 'rgba(125,220,255,.38)';
  context.lineWidth = selected ? 4 : 2;
  context.setLineDash(selected ? [] : [7, 7]);
  context.beginPath();
  const first = camera.worldToScreen(points[0]);
  context.moveTo(first.x, first.y);
  for (const point of points.slice(1)) {
    const screen = camera.worldToScreen(point);
    context.lineTo(screen.x, screen.y);
  }
  context.stroke();
  context.setLineDash([]);
  const labelPoint = camera.worldToScreen(points[Math.max(0, Math.min(points.length - 1, Math.floor(points.length / 2)))]);
  context.fillStyle = selected ? '#fff2a8' : '#9edfff';
  context.font = '700 10px system-ui, sans-serif';
  context.textAlign = 'center';
  context.fillText(`${index + 1}`, labelPoint.x, labelPoint.y - 7);
  context.restore();
}

function drawNode(context, camera, node, style, label = '') {
  if (!node) return;
  const point = camera.worldToScreen(node);
  if (!visible(point, camera)) return;
  context.save();
  context.strokeStyle = style.stroke;
  context.fillStyle = style.fill;
  context.lineWidth = style.width ?? 2;
  context.beginPath();
  context.arc(point.x, point.y, style.radius ?? 7, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  if (label) {
    context.fillStyle = style.stroke;
    context.font = '700 10px system-ui, sans-serif';
    context.textAlign = 'center';
    context.fillText(label, point.x, point.y - 11);
  }
  context.restore();
}

export function drawFriendlyOrderPlanning(context, state, camera, planning, timeMs = 0) {
  if (!planning?.squadId) return;
  const squad = (state.combat.friendlySquads ?? []).find(item => item.id === planning.squadId && item.hp > 0);
  if (!squad) return;

  context.save();
  context.globalCompositeOperation = 'source-over';
  const worldBounds = camera.screenToWorld ? {
    minX: camera.screenToWorld({ x: -12, y: 0 }).x,
    minY: camera.screenToWorld({ x: 0, y: -12 }).y,
    maxX: camera.screenToWorld({ x: camera.viewportWidth + 12, y: 0 }).x,
    maxY: camera.screenToWorld({ x: 0, y: camera.viewportHeight + 12 }).y
  } : null;
  const visibleNodes = worldBounds
    ? graphElementsInBounds(state.world.roadGraph, worldBounds).nodes
    : state.world.roadGraph.nodes ?? [];
  const choosingRetreatDestination = planning.mode === FRIENDLY_ORDER_MODE.RETREAT && !planning.destinationNodeId;
  for (const node of visibleNodes) {
    if (choosingRetreatDestination && !validateRetreatDestination(state, squad, node.id).ok) continue;
    const point = camera.worldToScreen(node);
    if (!visible(point, camera, 8)) continue;
    context.fillStyle = 'rgba(105,220,255,.45)';
    context.beginPath();
    context.arc(point.x, point.y, 2.2, 0, Math.PI * 2);
    context.fill();
  }

  (planning.routes ?? []).forEach((route, index) => drawRoute(context, camera, routePoints(state, route, squad), index === planning.selectedRouteIndex, index));

  const pulse = 8 + Math.sin(timeMs * 0.006) * 1.5;
  const squadPoint = camera.worldToScreen(friendlySquadPosition(state, squad));
  context.strokeStyle = '#65ffd0';
  context.lineWidth = 2;
  context.beginPath();
  context.arc(squadPoint.x, squadPoint.y, pulse, 0, Math.PI * 2);
  context.stroke();

  const destination = state.world.roadGraph.nodeById.get(planning.destinationNodeId);
  drawNode(context, camera, destination, { stroke: '#ffcf66', fill: 'rgba(255,207,102,.2)', radius: 9, width: 2.5 }, '目的地');
  (planning.waypointNodeIds ?? []).forEach((nodeId, index) => {
    drawNode(context, camera, state.world.roadGraph.nodeById.get(nodeId), { stroke: '#d8b7ff', fill: 'rgba(216,183,255,.18)', radius: 7 }, `経由${index + 1}`);
  });
  context.restore();
}
