import { distance, stableId } from '../core/utilities.js';
import { graphElementsNearPoint } from '../roads/road-graph.js';
import { consumeBundle, missingBundle } from '../civilization/inventory-system.js';
import {
  PLAYER_BASE_MINIMUM_SEPARATION_METERS,
  PLAYER_BASE_PLACEMENT_RANGE_METERS,
  activePlayerBases,
  playerBaseById,
  playerBaseSlotsUsed,
  PLAYER_BASE_REBUILD_COST,
  baseLimitForCivilization,
  canPlaceAdditionalBase,
  playerBasePlacementCost,
  majorBaseMaxHpForCivilization
} from './player-bases.js';

export const PLAYER_BASE_LOCATION_MAX_AGE_MS = 5 * 60_000;
export const PLAYER_BASE_MAX_ACCURACY_METERS = 100;

function nearestRoadNode(state, point) {
  const graph = state.world.roadGraph;
  if (!graph?.nodeById || !point) return null;
  let nearest = null;
  for (const node of graphElementsNearPoint(graph, point, PLAYER_BASE_PLACEMENT_RANGE_METERS).nodes) {
    const gap = distance(point, node);
    if (gap > PLAYER_BASE_PLACEMENT_RANGE_METERS) continue;
    if (!nearest || gap < nearest.distance) nearest = { node, distance: gap };
  }
  return nearest;
}

export function previewPlayerBasePlacement(state, now = Date.now()) {
  const bases = state.world?.playerBases ?? [];
  const limit = baseLimitForCivilization(state.civilization?.level);
  const cost = playerBasePlacementCost(state);
  if (bases.length >= limit) {
    return { ok: false, reason: `現在の文明レベルでは拠点を${limit}個まで設置できます。`, current: bases.length, limit, cost };
  }
  const player = state.player?.worldPosition;
  if (!player) return { ok: false, reason: '現在地を取得してください。', current: bases.length, limit, cost };
  const updatedAt = Number(state.player?.locationUpdatedAt) || 0;
  if (!updatedAt || now - updatedAt > PLAYER_BASE_LOCATION_MAX_AGE_MS) {
    return { ok: false, reason: '位置情報が古いため拠点を設置できません。現在地を再取得してください。', current: bases.length, limit, cost };
  }
  const accuracy = Number(state.player?.locationAccuracy);
  if (Number.isFinite(accuracy) && accuracy > PLAYER_BASE_MAX_ACCURACY_METERS) {
    return { ok: false, reason: '位置情報の精度が不足しています。', current: bases.length, limit, cost };
  }
  const road = nearestRoadNode(state, player);
  if (!road) {
    return { ok: false, reason: `取得済み道路の交差点から${PLAYER_BASE_PLACEMENT_RANGE_METERS}m以内へ移動してください。`, current: bases.length, limit, cost };
  }
  const separation = canPlaceAdditionalBase(state, road.node);
  if (!separation.ok) return { ...separation, current: bases.length, limit, cost };
  const nearestFieldBase = (state.world.fieldBases ?? [])
    .map(base => ({ base, gap: distance(base, road.node) }))
    .sort((left, right) => left.gap - right.gap)[0] ?? null;
  if (nearestFieldBase && nearestFieldBase.gap < PLAYER_BASE_MINIMUM_SEPARATION_METERS) {
    return { ok: false, reason: `簡易拠点から${PLAYER_BASE_MINIMUM_SEPARATION_METERS}m以上離れてください。`, nearest: nearestFieldBase, current: bases.length, limit, cost };
  }
  const missing = missingBundle(state, cost);
  if (Object.keys(missing).length > 0) {
    return { ok: false, reason: '主要拠点の設置資源が不足しています。', missing, cost, current: bases.length, limit, node: road.node };
  }
  return {
    ok: true,
    current: bases.length,
    limit,
    cost,
    node: road.node,
    distanceToRoad: road.distance,
    nearestBaseDistance: separation.nearest?.gap ?? null
  };
}


