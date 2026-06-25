import { createRoadAcquisitionDiagnostics, parseOverpassSegments } from './road-parser.js';
import { buildRoadGraphFromSegments, attachGraphIndexes } from './road-graph.js';
import { finalizeRoadGraph } from './graph-cleanup.js';
import { ROAD_CONFIG } from '../core/constants.js';
import { chunkBounds, parseChunkId } from './world-chunk-grid.js';

function acquisitionReport({ mode, diagnostics, graph, queryRadiusMeters, retention }) {
  return Object.freeze({
    mode,
    queryRadiusMeters,
    retention,
    responseElements: diagnostics.responseElements,
    candidateWays: diagnostics.candidateWays,
    acceptedWays: diagnostics.acceptedWays,
    excludedWays: diagnostics.excludedWays,
    excludedByReason: { ...diagnostics.excludedByReason },
    highwayWayCounts: { ...diagnostics.highwayWayCounts },
    rawSegmentCount: diagnostics.rawSegmentCount,
    retainedSegmentCount: diagnostics.retainedSegmentCount,
    clippedSegmentCount: diagnostics.clippedSegmentCount,
    tooShortSegmentCount: diagnostics.tooShortSegmentCount,
    graphNodeCount: graph.nodes.length,
    graphEdgeCount: graph.edges.length
  });
}

function attachReport(graph, report) {
  Object.defineProperty(graph, 'acquisitionReport', {
    value: report,
    enumerable: false,
    writable: true,
    configurable: true
  });
  return graph;
}

export class RoadService {
  constructor(overpassClient) {
    this.overpassClient = overpassClient;
    this.lastGraph = null;
    this.lastAcquisitionReport = null;
  }

  async loadAround(location, options = {}) {
    const center = { lat: location.lat, lon: location.lon };
    const rawData = await this.overpassClient.fetchRoads(center.lat, center.lon, {
      ...options,
      radiusMeters: options.radiusMeters ?? ROAD_CONFIG.fetchRadiusMeters,
      queryShape: options.queryShape ?? 'around'
    });
    const diagnostics = createRoadAcquisitionDiagnostics(rawData);
    const rawSegments = parseOverpassSegments(rawData, center, {
      maxDistanceMeters: ROAD_CONFIG.initialRetentionRadiusMeters,
      diagnostics
    });
    const graph = finalizeRoadGraph(buildRoadGraphFromSegments(rawSegments, center));
    const report = acquisitionReport({
      mode: 'initial',
      diagnostics,
      graph,
      queryRadiusMeters: options.radiusMeters ?? ROAD_CONFIG.fetchRadiusMeters,
      retention: { type: 'radius', meters: ROAD_CONFIG.initialRetentionRadiusMeters }
    });
    this.lastAcquisitionReport = report;
    this.lastGraph = attachReport(graph, report);
    return this.lastGraph;
  }

  async loadChunk({
    worldCenter,
    chunkCenter,
    chunkId,
    radiusMeters = ROAD_CONFIG.chunkFetchRadiusMeters,
    chunkSizeMeters = ROAD_CONFIG.chunkSizeMeters
  }, options = {}) {
    if (!worldCenter || !chunkCenter || !chunkId) throw new TypeError('worldCenter, chunkCenter and chunkId are required');
    const rawData = await this.overpassClient.fetchRoads(chunkCenter.lat, chunkCenter.lon, {
      ...options,
      radiusMeters,
      queryShape: 'bbox'
    });
    const diagnostics = createRoadAcquisitionDiagnostics(rawData);
    const chunk = parseChunkId(chunkId);
    const baseBounds = chunkBounds(chunk, chunkSizeMeters);
    const padding = ROAD_CONFIG.chunkRetentionPaddingMeters;
    const clipBounds = {
      minX: baseBounds.minX - padding,
      minY: baseBounds.minY - padding,
      maxX: baseBounds.maxX + padding,
      maxY: baseBounds.maxY + padding
    };
    const rawSegments = parseOverpassSegments(rawData, worldCenter, {
      clipCenter: null,
      clipBounds,
      maxDistanceMeters: Infinity,
      minimumRawSegments: 0,
      diagnostics
    });
    if (rawSegments.length === 0) {
      const graph = attachGraphIndexes({
        nodes: [], edges: [], center: worldCenter, source: 'osm-chunk', roadSpecVersion: 3, chunkId
      });
      const report = acquisitionReport({
        mode: 'chunk', diagnostics, graph, queryRadiusMeters: radiusMeters,
        retention: { type: 'bounds', ...clipBounds }
      });
      this.lastAcquisitionReport = report;
      return attachReport(graph, report);
    }
    const graph = finalizeRoadGraph(buildRoadGraphFromSegments(rawSegments, worldCenter), {
      minimumNodes: 0,
      minimumEdges: 0
    });
    graph.source = 'osm-chunk';
    graph.roadSpecVersion = 3;
    graph.chunkId = chunkId;
    for (const node of graph.nodes) node.chunkIds = [chunkId];
    for (const edge of graph.edges) edge.chunkIds = [chunkId];
    const report = acquisitionReport({
      mode: 'chunk', diagnostics, graph, queryRadiusMeters: radiusMeters,
      retention: { type: 'bounds', ...clipBounds }
    });
    this.lastAcquisitionReport = report;
    return attachReport(graph, report);
  }
}
