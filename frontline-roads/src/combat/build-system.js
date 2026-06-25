import { distance, stableId } from '../core/utilities.js';
import { ROAD_CONFIG } from '../core/constants.js';
import { pointToSegmentProjection } from '../roads/geometry.js';
import { graphElementsNearPoint } from '../roads/road-graph.js';
import { bundleText, consumeBundle, missingBundle } from '../civilization/inventory-system.js';
import { BUILD_RANGE_METERS, DEFENSE_DEFINITIONS, defenseRuntimeDefinition } from './definitions.js';
import {
  EXPEDITION_BUILD_RANGE_METERS,
  FIELD_BASE_BUILD_RANGE_METERS,
  PLAYER_BUILD_RANGE_METERS,
  fieldBaseBuildRange,
  majorBaseBuildRange
} from '../base/construction-range.js';
import { findCombatPath } from './routing-system.js';
import { detachDefense } from './defense-lifecycle.js';
import { activePlayerBases } from '../base/player-bases.js';
import { activeFieldBases } from '../base/field-bases.js';
import { roadUnitPosition } from './road-unit-position.js';

const CANDIDATE_POINT_TOLERANCE_METERS = 1;
const ANCHOR_DUPLICATE_TOLERANCE_METERS = 0.5;

function finitePoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function buildAnchors(state) {
  const civilizationLevel = Math.max(0, Math.floor(Number(state.civilization?.level) || 0));
  const majorRange = majorBaseBuildRange(civilizationLevel);
  const fieldRange = fieldBaseBuildRange(civilizationLevel);
  const anchors = activePlayerBases(state)
    .filter(finitePoint)
    .map((base, index) => ({
      id: index === 0 ? 'base' : `base:${base.id}`,
      label: base.name || (index === 0 ? '本拠地' : `主要拠点 ${index + 1}`),
      point: { x: base.x, y: base.y },
      range: majorRange,
      civilizationLevel,
      kind: 'MAJOR',
      baseId: base.id
    }));
  for (const base of activeFieldBases(state).filter(finitePoint)) {
    anchors.push({
      id: `field:${base.id}`,
      label: base.name || '簡易拠点',
      point: { x: base.x, y: base.y },
      range: fieldRange,
      civilizationLevel,
      kind: 'FIELD',
      baseId: base.id
    });
  }
  for (const squad of state.combat?.friendlySquads ?? []) {
    if (squad.type !== 'expedition' || squad.hp <= 0 || ['RECOVERING', 'READY'].includes(squad.status)) continue;
    const point = roadUnitPosition(state, squad);
    if (!finitePoint(point)) continue;
    anchors.push({
      id: `expedition:${squad.id}`,
      label: '遠征部隊',
      point: { x: point.x, y: point.y },
      range: EXPEDITION_BUILD_RANGE_METERS,
      civilizationLevel,
      kind: 'EXPEDITION',
      baseId: squad.originBaseId ?? null,
      squadId: squad.id
    });
  }
  if (finitePoint(state.player.worldPosition)) {
    const point = { x: state.player.worldPosition.x, y: state.player.worldPosition.y };
    const overlapsBase = anchors.some(anchor => distance(anchor.point, point) <= ANCHOR_DUPLICATE_TOLERANCE_METERS);
    if (!overlapsBase) anchors.push({
      id: 'player', label: '現在地', point, range: PLAYER_BUILD_RANGE_METERS,
      civilizationLevel,
      kind: 'PLAYER'
    });
  }
  return anchors;
}

function coveringAnchor(anchors, point) {
  let best = null;
  for (const anchor of anchors) {
    const gap = distance(anchor.point, point);
    const range = Math.max(0, Number(anchor.range) || BUILD_RANGE_METERS);
    if (gap > range) continue;
    if (!best || gap < best.distance) best = { ...anchor, distance: gap };
  }
  return best;
}


function nearbyEdges(graph, point, maxDistance) {
  const matches = [];
  for (const edge of graphElementsNearPoint(graph, point, maxDistance).edges) {
    const a = graph.nodeById.get(edge.a);
    const b = graph.nodeById.get(edge.b);
    if (!a || !b) continue;
    const projection = pointToSegmentProjection(point, a, b);
    if (projection.distance <= maxDistance) matches.push({ edge, projection, distance: projection.distance });
  }
  return matches.sort((left, right) => left.distance - right.distance);
}

function nearbyNodes(graph, point, maxDistance) {
  return graphElementsNearPoint(graph, point, maxDistance).nodes
    .map(node => ({ node, distance: distance(point, node) }))
    .filter(match => match.distance <= maxDistance)
    .sort((left, right) => left.distance - right.distance);
}

