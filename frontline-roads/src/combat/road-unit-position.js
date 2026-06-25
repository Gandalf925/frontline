export function roadUnitPosition(state, unit) {
  const graph = state.world.roadGraph;
  if (!unit?.edgeId || !unit.path) return graph?.nodeById?.get(unit?.nodeId) ?? { x: 0, y: 0 };
  const edge = graph.edgeById.get(unit.edgeId);
  const fromId = unit.path.nodeIds[unit.pathIndex];
  const toId = unit.path.nodeIds[unit.pathIndex + 1];
  const from = graph.nodeById.get(fromId);
  const to = graph.nodeById.get(toId);
  if (!edge || !from || !to) return graph.nodeById.get(unit.nodeId) ?? { x: 0, y: 0 };
  const progress = Math.max(0, Math.min(1, unit.edgeProgress / Math.max(1, edge.length)));
  return { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress };
}
