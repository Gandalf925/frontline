import { distance, stableId } from '../core/utilities.js';
import { graphElementsNearPoint } from '../roads/road-graph.js';
import { activePlayerBases, playerBasesView } from './player-bases.js';
import { consumeBundle, missingBundle } from '../civilization/inventory-system.js';
import {
  FIELD_BASE_ENEMY_EXCLUSION_METERS,
  fieldBaseMaxHpForCivilization,
  FIELD_BASE_MINIMUM_SEPARATION_METERS,
  FIELD_BASE_BUILD_RANGE_METERS,
  FIELD_BASE_PLACEMENT_RANGE_METERS,
  activeFieldBases,
  fieldBaseById,
  fieldBaseLimitForCivilization,
  fieldBaseSlotsUsed,
  fieldBasePlacementCost,
  FIELD_BASE_REBUILD_COST,
  nearestOwnedBase
} from './field-bases.js';
import {
  PLAYER_BASE_LOCATION_MAX_AGE_MS,
  PLAYER_BASE_MAX_ACCURACY_METERS
} from './player-base-system.js';

function validateLocation(state, now) {
  const player = state.player?.worldPosition;
  if (!player) return { ok: false, reason: '現在地を取得してください。' };
  const updatedAt = Number(state.player?.locationUpdatedAt) || 0;
  if (!updatedAt || now - updatedAt > PLAYER_BASE_LOCATION_MAX_AGE_MS) {
    return { ok: false, reason: '位置情報が古いため簡易拠点を設置できません。現在地を再取得してください。' };
  }
  const accuracy = Number(state.player?.locationAccuracy);
  if (Number.isFinite(accuracy) && accuracy > PLAYER_BASE_MAX_ACCURACY_METERS) {
    return { ok: false, reason: '位置情報の精度が不足しています。' };
  }
  return { ok: true, player };
}

function nearestRoadNode(state, point) {
  const graph = state.world.roadGraph;
  if (!graph?.nodeById || !point) return null;
  let nearest = null;
  for (const node of graphElementsNearPoint(graph, point, FIELD_BASE_PLACEMENT_RANGE_METERS).nodes) {
    const gap = distance(point, node);
    if (gap > FIELD_BASE_PLACEMENT_RANGE_METERS) continue;
    if (!nearest || gap < nearest.distance) nearest = { node, distance: gap };
  }
  return nearest;
}

function nearestAliveEnemyBase(state, point) {
  return (state.world.enemyBases ?? [])
    .filter(base => base.alive && base.hp > 0)
    .map(base => {
      const node = state.world.roadGraph?.nodeById?.get(base.nodeId) ?? base;
      return { base, gap: distance(point, node) };
    })
    .sort((a, b) => a.gap - b.gap)[0] ?? null;
}

export function previewFieldBasePlacement(state, now = Date.now()) {
  const limit = fieldBaseLimitForCivilization(state.civilization?.level);
  const used = fieldBaseSlotsUsed(state);
  const cost = fieldBasePlacementCost(state);
  if (limit <= 0) return { ok: false, reason: '文明Lv.1で簡易拠点が解禁されます。', current: used, limit, cost };
  if (Number.isFinite(limit) && used >= limit) return { ok: false, reason: `現在の文明レベルでは簡易拠点を${limit}個まで設置できます。`, current: used, limit, cost };

  const location = validateLocation(state, now);
  if (!location.ok) return { ...location, current: used, limit, cost };
  const road = nearestRoadNode(state, location.player);
  if (!road) {
    return { ok: false, reason: `取得済み道路の交差点から${FIELD_BASE_PLACEMENT_RANGE_METERS}m以内へ移動してください。`, current: used, limit, cost };
  }

  const nearest = nearestOwnedBase(state, road.node, { includeDestroyed: true });
  if (nearest && nearest.gap < FIELD_BASE_MINIMUM_SEPARATION_METERS) {
    return { ok: false, reason: `既存拠点から${FIELD_BASE_MINIMUM_SEPARATION_METERS}m以上離れてください。`, current: used, limit, nearest, cost };
  }

  const hostile = nearestAliveEnemyBase(state, road.node);
  if (hostile && hostile.gap < FIELD_BASE_ENEMY_EXCLUSION_METERS) {
    return { ok: false, reason: `敵拠点から${FIELD_BASE_ENEMY_EXCLUSION_METERS}m以上離れてください。`, current: used, limit, hostile, cost };
  }

  const missing = missingBundle(state, cost);
  if (Object.keys(missing).length > 0) {
    return { ok: false, reason: '簡易拠点の設置資源が不足しています。', missing, cost, current: used, limit, node: road.node };
  }
  return {
    ok: true,
    current: used,
    limit,
    cost,
    node: road.node,
    distanceToRoad: road.distance,
    nearestBaseDistance: nearest?.gap ?? null,
    nearestEnemyBaseDistance: hostile?.gap ?? null
  };
}


