import { distance } from '../core/utilities.js';
import { defenseRuntimeDefinition } from './definitions.js';
import { roadUnitPosition } from './road-unit-position.js';

export function medicalCoverageForSquad(state, squad) {
  if (!squad || squad.hp <= 0) return null;
  const squadPosition = roadUnitPosition(state, squad);
  if (!squadPosition) return null;
  let best = null;
  for (const facility of state.combat?.defenses ?? []) {
    if (facility.type !== 'medical' || facility.hp <= 0 || (facility.disabledTimer ?? 0) > 0) continue;
    const facilityPosition = state.world?.roadGraph?.nodeById?.get(facility.nodeId);
    if (!facilityPosition) continue;
    const definition = defenseRuntimeDefinition(facility);
    const range = Math.max(0, Number(definition.range) || 0);
    const gap = distance(facilityPosition, squadPosition);
    if (gap > range) continue;
    if (!best || Number(definition.recoveryRate) > Number(best.definition.recoveryRate)) {
      best = { facility, definition, distance: gap, range };
    }
  }
  return best;
}

export function applyMedicalAreaHealing(state, facility, operationalSeconds) {
  if (!facility || facility.type !== 'medical' || facility.hp <= 0 || (facility.disabledTimer ?? 0) > 0 || operationalSeconds <= 0) return { healedSquads: 0, totalHealing: 0 };
  const definition = defenseRuntimeDefinition(facility);
  const facilityPosition = state.world?.roadGraph?.nodeById?.get(facility.nodeId);
  const range = Math.max(0, Number(definition.range) || 0);
  const recoveryRate = Math.max(0, Number(definition.recoveryRate) || 0);
  if (!facilityPosition || range <= 0 || recoveryRate <= 0) return { healedSquads: 0, totalHealing: 0 };

  let healedSquads = 0;
  let totalHealing = 0;
  for (const squad of state.combat?.friendlySquads ?? []) {
    if (squad.hp <= 0 || squad.hp >= squad.maxHp) continue;
    const squadPosition = roadUnitPosition(state, squad);
    if (!squadPosition || distance(facilityPosition, squadPosition) > range) continue;
    const healing = Math.min(squad.maxHp - squad.hp, squad.maxHp * recoveryRate * operationalSeconds);
    if (healing <= 0) continue;
    squad.hp += healing;
    healedSquads += 1;
    totalHealing += healing;
  }
  return { healedSquads, totalHealing };
}
