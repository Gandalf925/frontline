import { attachGraphIndexes } from '../roads/road-graph.js';
import { ensureRoadChunkState } from '../roads/world-chunk-grid.js';
import { normalizeCombatState } from '../combat/combat-initializer.js';

export function normalizeRuntimeState(state) {
  if (state.world?.roadGraph) attachGraphIndexes(state.world.roadGraph);
  ensureRoadChunkState(state.world);
  normalizeCombatState(state);
  return state;
}