function candidateAllowed(state, node, occupied) {
  if (!Number.isFinite(Number(node?.x)) || !Number.isFinite(Number(node?.y))) return false;
  if (occupied.some(point => distance(point, node) < FIELD_BASE_MINIMUM_SEPARATION_METERS)) return false;
  const hostile = nearestAliveEnemyBase(state, node);
  return !hostile || hostile.gap >= FIELD_BASE_ENEMY_EXCLUSION_METERS;
}

function greedyFieldBaseCandidates(state, candidates, occupied, limit, order) {
  const selected = [];
  for (const node of [...candidates].sort(order)) {
    if (selected.length >= limit) break;
    if (!candidateAllowed(state, node, [...occupied, ...selected])) continue;
    selected.push(node);
  }
  return selected;
}

/**
 * Estimates whether the currently acquired road graph contains enough mutually
 * separated sites for the civilization's simple-base requirement. It deliberately
 * ignores resources and the player's current GPS position; this is a geographic
 * planning diagnostic, not a placement authorization.
 */
export function diagnoseFieldBaseNetwork(state, required = fieldBaseLimitForCivilization(state.civilization?.level)) {
  const fieldBases = state.world?.fieldBases ?? [];
  const active = activeFieldBases(state).length;
  const destroyed = Math.max(0, fieldBases.length - active);
  const limit = fieldBaseLimitForCivilization(state.civilization?.level);
  const requested = Math.max(0, Math.floor(Number(required) || 0));
  const target = Number.isFinite(limit) ? Math.min(limit, requested) : requested;
  const availableSlots = Number.isFinite(limit) ? Math.max(0, limit - fieldBases.length) : Math.max(target - fieldBases.length, 12);
  const occupied = [...playerBasesView(state), ...fieldBases]
    .filter(point => Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y)));
  const graph = state.world.roadGraph;
  const candidates = (graph?.nodes ?? []).filter(node => candidateAllowed(state, node, occupied));
  const center = graph?.center && Number.isFinite(Number(graph.center.x)) ? graph.center : occupied[0] ?? { x: 0, y: 0 };
  const orders = [
    (a, b) => a.x - b.x || a.y - b.y || String(a.id).localeCompare(String(b.id)),
    (a, b) => b.x - a.x || b.y - a.y || String(a.id).localeCompare(String(b.id)),
    (a, b) => a.y - b.y || a.x - b.x || String(a.id).localeCompare(String(b.id)),
    (a, b) => b.y - a.y || b.x - a.x || String(a.id).localeCompare(String(b.id)),
    (a, b) => distance(b, center) - distance(a, center) || String(a.id).localeCompare(String(b.id)),
    (a, b) => distance(a, center) - distance(b, center) || String(a.id).localeCompare(String(b.id))
  ];
  let selected = [];
  for (const order of orders) {
    const attempt = greedyFieldBaseCandidates(state, candidates, occupied, availableSlots, order);
    if (attempt.length > selected.length) selected = attempt;
    if (selected.length >= availableSlots) break;
  }
  const confirmedAdditional = Math.min(availableSlots, selected.length);
  const projectedTotal = active + destroyed + confirmedAdditional;
  const sufficient = projectedTotal >= target;
  let guidance;
  if (target <= active) guidance = '必要数の簡易拠点はすでに稼働しています。';
  else if (destroyed > 0 && active + destroyed >= target) guidance = `破壊済み簡易拠点を${target - active}基再建すると条件を満たせます。`;
  else if (sufficient) guidance = `現在の取得道路上に、あと${Math.max(0, target - active - destroyed)}基分の設置候補を確認しました。`;
  else if (availableSlots <= 0) guidance = '設置枠は埋まっています。破壊済み簡易拠点を現地で再建してください。';
  else guidance = `現在の取得道路では必要数に届きません。道路をさらに取得するか、敵拠点周辺を制圧してください。`;
  return {
    required: target,
    limit,
    active,
    destroyed,
    slotsUsed: fieldBases.length,
    availableSlots,
    eligibleNodeCount: candidates.length,
    confirmedAdditional,
    projectedTotal,
    sufficient,
    candidateNodeIds: selected.map(node => node.id),
    guidance
  };
}

