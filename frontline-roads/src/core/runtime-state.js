import { deepClone } from './utilities.js';
import { attachGraphIndexes } from '../roads/road-graph.js';

export function restoreRuntimeIndexes(state) {
  const graph = state?.world?.roadGraph;
  if (graph?.nodes && graph?.edges) attachGraphIndexes(graph);
  return state;
}

export function cloneRuntimeState(state) {
  return restoreRuntimeIndexes(deepClone(state));
}
