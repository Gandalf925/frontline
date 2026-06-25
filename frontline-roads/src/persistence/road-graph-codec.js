const ROAD_GRAPH_FORMAT_V1 = 'frontline-road-graph-1';
const ROAD_GRAPH_FORMAT_V2 = 'frontline-road-graph-2';

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function rounded(value, precision = 10) {
  return Math.round(finiteNumber(value) * precision) / precision;
}

function stringIds(values) {
  return [...new Set((values ?? []).map(String).filter(Boolean))];
}

export function encodeRoadGraph(graph) {
  if (!graph?.nodes || !graph?.edges) return graph;
  return {
    format: ROAD_GRAPH_FORMAT_V2,
    center: graph.center ? { lat: graph.center.lat, lon: graph.center.lon } : null,
    source: graph.source ?? 'osm',
    roadSpecVersion: Number(graph.roadSpecVersion) || 1,
    nodes: graph.nodes.map(node => [
      node.id,
      rounded(node.x),
      rounded(node.y),
      stringIds(node.sourceNodeIds)
    ]),
    edges: graph.edges.map(edge => [
      edge.id,
      edge.a,
      edge.b,
      rounded(edge.length),
      rounded(edge.roadWidth ?? 5),
      Math.max(1, Math.round(finiteNumber(edge.lanes, 1))),
      edge.highway ?? 'residential',
      edge.name ?? '',
      edge.oneway ? 1 : 0,
      stringIds(edge.sourceWayIds)
    ])
  };
}

export function decodeRoadGraph(value) {
  if (!value || ![ROAD_GRAPH_FORMAT_V1, ROAD_GRAPH_FORMAT_V2].includes(value.format)) return value;
  const hasSourceIdentity = value.format === ROAD_GRAPH_FORMAT_V2;
  return {
    center: value.center ? { lat: finiteNumber(value.center.lat), lon: finiteNumber(value.center.lon) } : null,
    source: value.source ?? 'osm',
    roadSpecVersion: Number(value.roadSpecVersion) || 1,
    nodes: (value.nodes ?? []).map(row => ({
      id: row[0],
      x: finiteNumber(row[1]),
      y: finiteNumber(row[2]),
      sourceNodeIds: hasSourceIdentity ? stringIds(row[3]) : []
    })),
    edges: (value.edges ?? []).map(row => ({
      id: row[0],
      a: row[1],
      b: row[2],
      length: Math.max(0.1, finiteNumber(row[3], 0.1)),
      roadWidth: Math.max(1, finiteNumber(row[4], 5)),
      lanes: Math.max(1, Math.round(finiteNumber(row[5], 1))),
      highway: row[6] ?? 'residential',
      name: row[7] ?? '',
      oneway: Boolean(row[8]),
      sourceWayIds: hasSourceIdentity ? stringIds(row[9]) : []
    }))
  };
}