function towerCandidate(type, node, anchor = null) {
  return {
    type,
    kind: 'tower',
    nodeId: node.id,
    point: { x: node.x, y: node.y },
    anchorId: anchor?.id ?? null,
    anchorLabel: anchor?.label ?? null,
    anchorKind: anchor?.kind ?? null,
    baseId: anchor?.baseId ?? null
  };
}

function barrierCandidate(type, edge, point, anchor = null) {
  return {
    type,
    kind: 'barrier',
    edgeId: edge.id,
    point: { x: point.x, y: point.y },
    anchorId: anchor?.id ?? null,
    anchorLabel: anchor?.label ?? null,
    anchorKind: anchor?.kind ?? null,
    baseId: anchor?.baseId ?? null
  };
}

function resourceFailure(state, definition) {
  const missing = missingBundle(state, definition.cost);
  return Object.keys(missing).length
    ? { ok: false, reason: `資源が不足しています：${bundleText(missing)}`, missing }
    : null;
}

function civilizationFailure(state, definition) {
  const required = Math.max(0, Number(definition.requiredCivilizationLevel) || 0);
  return (state.civilization?.level ?? 0) < required
    ? { ok: false, reason: `文明Lv.${required}で解禁されます。`, requiredCivilizationLevel: required }
    : null;
}

function allowedAnchorsForDefinition(anchors, definition) {
  const allowed = Array.isArray(definition.allowedAnchorKinds) ? new Set(definition.allowedAnchorKinds) : null;
  return allowed ? anchors.filter(anchor => allowed.has(anchor.kind)) : anchors;
}

function anchorHasFacility(state, definition, anchor) {
  if (!definition.limitPerAnchor) return false;
  return state.combat.defenses.some(defense =>
    defense.type === definition.type && defense.buildAnchorId === anchor.id
  );
}

function buildRangeReason(state, definition) {
  const level = Math.max(0, Math.floor(Number(state.civilization?.level) || 0));
  const labels = {
    MAJOR: `主要拠点${majorBaseBuildRange(level)}m`,
    FIELD: `簡易拠点${fieldBaseBuildRange(level)}m`,
    PLAYER: `現在地${PLAYER_BUILD_RANGE_METERS}m`,
    EXPEDITION: `遠征部隊${EXPEDITION_BUILD_RANGE_METERS}m`
  };
  const kinds = Array.isArray(definition.allowedAnchorKinds)
    ? definition.allowedAnchorKinds
    : ['MAJOR', 'FIELD', 'PLAYER', 'EXPEDITION'];
  return `建設可能範囲内へ設置してください（${kinds.map(kind => labels[kind]).filter(Boolean).join('、')}）。`;
}

function anchorPlacementForSegment(anchors, a, b) {
  const matches = anchors
    .map(anchor => ({ anchor, projection: pointToSegmentProjection(anchor.point, a, b) }))
    .filter(match => match.projection.distance <= (match.anchor.range ?? BUILD_RANGE_METERS))
    .sort((left, right) => left.projection.distance - right.projection.distance);
  const nearest = matches[0] ?? null;
  return nearest ? {
    anchor: nearest.anchor,
    point: nearest.projection.point,
    anchorIds: matches.map(match => match.anchor.id)
  } : null;
}

export class BuildSystem {
  constructor(events) {
    this.events = events;
  }

  getBuildAnchors(state) {
    return buildAnchors(state);
  }

  getBuildStatus(state, type) {
    const definition = DEFENSE_DEFINITIONS[type];
    if (!definition) return { ok: false, reason: '不明な設備です。' };
    return civilizationFailure(state, definition) ?? resourceFailure(state, definition) ?? { ok: true, definition };
  }

  canAfford(state, type) {
    return this.getBuildStatus(state, type).ok;
  }

