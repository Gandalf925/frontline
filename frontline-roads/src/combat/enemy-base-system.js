import { stableId } from '../core/utilities.js';
import { ENEMY_BASE_DEFINITIONS } from './definitions.js';
import { createBaseRecoveryItem } from '../exploration/recovery-system.js';

export const BASE_RESPAWN_MIN_SECONDS = 4 * 60 * 60;
export const BASE_RESPAWN_MAX_SECONDS = 6 * 60 * 60;
export const RESOURCE_BASE_RESPAWN_MIN_SECONDS = 45 * 60;
export const RESOURCE_BASE_RESPAWN_MAX_SECONDS = 75 * 60;

function deterministicRespawnSeconds(baseId, resourceBase = false) {
  let hash = 2166136261;
  for (const character of String(baseId)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const minimum = resourceBase ? RESOURCE_BASE_RESPAWN_MIN_SECONDS : BASE_RESPAWN_MIN_SECONDS;
  const maximum = resourceBase ? RESOURCE_BASE_RESPAWN_MAX_SECONDS : BASE_RESPAWN_MAX_SECONDS;
  const span = maximum - minimum;
  return minimum + ((hash >>> 0) % (span + 1));
}

export function scheduleEnemyBaseRespawn(state, base) {
  state.world.baseRespawns ??= [];
  if (state.world.baseRespawns.some(item => item.sourceBaseId === base.id)) return null;
  const respawn = {
    id: stableId('respawn', base.id, state.statistics.campsCaptured),
    sourceBaseId: base.id,
    baseType: base.type,
    sourceNodeId: base.nodeId,
    remainingSec: deterministicRespawnSeconds(base.id, Boolean(ENEMY_BASE_DEFINITIONS[base.type]?.isResourceBase)),
    attempts: 0
  };
  state.world.baseRespawns.push(respawn);
  return respawn;
}

export function destroyEnemyBase(state, base, events = null, cause = {}) {
  if (!base?.alive || base.hp > 0) return false;
  base.hp = 0;
  base.alive = false;
  base.destroyed = true;
  base.destroyedAt = state.runtime?.worldTimeMs ?? Date.now();
  state.statistics.campsCaptured = (state.statistics.campsCaptured ?? 0) + 1;
  state.civilization.progress.campsCapturedByType[base.type] = (state.civilization.progress.campsCapturedByType[base.type] ?? 0) + 1;
  scheduleEnemyBaseRespawn(state, base);
  const definition = ENEMY_BASE_DEFINITIONS[base.type];
  const reward = { ...(definition?.reward ?? {}) };
  const recoveryItem = createBaseRecoveryItem(state, base, reward);
  for (const enemy of state.combat.enemies) {
    if (enemy.sourceBaseId === base.id) enemy.sourceBaseDestroyed = true;
  }
  base.rewardAssigned = true;
  events?.emit('combat:enemy-base-destroyed', { baseId: base.id, base, cause, recoveryItem, reward });
  events?.emit('message', { text: `${definition?.name ?? '敵拠点'}を破壊しました。特殊回収物と資源備蓄が現地に残されています。` });
  return true;
}
