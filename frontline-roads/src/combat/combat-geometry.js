export function edgeMidpoint(graph, edgeId) {
  const edge = graph.edgeById.get(edgeId);
  if (!edge) return null;
  const a = graph.nodeById.get(edge.a);
  const b = graph.nodeById.get(edge.b);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
