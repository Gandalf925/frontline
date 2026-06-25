import { ROAD_CONFIG } from '../core/constants.js';
import { formatMeters, stableId } from '../core/utilities.js';
import { haversineMeters, xyToLatLon } from '../location/location-privacy.js';
import { pointToSegmentProjection } from '../roads/geometry.js';
import { insertBaseNodeOnEdge } from './base-graph.js';

export class BasePlacementService {
  constructor(graph, originLocation) {
    this.graph = graph;
    this.originLocation = originLocation;
  }

  findNearestRoad(worldPoint, maxDistanceMeters = Infinity) {
    let best = null;
    for (const edge of this.graph.edges) {
      const a = this.graph.nodeById.get(edge.a);
      const b = this.graph.nodeById.get(edge.b);
      if (!a || !b) continue;
      const projection = pointToSegmentProjection(worldPoint, a, b);
      if (projection.distance > maxDistanceMeters) continue;
      if (!best || projection.distance < best.distanceToRoad) {
        const location = xyToLatLon(projection.point.x, projection.point.y, this.graph.center);
        const distanceFromOrigin = haversineMeters(this.originLocation, location);
        best = {
          edgeId: edge.id,
          point: projection.point,
          location,
          t: projection.t,
          distanceToRoad: projection.distance,
          distanceFromOrigin,
          valid: distanceFromOrigin <= ROAD_CONFIG.selectionRadiusMeters,
          label: `${formatMeters(distanceFromOrigin)}先の道路`
        };
      }
    }
    return best;
  }

  establishHomeBase(selection) {
    if (!selection?.valid) throw new Error('有効な道路を選択してください。');
    const insertion = insertBaseNodeOnEdge(this.graph, selection);
    return {
      graph: insertion.graph,
      homeBase: {
      id: stableId('home', selection.edgeId, selection.t.toFixed(6)),
      status: 'ESTABLISHED',
      edgeId: selection.edgeId,
      nodeId: insertion.nodeId,
      x: selection.point.x,
      y: selection.point.y,
      selectedDistanceMeters: selection.distanceFromOrigin,
      establishedAt: Date.now()
      }
    };
  }

  createHomeBase(selection) {
    return this.establishHomeBase(selection).homeBase;
  }
}