  listBuildSites(state, type) {
    const definition = DEFENSE_DEFINITIONS[type];
    const graph = state.world.roadGraph;
    if (!definition || !graph?.nodeById) return [];

    let anchors = allowedAnchorsForDefinition(buildAnchors(state), definition);
    anchors = anchors.filter(anchor => !anchorHasFacility(state, definition, anchor));
    if (!anchors.length || civilizationFailure(state, definition)) return [];
    if (definition.kind === 'barrier') {
      const occupied = new Set(
        state.combat.defenses
          .filter(defense => defense.kind === 'barrier')
          .map(defense => defense.edgeId)
      );
      const candidateEdges = new Set();
      for (const anchor of anchors) {
        for (const edge of graphElementsNearPoint(graph, anchor.point, anchor.range ?? BUILD_RANGE_METERS).edges) candidateEdges.add(edge);
      }
      const sites = [];
      for (const edge of candidateEdges) {
        if (occupied.has(edge.id)) continue;
        const a = graph.nodeById.get(edge.a);
        const b = graph.nodeById.get(edge.b);
        if (!a || !b) continue;
        const placement = anchorPlacementForSegment(anchors, a, b);
        if (!placement) continue;
        sites.push({
          type,
          kind: 'barrier',
          edgeId: edge.id,
          point: { x: placement.point.x, y: placement.point.y },
          a: { x: a.x, y: a.y },
          b: { x: b.x, y: b.y },
          anchorId: placement.anchor.id,
          anchorIds: placement.anchorIds
        });
      }
      return sites;
    }

    const occupied = new Set(
      state.combat.defenses
        .filter(defense => defense.kind === 'tower')
        .map(defense => defense.nodeId)
    );
    const candidateNodes = new Set();
    for (const anchor of anchors) {
      for (const node of graphElementsNearPoint(graph, anchor.point, anchor.range ?? BUILD_RANGE_METERS).nodes) candidateNodes.add(node);
    }
    return [...candidateNodes]
      .filter(node => !occupied.has(node.id))
      .map(node => ({ node, anchor: coveringAnchor(anchors, node) }))
      .filter(entry => Boolean(entry.anchor))
      .map(entry => towerCandidate(type, entry.node, entry.anchor));
  }

  previewAt(state, type, worldPoint, selectionToleranceMeters) {
    const definition = DEFENSE_DEFINITIONS[type];
    if (!definition) return { ok: false, reason: '不明な設備です。' };
    const graph = state.world.roadGraph;
    if (!graph?.nodeById) return { ok: false, reason: '道路データを利用できません。' };

    const candidates = definition.kind === 'barrier'
      ? nearbyEdges(graph, worldPoint, selectionToleranceMeters)
        .map(match => barrierCandidate(type, match.edge, match.projection.point))
      : nearbyNodes(graph, worldPoint, selectionToleranceMeters)
        .map(match => towerCandidate(type, match.node));
    if (!candidates.length) {
      return { ok: false, reason: definition.kind === 'barrier' ? '道路をタップしてください。' : '交差点をタップしてください。' };
    }

    let nearestFailure = null;
    for (const candidate of candidates) {
      const validation = this.validateCandidate(state, candidate, { checkResources: false });
      if (validation.ok) return { ...validation, affordable: this.canAfford(state, type) };
      nearestFailure ??= validation;
    }
    return nearestFailure;
  }

  validateCandidate(state, candidate, { checkResources = true } = {}) {
    if (!candidate || typeof candidate !== 'object') return { ok: false, reason: '設置候補がありません。' };
    const definition = DEFENSE_DEFINITIONS[candidate.type];
    if (!definition) return { ok: false, reason: '不明な設備です。' };
    if (candidate.kind !== definition.kind) return { ok: false, reason: '設置候補の種類が一致しません。' };

    const graph = state.world.roadGraph;
    if (!graph?.nodeById) return { ok: false, reason: '道路データを利用できません。' };
    const locked = civilizationFailure(state, definition);
    if (locked) return locked;
    const anchors = allowedAnchorsForDefinition(buildAnchors(state), definition);
    if (!anchors.length) return { ok: false, reason: '建設基準となる拠点・現在地・遠征部隊を取得できません。' };
    let normalized;

    if (definition.kind === 'barrier') {
      const edge = graph.edgeById?.get(candidate.edgeId) ?? graph.edges.find(item => item.id === candidate.edgeId);
      if (!edge) return { ok: false, reason: '対象道路が見つかりません。' };
      const a = graph.nodeById.get(edge.a);
      const b = graph.nodeById.get(edge.b);
      if (!a || !b) return { ok: false, reason: '対象道路の形状が壊れています。' };
      const requestedPoint = finitePoint(candidate.point) ? candidate.point : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const projection = pointToSegmentProjection(requestedPoint, a, b);
      if (projection.distance > CANDIDATE_POINT_TOLERANCE_METERS) return { ok: false, reason: '設置候補が道路上にありません。' };
      const anchor = coveringAnchor(anchors, projection.point);
      if (!anchor) return { ok: false, reason: buildRangeReason(state, definition) };
      if (anchorHasFacility(state, definition, anchor)) return { ok: false, reason: `${anchor.label}には同種設備をこれ以上設置できません。` };
      if (state.combat.defenses.some(defense => defense.kind === 'barrier' && defense.edgeId === edge.id)) {
        return { ok: false, reason: 'この道路には設備があります。先に撤去してください。' };
      }
      normalized = barrierCandidate(candidate.type, edge, projection.point, anchor);
    } else {
      const node = graph.nodeById.get(candidate.nodeId);
      if (!node) return { ok: false, reason: '対象交差点が見つかりません。' };
      const anchor = coveringAnchor(anchors, node);
      if (!anchor) return { ok: false, reason: buildRangeReason(state, definition) };
      if (anchorHasFacility(state, definition, anchor)) return { ok: false, reason: `${anchor.label}には同種設備を1基だけ設置できます。` };
      if (state.combat.defenses.some(defense => defense.kind === 'tower' && defense.nodeId === node.id)) {
        return { ok: false, reason: 'この交差点には設備があります。先に撤去してください。' };
      }
      normalized = towerCandidate(candidate.type, node, anchor);
    }

    if (checkResources) {
      const failure = resourceFailure(state, definition);
      if (failure) return failure;
    }
    return { ok: true, candidate: normalized };
  }