export function previewPlayerBaseRebuild(state, baseId, now = Date.now()) {
  const cost = { ...PLAYER_BASE_REBUILD_COST };
  const base = playerBaseById(state, baseId, { includeDestroyed: true });
  if (!base || base.primary) return { ok: false, reason: '再建対象の主要拠点が見つかりません。', cost };
  if (base.status !== 'DESTROYED' && base.hp > 0) return { ok: false, reason: 'この主要拠点は稼働中です。', cost };
  const player = state.player?.worldPosition;
  if (!player) return { ok: false, reason: '現在地を取得してください。', cost };
  const updatedAt = Number(state.player?.locationUpdatedAt) || 0;
  if (!updatedAt || now - updatedAt > PLAYER_BASE_LOCATION_MAX_AGE_MS) return { ok: false, reason: '位置情報が古いため再建できません。', cost };
  const gap = distance(player, base);
  if (gap > PLAYER_BASE_PLACEMENT_RANGE_METERS) return { ok: false, reason: `破壊された主要拠点から${PLAYER_BASE_PLACEMENT_RANGE_METERS}m以内へ移動してください。`, cost, base, distance: gap };
  const missing = missingBundle(state, cost);
  if (Object.keys(missing).length) return { ok: false, reason: '主要拠点の再建資源が不足しています。', cost, missing, base };
  return { ok: true, cost, base, distance: gap };
}

export function destroyPlayerBase(state, base, events = null, { enemyId = null } = {}) {
  if (!base || base.primary || base.status === 'DESTROYED') return false;
  base.hp = 0;
  base.status = 'DESTROYED';
  base.destroyedAt = state.runtime?.worldTimeMs ?? Date.now();
  for (const enemy of state.combat.enemies ?? []) {
    if (enemy.targetPlayerBaseId === base.id) {
      enemy.targetPlayerBaseId = null;
      enemy.reroutePending = true;
    }
  }
  events?.emit('base:player-destroyed', { baseId: base.id, enemyId, position: { x: base.x, y: base.y } });
  events?.emit('message', { text: `${base.name}が破壊されました。現地で再建できます。` });
  return true;
}

export class PlayerBaseSystem {
  constructor(events = null) {
    this.events = events;
  }

  previewCurrentLocation(state, now = Date.now()) {
    return previewPlayerBasePlacement(state, now);
  }

  establishAtCurrentLocation(state, now = Date.now()) {
    const preview = this.previewCurrentLocation(state, now);
    if (!preview.ok) return preview;
    if (!consumeBundle(state, preview.cost)) return { ok: false, reason: '主要拠点の設置直前に資源が不足しました。', missing: missingBundle(state, preview.cost), cost: preview.cost };
    const establishedAt = state.runtime?.worldTimeMs ?? now;
    const sequence = playerBaseSlotsUsed(state) + 1;
    const base = {
      id: stableId('player_base', preview.node.id, establishedAt, sequence),
      name: `主要拠点 ${sequence}`,
      status: 'ESTABLISHED',
      primary: false,
      nodeId: preview.node.id,
      x: preview.node.x,
      y: preview.node.y,
      hp: majorBaseMaxHpForCivilization(state.civilization?.level),
      maxHp: majorBaseMaxHpForCivilization(state.civilization?.level),
      establishedAt
    };
    state.world.playerBases.push(base);
    this.events?.emit('base:player-established', { base });
    this.events?.emit('message', { text: `${base.name}を設置しました。` });
    return { ok: true, base, cost: preview.cost, current: activePlayerBases(state).length, limit: baseLimitForCivilization(state.civilization?.level) };
  }

  previewRebuild(state, baseId, now = Date.now()) {
    return previewPlayerBaseRebuild(state, baseId, now);
  }

  rebuild(state, baseId, now = Date.now()) {
    const preview = this.previewRebuild(state, baseId, now);
    if (!preview.ok) return preview;
    if (!consumeBundle(state, preview.cost)) return { ok: false, reason: '主要拠点の再建直前に資源が不足しました。', cost: preview.cost };
    const base = preview.base;
    base.status = 'ESTABLISHED';
    base.hp = base.maxHp = majorBaseMaxHpForCivilization(state.civilization?.level);
    base.destroyedAt = null;
    base.rebuiltAt = state.runtime?.worldTimeMs ?? now;
    this.events?.emit('base:player-rebuilt', { base });
    this.events?.emit('message', { text: `${base.name}を再建しました。` });
    return { ok: true, base, cost: preview.cost };
  }

}
