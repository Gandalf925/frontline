import { LifecycleState, SCHEMA_VERSION } from './constants.js';
import { emptyResourceBundle } from '../civilization/data.js';
import { createProgressState } from '../civilization/progression-system.js';

export function createInitialState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    lifecycle: LifecycleState.BOOT,
    world: {
      roadGraph: null,
      homeBase: null,
      playerBases: [],
      fieldBases: [],
      city: null,
      enemyBases: [],
      baseRespawns: [],
      roadChunks: null,
      frontierSources: [],
      explorationSites: [],
      exploredSiteChunks: [],
      recoveryItems: [],
      recoveryCollection: null
    },
    player: {
      currentPosition: null,
      locationAccuracy: null,
      locationUpdatedAt: null,
      worldPosition: null
    },
    combat: {
      enemies: [],
      friendlySquads: [],
      defenses: [],
      waves: { elapsed: 0, nextSpawnAt: null, active: {}, resourceBaseCheckClock: 30 },
      pendingSettlementDamage: [],
      cityRecoveryCooldown: 0,
      enemyRegroupUntil: 0
    },
    civilization: {
      level: 0,
      completedAt: null,
      gracePeriodUntil: null,
      project: null,
      buildings: [],
      productionQueues: [],
      progress: createProgressState(),
      artifacts: {},
      totalArtifactsRecovered: 0
    },
    inventory: {
      resources: emptyResourceBundle(),
      overflow: {},
      capacity: {},
      lastOverflowSweepAt: 0
    },
    statistics: {
      kills: 0,
      campsCaptured: 0
    },
    runtime: {
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastSavedAt: 0,
      worldTimeMs: Date.now(),
      lastError: null,
      combatInitialized: false,
      performance: { frames: 0, slowFrames: 0, lastFrameMs: 0 },
      regionalSimulation: { peripheralAccumulator: 0, dormantAccumulator: 0 }
    }
  };
}

const finite = value => Number.isFinite(Number(value));
const object = value => value && typeof value === 'object' && !Array.isArray(value);

function validateRoadGraph(graph, errors) {
  if (!object(graph)) { errors.push('roadGraph must be an object'); return; }
  if (!Array.isArray(graph.nodes) || graph.nodes.length < 2) errors.push('roadGraph.nodes must contain nodes');
  if (!Array.isArray(graph.edges) || graph.edges.length < 1) errors.push('roadGraph.edges must contain edges');
  if (!object(graph.center) || !finite(graph.center.lat) || !finite(graph.center.lon)) errors.push('roadGraph.center is invalid');
  const nodeIds = new Set();
  for (const node of graph.nodes ?? []) {
    if (!node?.id || !finite(node.x) || !finite(node.y)) { errors.push('roadGraph contains an invalid node'); break; }
    nodeIds.add(node.id);
  }
  for (const edge of graph.edges ?? []) {
    if (!edge?.id || !nodeIds.has(edge.a) || !nodeIds.has(edge.b) || !finite(edge.length) || Number(edge.length) <= 0) {
      errors.push('roadGraph contains an invalid edge');
      break;
    }
  }
}

export function validateState(state) {
  const errors = [];
  if (!object(state)) errors.push('state must be an object');
  if (state?.schemaVersion !== SCHEMA_VERSION) errors.push('unsupported schemaVersion');
  if (!Object.values(LifecycleState).includes(state?.lifecycle)) errors.push('invalid lifecycle');
  if (!object(state?.world)) errors.push('world is required');
  if (!object(state?.player)) errors.push('player is required');
  if (!object(state?.combat)) errors.push('combat is required');
  if (!object(state?.civilization)) errors.push('civilization is required');
  if (!object(state?.inventory?.resources)) errors.push('inventory is required');
  if (!object(state?.runtime)) errors.push('runtime is required');
  if (!Array.isArray(state?.world?.enemyBases) || !Array.isArray(state?.world?.baseRespawns) || (state?.world?.playerBases !== undefined && !Array.isArray(state.world.playerBases)) || (state?.world?.fieldBases !== undefined && !Array.isArray(state.world.fieldBases))) errors.push('world collections are invalid');
  if (!Array.isArray(state?.combat?.enemies) || (state?.combat?.friendlySquads !== undefined && !Array.isArray(state.combat.friendlySquads)) || !Array.isArray(state?.combat?.defenses) || !object(state?.combat?.waves)) errors.push('combat collections are invalid');
  if (!Array.isArray(state?.civilization?.buildings) || !Array.isArray(state?.civilization?.productionQueues)) errors.push('civilization collections are invalid');
  if (state?.world?.roadGraph) validateRoadGraph(state.world.roadGraph, errors);
  const graphNodeIds = new Set(state?.world?.roadGraph?.nodes?.map(node => node.id) ?? []);
  if (state?.world?.homeBase) {
    const home = state.world.homeBase;
    if (home.status !== 'ESTABLISHED' || !home.nodeId || !finite(home.x) || !finite(home.y)) errors.push('homeBase is invalid');
    if (!state.world.roadGraph) errors.push('homeBase requires roadGraph');
    else if (!graphNodeIds.has(home.nodeId)) errors.push('homeBase node is missing from roadGraph');
  }
  for (const base of state?.world?.playerBases ?? []) {
    if (!base?.id || !['ESTABLISHED', 'DESTROYED'].includes(base.status) || !base.nodeId || !finite(base.x) || !finite(base.y) || !finite(base.hp) || !finite(base.maxHp)) {
      errors.push('playerBases contains an invalid base');
      break;
    }
    if (state.world.roadGraph && !graphNodeIds.has(base.nodeId)) {
      errors.push('player base node is missing from roadGraph');
      break;
    }
  }

  for (const base of state?.world?.fieldBases ?? []) {
    if (!base?.id || !['ESTABLISHED', 'DESTROYED'].includes(base.status) || !base.nodeId || !finite(base.x) || !finite(base.y) || !finite(base.hp) || !finite(base.maxHp)) {
      errors.push('fieldBases contains an invalid base');
      break;
    }
    if (state.world.roadGraph && !graphNodeIds.has(base.nodeId)) {
      errors.push('field base node is missing from roadGraph');
      break;
    }
  }
  if (state?.world?.city) {
    const city = state.world.city;
    if (!city.nodeId || !finite(city.hp) || !finite(city.maxHp)) errors.push('city is invalid');
    else if (!graphNodeIds.has(city.nodeId)) errors.push('city node is missing from roadGraph');
  }
  return { valid: errors.length === 0, errors };
}