export function previewFieldBaseRebuild(state, baseId, now = Date.now()) {
  const cost = { ...FIELD_BASE_REBUILD_COST };
  const base = fieldBaseById(state, baseId, { includeDestroyed: true });
  if (!base) return { ok: false, reason: '簡易拠点が見つかりません。', cost };
  if (base.status !== 'DESTROYED' && base.hp > 0) return { ok: false, reason: 'この簡易拠点は稼働中です。', cost };
  const location = validateLocation(state, now);
  if (!location.ok) return { ...location, cost };
  const gap = distance(location.player, base);
  if (gap > FIELD_BASE_BUILD_RANGE_METERS) {
    return { ok: false, reason: `破壊された簡易拠点から${FIELD_BASE_BUILD_RANGE_METERS}m以内へ移動してください。`, distance: gap, base, cost };
  }
  const node = state.world.roadGraph?.nodeById?.get(base.nodeId);
  if (!node) return { ok: false, reason: '簡易拠点が接続していた道路を利用できません。', base, cost };
  const missing = missingBundle(state, cost);
  if (Object.keys(missing).length > 0) return { ok: false, reason: '簡易拠点の再建資源が不足しています。', missing, base, node, distance: gap, cost };
  return { ok: true, base, node, distance: gap, cost };
}

export function destroyFieldBase(state, base, events = null, { enemyId = null } = {}) {
  if (!base || base.status === 'DESTROYED') return false;
  base.hp = 0;
  base.status = 'DESTROYED';
  base.destroyedAt = state.runtime?.worldTimeMs ?? Date.now();
  for (const enemy of state.combat.enemies ?? []) {
    if (enemy.targetFieldBaseId === base.id) {
      enemy.targetFieldBaseId = null;
      enemy.reroutePending = true;
    }
  }
  events?.emit('base:field-destroyed', { baseId: base.id, enemyId, position: { x: base.x, y: base.y } });
  events?.emit('message', { text: `${base.name}が破壊されました。現地で再建できます。` });
  return true;
}

export class FieldBaseSystem {
  constructor(events = null) {
    this.events = events;
  }

  previewCurrentLocation(state, now = Date.now()) {
    return previewFieldBasePlacement(state, now);
  }

  establishAtCurrentLocation(state, now = Date.now()) {
    const preview = this.previewCurrentLocation(state, now);
    if (!preview.ok) return preview;
    if (!consumeBundle(state, preview.cost)) return { ok: false, reason: '簡易拠点の設置直前に資源が不足しました。', missing: missingBundle(state, preview.cost), cost: preview.cost };
    const establishedAt = state.runtime?.worldTimeMs ?? now;
    const sequence = (state.world?.fieldBases?.length ?? 0) + 1;
    const base = {
      id: stableId('field_base', preview.node.id, establishedAt, sequence),
      kind: 'FIELD',
      name: `簡易拠点 ${sequence}`,
      status: 'ESTABLISHED',
      nodeId: preview.node.id,
      x: preview.node.x,
      y: preview.node.y,
      hp: fieldBaseMaxHpForCivilization(state.civilization?.level),
      maxHp: fieldBaseMaxHpForCivilization(state.civilization?.level),
      establishedAt,
      destroyedAt: null
    };
    state.world.fieldBases.push(base);
    this.events?.emit('base:field-established', { base });
    this.events?.emit('message', { text: `${base.name}を設置しました。` });
    return { ok: true, base, cost: preview.cost, current: activeFieldBases(state).length, limit: fieldBaseLimitForCivilization(state.civilization?.level) };
  }

  previewRebuild(state, baseId, now = Date.now()) {
    return previewFieldBaseRebuild(state, baseId, now);
  }

  rebuild(state, baseId, now = Date.now()) {
    const preview = this.previewRebuild(state, baseId, now);
    if (!preview.ok) return preview;
    if (!consumeBundle(state, preview.cost)) return { ok: false, reason: '簡易拠点の再建直前に資源が不足しました。', missing: missingBundle(state, preview.cost), cost: preview.cost };
    const base = preview.base;
    base.status = 'ESTABLISHED';
    base.hp = base.maxHp = fieldBaseMaxHpForCivilization(state.civilization?.level);
    base.destroyedAt = null;
    base.rebuiltAt = state.runtime?.worldTimeMs ?? now;
    this.events?.emit('base:field-rebuilt', { base });
    this.events?.emit('message', { text: `${base.name}を再建しました。` });
    return { ok: true, base, cost: preview.cost };
  }
}
