import { stableId } from '../core/utilities.js';
import { attachGraphIndexes } from '../roads/road-graph.js';
import { xyToLatLon } from '../location/location-privacy.js';

function copyEdgeMetadata(edge) {
  return {
    barrier: null,
    roadWidth: edge.roadWidth,
    lanes: edge.lanes,
    highway: edge.highway,
    name: edge.name,
    oneway: edge.oneway,
    mergedSegmentIds: [...(edge.mergedSegmentIds ?? [])]
  };
}

export function insertBaseNodeOnEdge(graph, selection) {
  const sourceEdge = graph.edgeById.get(selection.edgeId);
  if (!sourceEdge) throw new Error('選択した道路が見つかりません。');
  const endpointThreshold = 0.04;
  if (selection.t <= endpointThreshold) {
    return { graph, nodeId: sourceEdge.a };
  }
  if (selection.t >= 1 - endpointThreshold) {
    return { graph, nodeId: sourceEdge.b };
  }

  const nextGraph = {
    ...graph,
    nodes: graph.nodes.map(node => ({ ...node })),
    edges: graph.edges.filter(edge => edge.id !== sourceEdge.id).map(edge => ({
      ...edge,
      points: edge.points?.map(point => ({ ...point })) ?? []
    }))
  };
  const location = xyToLatLon(selection.point.x, selection.point.y, graph.center);
  const nodeId = stableId('home_node', sourceEdge.id, selection.t.toFixed(6));
  nextGraph.nodes.push({
    id: nodeId,
    x: selection.point.x,
    y: selection.point.y,
    lat: location.lat,
    lon: location.lon,
    kind: 'home-base'
  });

  const a = graph.nodeById.get(sourceEdge.a);
  const b = graph.nodeById.get(sourceEdge.b);
  const firstLength = sourceEdge.length * selection.t;
  const secondLength = sourceEdge.length - firstLength;
  nextGraph.edges.push({
    id: stableId('edge', sourceEdge.id, 'a', nodeId),
    a: sourceEdge.a,
    b: nodeId,
    length: firstLength,
    points: [{ x: a.x, y: a.y }, { ...selection.point }],
    ...copyEdgeMetadata(sourceEdge)
  });
  nextGraph.edges.push({
    id: stableId('edge', sourceEdge.id, nodeId, 'b'),
    a: nodeId,
    b: sourceEdge.b,
    length: secondLength,
    points: [{ ...selection.point }, { x: b.x, y: b.y }],
    ...copyEdgeMetadata(sourceEdge)
  });

  return { graph: attachGraphIndexes(nextGraph), nodeId };
}