  buildCandidate(state, candidate) {
    const validation = this.validateCandidate(state, candidate, { checkResources: true });
    if (!validation.ok) return validation;

    const normalized = validation.candidate;
    const definition = DEFENSE_DEFINITIONS[normalized.type];
    if (!consumeBundle(state, definition.cost)) return { ok: false, reason: '建設直前に資源が不足しました。' };

    if (definition.kind === 'barrier') {
      const defense = {
        id: stableId('barrier', normalized.edgeId, state.runtime?.worldTimeMs ?? Date.now(), state.combat.defenses.length),
        kind: 'barrier', type: 'barrier', line: 'barrier', tier: 0, defenseKey: 'barrier0',
        edgeId: normalized.edgeId, hp: definition.hp, maxHp: definition.hp, isGate: false,
        buildAnchorId: normalized.anchorId, buildAnchorKind: normalized.anchorKind, baseId: normalized.baseId
      };
      state.combat.defenses.push(defense);
      state.civilization.progress.barriersBuilt = (state.civilization.progress.barriersBuilt ?? 0) + 1;
      for (const enemy of state.combat.enemies) enemy.reroutePending = true;
      const previews = state.world.enemyBases.filter(base => base.alive).map(base =>
        findCombatPath(state, base.nodeId, state.world.city.nodeId, 'infantry')
      );
      this.events?.emit('combat:defense-built', { defense });
      return { ok: true, defense, candidate: normalized, previews };
    }

    const defense = {
      id: stableId('tower', normalized.type, normalized.nodeId, state.runtime?.worldTimeMs ?? Date.now(), state.combat.defenses.length),
      kind: 'tower', type: normalized.type, line: definition.line, tier: definition.initialTier ?? 0, defenseKey: definition.defenseKey ?? `${definition.line}${definition.initialTier ?? 0}`,
      nodeId: normalized.nodeId, hp: definition.hp, maxHp: definition.hp,
      buildAnchorId: normalized.anchorId, buildAnchorKind: normalized.anchorKind, baseId: normalized.baseId,
      cooldown: 0, disabledTimer: 0
    };
    if (normalized.type === 'survey') {
      defense.surveyNextAt = (state.runtime?.worldTimeMs ?? Date.now()) + ROAD_CONFIG.surveyInitialDelayMs;
      defense.surveyStatus = 'WAITING';
      defense.surveyLastChunkId = null;
      defense.surveyCompletedCount = 0;
      defense.surveyErrorCount = 0;
      defense.surveyRetryAt = 0;
      defense.surveyLastError = null;
      defense.surveyLastSuccessAt = 0;
      defense.surveyLastConnectionAt = 0;
      defense.surveyLastResponseElements = 0;
      defense.surveyLastErrorStage = null;
      defense.surveyLastEndpoint = null;
      defense.surveyLastTransport = null;
      defense.surveyLastRoadCount = 0;
    }
    state.combat.defenses.push(defense);
    for (const enemy of state.combat.enemies) enemy.reroutePending = true;
    this.events?.emit('combat:defense-built', { defense });
    return { ok: true, defense, candidate: normalized };
  }

  removeDefense(state, defenseId) {
    const defenses = state.combat?.defenses ?? [];
    const index = defenses.findIndex(defense => defense.id === defenseId);
    if (index < 0) return { ok: false, reason: '撤去する設備が見つかりません。' };

    const defenseIdAtIndex = defenses[index].id;
    const defense = detachDefense(state, defenseIdAtIndex);
    if (!defense) return { ok: false, reason: '撤去する設備が見つかりません。' };
    if (defense.kind === 'barrier') {
      for (const enemy of state.combat?.enemies ?? []) enemy.reroutePending = true;
    }

    const name = defenseRuntimeDefinition(defense).name ?? DEFENSE_DEFINITIONS[defense.type]?.name ?? '設備';
    this.events?.emit('combat:defense-removed', { defenseId: defense.id, defense });
    return { ok: true, defense, message: `${name}を撤去しました。資源は返還されません。` };
  }
}
