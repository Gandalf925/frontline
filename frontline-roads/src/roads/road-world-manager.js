import { ROAD_CONFIG } from '../core/constants.js';
import { distance, stableId } from '../core/utilities.js';
import { attachGraphIndexes, graphElementsNearPoint } from './road-graph.js';
import { pointToSegmentProjection } from './geometry.js';
import { mergeRoadGraphs } from './graph-merge.js';
import {
  chunkCenterLocation,
  chunkForWorldPoint,
  chunksIntersectingCircle,
  chunksNearWorldPoint,
  ensureRoadChunkState
} from './world-chunk-grid.js';
import { activeSurveyFacilities, surveyChunkCandidates, synchronizeSurveyFacility } from '../exploration/survey-system.js';
import { defenseRuntimeDefinition } from '../combat/definitions.js';

const ROAD_CHUNK_CACHE_VERSION = 3;

function nearestRoadDistance(graph, point, radius = ROAD_CONFIG.roadFrontierDistanceMeters * 2) {
  if (!graph?.nodeById || !point) return Infinity;
  const elements = graphElementsNearPoint(graph, point, radius);
  let nearest = Infinity;
  for (const node of elements.nodes) nearest = Math.min(nearest, distance(point, node));
  for (const edge of elements.edges) {
    const a = graph.nodeById.get(edge.a);
    const b = graph.nodeById.get(edge.b);
    if (!a || !b) continue;
    nearest = Math.min(nearest, pointToSegmentProjection(point, a, b).distance);
  }
  return nearest;
}

function roadGraphBounds(graph) {
  const nodes = graph?.nodes ?? [];
  if (!nodes.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x);
    maxY = Math.max(maxY, node.y);
  }
  return { minX, minY, maxX, maxY };
}

function isOuterTerminal(node, bounds, margin = ROAD_CONFIG.roadFrontierEdgeMarginMeters) {
  if (!bounds) return false;
  return node.x - bounds.minX <= margin
    || bounds.maxX - node.x <= margin
    || node.y - bounds.minY <= margin
    || bounds.maxY - node.y <= margin;
}

function nearestTerminalNode(graph, point, radius = ROAD_CONFIG.roadFrontierDistanceMeters) {
  const bounds = roadGraphBounds(graph);
  let best = null;
  let bestDistance = radius;
  for (const node of graph?.terminalNodes ?? []) {
    if (!isOuterTerminal(node, bounds)) continue;
    const gap = distance(point, node);
    if (gap <= bestDistance) {
      best = node;
      bestDistance = gap;
    }
  }
  return best ? { node: best, distance: bestDistance } : null;
}

function normalizedDirection(from, to) {
  const dx = Number(to?.x) - Number(from?.x);
  const dy = Number(to?.y) - Number(from?.y);
  const magnitude = Math.hypot(dx, dy);
  return magnitude > 0 ? { x: dx / magnitude, y: dy / magnitude } : null;
}

function terminalOutwardDirection(graph, terminal) {
  const connection = graph?.adjacency?.get(terminal?.id)?.[0];
  const neighbor = connection ? graph.nodeById?.get(connection.to) : null;
  return neighbor ? normalizedDirection(neighbor, terminal) : null;
}

function movementExpansionCandidates(graph, point, previousPoint, sizeMeters) {
  const candidates = new Map();
  const add = (chunk, priority, reason) => {
    const current = candidates.get(chunk.id);
    if (!current || priority < current.priority) candidates.set(chunk.id, { ...chunk, priority, reason });
  };
  for (const chunk of chunksNearWorldPoint(point, sizeMeters)) add(chunk, 0, 'position');

  const moved = previousPoint ? distance(previousPoint, point) : 0;
  const movementDirection = moved >= ROAD_CONFIG.roadMinimumMovementMeters
    ? normalizedDirection(previousPoint, point)
    : null;
  const terminal = nearestTerminalNode(graph, point);
  const roadGap = nearestRoadDistance(graph, point);
  const nearFrontier = Boolean(terminal) || roadGap > ROAD_CONFIG.roadOffNetworkDistanceMeters;

  if (nearFrontier) {
    for (const chunk of chunksIntersectingCircle(point, ROAD_CONFIG.roadExpansionRadiusMeters, sizeMeters)) add(chunk, 1, 'road-frontier');
  }

  const direction = movementDirection ?? (terminal ? terminalOutwardDirection(graph, terminal.node) : null);
  if (direction && (movementDirection || nearFrontier)) {
    const origin = terminal?.node ?? point;
    const lookahead = {
      x: origin.x + direction.x * ROAD_CONFIG.roadLookaheadMeters,
      y: origin.y + direction.y * ROAD_CONFIG.roadLookaheadMeters
    };
    for (const chunk of chunksNearWorldPoint(lookahead, sizeMeters)) add(chunk, 2, 'movement-lookahead');
  }

  return {
    nearFrontier,
    moving: Boolean(movementDirection),
    roadGap,
    terminalDistance: terminal?.distance ?? Infinity,
    chunks: [...candidates.values()].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
  };
}

function compactChunkGraph(graph) {
  return {
    nodes: graph.nodes.map(({ lat, lon, ...node }) => ({ ...node })),
    edges: graph.edges.map(({ points, mid, angle, ...edge }) => ({ ...edge })),
    center: graph.center,
    source: graph.source,
    roadSpecVersion: graph.roadSpecVersion,
    chunkId: graph.chunkId,
    cacheVersion: ROAD_CHUNK_CACHE_VERSION
  };
}

function usableCachedChunk(graph) {
  return Number(graph?.cacheVersion) === ROAD_CHUNK_CACHE_VERSION
    && Number(graph?.roadSpecVersion) >= 3
    && Array.isArray(graph?.nodes)
    && Array.isArray(graph.edges)
    && graph.nodes.length > 0
    && graph.edges.length > 0;
}

export function roadWorldId(graph) {
  const lat = Number(graph?.center?.lat ?? 0).toFixed(4);
  const lon = Number(graph?.center?.lon ?? 0).toFixed(4);
  return stableId('road_world', lat, lon);
}

export class RoadWorldManager {
  constructor({ roadService, cache, store, renderer = null, onGraphChanged = null, onStatus = null, now = () => Date.now() }) {
    this.roadService = roadService;
    this.cache = cache;
    this.store = store;
    this.renderer = renderer;
    this.onGraphChanged = onGraphChanged;
    this.onStatus = onStatus;
    this.now = now;
    this.queue = [];
    this.pending = new Set();
    this.running = false;
    this.abortController = null;
    this.lastSurveyCheckAt = 0;
    this.lastMovementPoint = null;
    this.generation = 0;
  }

  async restoreCachedChunks() {
    const state = this.store.snapshot();
    const graph = state.world.roadGraph;
    if (!graph || !this.cache?.isAvailable?.()) return { restored: 0 };
    const chunks = state.world.roadChunks;
    const worldId = roadWorldId(graph);
    let restored = 0;
    for (const id of chunks.cached ?? []) {
      if (chunks.integrated?.includes(id)) continue;
      const payload = await this.cache.get(worldId, id).catch(() => null);
      if (!usableCachedChunk(payload)) {
        if (payload) await this.cache.remove?.(worldId, id).catch(() => false);
        this.store.transaction(draft => {
          const chunkState = ensureRoadChunkState(draft.world);
          chunkState.cached = chunkState.cached.filter(chunkId => chunkId !== id);
        }, 'roads:stale-cache-removed');
        continue;
      }
      attachGraphIndexes(payload);
      this.store.transaction(draft => {
        mergeRoadGraphs(draft.world.roadGraph, payload, { chunkId: id });
        const chunkState = ensureRoadChunkState(draft.world);
        if (!chunkState.loaded.includes(id)) chunkState.loaded.push(id);
        if (!chunkState.cached.includes(id)) chunkState.cached.push(id);
        if (!chunkState.integrated.includes(id)) chunkState.integrated.push(id);
      }, 'roads:cache-restored');
      restored += 1;
    }
    if (restored > 0) this.graphChanged({ reason: 'cache', restored });
    return { restored };
  }

  considerLocation(location) {
    const state = this.store.snapshot();
    const graph = state.world.roadGraph;
    if (!graph || !location) return [];
    const chunks = state.world.roadChunks;
    const worldPoint = state.player.worldPosition;
    if (!worldPoint) return [];

    const observedChunkId = chunkForWorldPoint(worldPoint, chunks.sizeMeters).id;
    let observationChanged = false;
    this.store.transaction(draft => {
      const chunkState = ensureRoadChunkState(draft.world);
      if ((chunkState.loaded.includes(observedChunkId) || chunkState.empty.includes(observedChunkId)) && !chunkState.playerObserved.includes(observedChunkId)) {
        chunkState.playerObserved.push(observedChunkId);
        observationChanged = true;
      }
    }, 'roads:player-observed');
    if (observationChanged) this.graphChanged({ reason: 'player-observed', chunkId: observedChunkId });

    const expansion = movementExpansionCandidates(graph, worldPoint, this.lastMovementPoint, chunks.sizeMeters);
    this.lastMovementPoint = { x: worldPoint.x, y: worldPoint.y };
    const retryCooldownMs = expansion.nearFrontier || expansion.moving
      ? ROAD_CONFIG.movementChunkRetryCooldownMs
      : ROAD_CONFIG.chunkRetryCooldownMs;
    const candidates = expansion.chunks
      .filter(chunk => (chunks.refresh?.includes(chunk.id) || (!chunks.loaded.includes(chunk.id) && !chunks.empty.includes(chunk.id))) && !this.pending.has(chunk.id))
      .filter(chunk => {
        const failure = chunks.failed?.[chunk.id];
        if (!failure) return true;
        const failedAt = Number(failure.at);
        return !Number.isFinite(failedAt) || this.now() - failedAt >= retryCooldownMs;
      })
      .slice(0, ROAD_CONFIG.movementChunkBatchLimit);
    for (const chunk of candidates) this.enqueue(chunk, graph.center, {
      mode: 'movement',
      observe: chunk.id === observedChunkId,
      reason: chunk.reason
    });
    return candidates.map(chunk => chunk.id);
  }

  considerSurveyFacilities({ forceDefenseId = null } = {}) {
    const realNow = this.now();
    if (!forceDefenseId && realNow - this.lastSurveyCheckAt < 30000) return [];
    this.lastSurveyCheckAt = realNow;
    const hasSurveyFacility = this.store.read(state => activeSurveyFacilities(state)
      .some(defense => !forceDefenseId || defense.id === forceDefenseId));
    if (!hasSurveyFacility) return [];
    let plan = null;
    this.store.transaction(state => {
      const worldTimeMs = Number(state.runtime?.worldTimeMs) || realNow;
      const facilities = activeSurveyFacilities(state)
        .filter(defense => !forceDefenseId || defense.id === forceDefenseId);
      for (const defense of facilities) {
        synchronizeSurveyFacility(defense, worldTimeMs);
        if (forceDefenseId) {
          defense.surveyNextAt = 0;
          defense.surveyRetryAt = 0;
        }
        if (defense.disabledTimer > 0 || (!forceDefenseId && worldTimeMs < Math.max(defense.surveyNextAt, defense.surveyRetryAt))) continue;
        const candidateOptions = {
          pendingIds: this.pending,
          now: realNow,
          retryCooldownMs: forceDefenseId ? 0 : ROAD_CONFIG.surveyRetryCooldownMs
        };
        const candidates = surveyChunkCandidates(state, defense, candidateOptions);
        const allCandidates = surveyChunkCandidates(state, defense, {
          pendingIds: new Set(),
          now: realNow,
          retryCooldownMs: 0
        });
        const definition = defenseRuntimeDefinition(defense);
        const intervalSeconds = Math.max(30, Number(definition?.scanInterval) || 180);
        defense.surveyNextAt = worldTimeMs + intervalSeconds * 1000;
        if (!candidates.length) {
          const pendingCandidate = allCandidates.some(candidate => this.pending.has(candidate.id));
          const failedCandidate = allCandidates.some(candidate => state.world.roadChunks.failed?.[candidate.id]);
          defense.surveyStatus = pendingCandidate ? 'QUEUED' : failedCandidate ? 'RETRY_WAIT' : 'COMPLETE';
          if (failedCandidate) defense.surveyRetryAt = Math.max(defense.surveyRetryAt, worldTimeMs + ROAD_CONFIG.surveyRetryCooldownMs);
          continue;
        }
        const chunk = candidates[0];
        defense.surveyStatus = 'QUEUED';
        defense.surveyLastChunkId = chunk.id;
        plan = { chunk, worldCenter: state.world.roadGraph.center, defenseId: defense.id };
        break;
      }
    }, forceDefenseId ? 'survey:manual-schedule' : 'survey:schedule');
    if (!plan) return [];
    this.enqueue(plan.chunk, plan.worldCenter, { mode: 'survey', defenseId: plan.defenseId });
    return [plan.chunk.id];
  }

  requestSurvey(defenseId) {
    const state = this.store.snapshot();
    const defense = activeSurveyFacilities(state).find(item => item.id === defenseId);
    if (!defense) return { ok: false, reason: 'この測量施設は現在稼働できません。' };
    if (defense.disabledTimer > 0) return { ok: false, reason: `機能停止中です。あと${Math.ceil(defense.disabledTimer)}秒待ってください。` };
    const queued = this.considerSurveyFacilities({ forceDefenseId: defenseId });
    const latest = this.store.snapshot().combat.defenses.find(item => item.id === defenseId);
    if (queued.length > 0) return { ok: true, message: '道路測量を開始しました。', chunkId: queued[0] };
    if (latest?.surveyStatus === 'LOADING' || latest?.surveyStatus === 'QUEUED') {
      return { ok: true, message: '道路測量はすでに進行中です。' };
    }
    if (latest?.surveyStatus === 'COMPLETE') {
      return { ok: false, reason: '現在の測量半径内に未取得の道路区域はありません。' };
    }
    return { ok: false, reason: latest?.surveyLastError ? `道路取得に失敗しました：${latest.surveyLastError}` : '測量可能な隣接区域がありません。' };
  }

  enqueue(chunk, worldCenter, options = {}) {
    if (this.pending.has(chunk.id)) return;
    this.pending.add(chunk.id);
    this.queue.push({ chunk, worldCenter, options, generation: this.generation });
    this.processQueue();
  }

  async processQueue() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const next = this.queue.shift();
        if (next.generation !== this.generation) {
          this.pending.delete(next.chunk.id);
          continue;
        }
        try {
          await this.loadChunk(next.chunk, next.worldCenter, { ...next.options, generation: next.generation });
        } catch (error) {
          this.onStatus?.({ type: 'error', chunkId: next.chunk.id, text: '道路区域の統合に失敗しました。' });
        } finally {
          this.pending.delete(next.chunk.id);
        }
      }
    } finally {
      this.running = false;
    }
  }

  async loadChunk(chunk, worldCenter, { mode = 'movement', defenseId = null, observe = mode === 'movement', generation = this.generation } = {}) {
    const stale = () => generation !== this.generation;
    if (stale()) return;
    const state = this.store.snapshot();
    const currentChunks = state.world.roadChunks;
    const refreshRequired = currentChunks.refresh?.includes(chunk.id) === true;
    if (!refreshRequired && (currentChunks.loaded.includes(chunk.id) || currentChunks.empty.includes(chunk.id))) {
      this.store.transaction(draft => {
        const chunkState = ensureRoadChunkState(draft.world);
        const observationList = mode === 'survey' ? chunkState.surveyed : observe ? chunkState.playerObserved : null;
        if (observationList && !observationList.includes(chunk.id)) observationList.push(chunk.id);
        if (defenseId) {
          const defense = draft.combat.defenses.find(item => item.id === defenseId);
          if (defense) {
            defense.surveyStatus = 'WAITING';
            defense.surveyErrorCount = 0;
            defense.surveyRetryAt = 0;
            defense.surveyLastError = null;
          }
        }
      }, 'roads:chunk-already-loaded');
      return;
    }
    const worldId = roadWorldId(state.world.roadGraph);
    this.onStatus?.({ type: 'loading', chunkId: chunk.id, text: mode === 'survey' ? '測量施設が周辺道路を解析しています…' : '周辺道路を偵察しています…' });
    if (defenseId) {
      this.store.transaction(draft => {
        const defense = draft.combat.defenses.find(item => item.id === defenseId);
        if (defense) defense.surveyStatus = 'LOADING';
      }, 'survey:loading');
    }

    let graph = refreshRequired ? null : await this.cache?.get?.(worldId, chunk.id).catch(() => null);
    if (refreshRequired) await this.cache?.remove?.(worldId, chunk.id).catch(() => false);
    if (stale()) return;
    if (graph && !usableCachedChunk(graph)) {
      await this.cache?.remove?.(worldId, chunk.id).catch(() => false);
      this.store.transaction(draft => {
        const chunkState = ensureRoadChunkState(draft.world);
        chunkState.cached = chunkState.cached.filter(chunkId => chunkId !== chunk.id);
      }, 'roads:stale-cache-removed');
      graph = null;
    }
    let source = 'cache';
    let networkSuccess = null;
    let acquisitionReport = null;
    if (graph) attachGraphIndexes(graph);
    if (!graph) {
      source = 'network';
      this.abortController = new AbortController();
      const connectionBeforeSequence = Number(this.roadService.overpassClient?.getLastSuccess?.()?.sequence) || 0;
      try {
        const chunkCenter = chunkCenterLocation(chunk, worldCenter, currentChunks.sizeMeters);
        graph = await this.roadService.loadChunk({
          worldCenter,
          chunkCenter,
          chunkId: chunk.id,
          radiusMeters: ROAD_CONFIG.chunkFetchRadiusMeters
        }, { signal: this.abortController.signal });
        networkSuccess = this.roadService.overpassClient?.getLastSuccess?.() ?? null;
        acquisitionReport = graph?.acquisitionReport ?? this.roadService.lastAcquisitionReport ?? null;
        if (stale()) return;
        if (graph.nodes.length > 0 && graph.edges.length > 0) {
          await this.cache?.put?.(worldId, chunk.id, compactChunkGraph(graph)).catch(() => false);
        }
        if (stale()) return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
        const connectionAfter = this.roadService.overpassClient?.getLastSuccess?.() ?? null;
        const communicationSucceeded = Number(connectionAfter?.sequence) > connectionBeforeSequence;
        const unconfirmedEmpty = communicationSucceeded
          && Number(connectionAfter?.elementCount) === 0
          && connectionAfter?.confirmedEmpty !== true;
        const processingFailed = communicationSucceeded && !unconfirmedEmpty;
        const failureDetail = String(error?.details ?? error?.message ?? error).replace(/\s+/g, ' ').slice(0, 210);
        this.store.transaction(draft => {
          const chunkState = ensureRoadChunkState(draft.world);
          chunkState.failed[chunk.id] = { at: this.now(), message: String(error?.message ?? error).slice(0, 160) };
          chunkState.updatedAt = this.now();
          if (defenseId) {
            const defense = draft.combat.defenses.find(item => item.id === defenseId);
            if (defense) {
              const worldTimeMs = Number(draft.runtime?.worldTimeMs) || this.now();
              defense.surveyErrorCount = Math.max(0, Number(defense.surveyErrorCount) || 0) + 1;
              defense.surveyLastErrorStage = processingFailed ? 'PROCESSING' : 'NETWORK';
              defense.surveyLastError = `${processingFailed ? '通信成功・道路処理失敗' : unconfirmedEmpty ? '空応答の確認未完了' : '通信失敗'}：${failureDetail}`.slice(0, 240);
              if (communicationSucceeded) {
                defense.surveyLastConnectionAt = worldTimeMs;
                defense.surveyLastEndpoint = connectionAfter.host ?? 'overpass';
                defense.surveyLastTransport = connectionAfter.transport ?? null;
                defense.surveyLastResponseElements = Math.max(0, Number(connectionAfter.elementCount) || 0);
              }
              defense.surveyRetryAt = worldTimeMs + ROAD_CONFIG.surveyRetryCooldownMs;
              defense.surveyNextAt = Math.max(Number(defense.surveyNextAt) || 0, defense.surveyRetryAt);
              defense.surveyStatus = 'RETRY_WAIT';
            }
          }
        }, 'roads:chunk-failed');
        this.onStatus?.({
          type: 'error',
          chunkId: chunk.id,
          text: mode === 'survey'
            ? processingFailed
              ? '道路サーバーとの通信には成功しましたが、道路データの処理に失敗しました。再試行します。'
              : unconfirmedEmpty
                ? '道路なしという応答を別サーバーで確認できませんでした。自動再試行します。'
                : '測量施設が道路サーバーへ接続できませんでした。時間を置いて再試行します。'
            : unconfirmedEmpty
              ? '道路なしという応答を確認できなかったため、移動後に再試行します。'
              : '周辺道路を取得できませんでした。移動後に再試行します。'
        });
        return;
      } finally {
        this.abortController = null;
      }
    }

    if (stale()) return;
    let mergeResult = { addedNodes: 0, addedEdges: 0, mergedEdges: 0 };
    this.store.transaction(draft => {
      const chunkState = ensureRoadChunkState(draft.world);
      delete chunkState.failed[chunk.id];
      chunkState.refresh = (chunkState.refresh ?? []).filter(chunkId => chunkId !== chunk.id);
      if (graph.nodes.length === 0 || graph.edges.length === 0) {
        if (!chunkState.empty.includes(chunk.id)) chunkState.empty.push(chunk.id);
      } else {
        mergeResult = mergeRoadGraphs(draft.world.roadGraph, graph, { chunkId: chunk.id });
        if (!chunkState.loaded.includes(chunk.id)) chunkState.loaded.push(chunk.id);
        if (!chunkState.cached.includes(chunk.id)) chunkState.cached.push(chunk.id);
        if (!chunkState.integrated.includes(chunk.id)) chunkState.integrated.push(chunk.id);
      }
      const observationList = mode === 'survey' ? chunkState.surveyed : observe ? chunkState.playerObserved : null;
      if (observationList && !observationList.includes(chunk.id)) observationList.push(chunk.id);
      if (defenseId) {
        const defense = draft.combat.defenses.find(item => item.id === defenseId);
        if (defense) {
          defense.surveyStatus = 'WAITING';
          defense.surveyCompletedCount = Math.max(0, Number(defense.surveyCompletedCount) || 0) + 1;
          defense.surveyLastChunkId = chunk.id;
          defense.surveyErrorCount = 0;
          defense.surveyRetryAt = 0;
          defense.surveyLastError = null;
          defense.surveyLastErrorStage = null;
          defense.surveyLastSuccessAt = Number(draft.runtime?.worldTimeMs) || this.now();
          if (source === 'network') {
            defense.surveyLastConnectionAt = defense.surveyLastSuccessAt;
            defense.surveyLastEndpoint = networkSuccess?.host ?? 'overpass';
            defense.surveyLastTransport = networkSuccess?.transport ?? 'POST';
            defense.surveyLastResponseElements = Math.max(0, Number(networkSuccess?.elementCount) || 0);
          } else if (!defense.surveyLastEndpoint) {
            defense.surveyLastEndpoint = 'local-cache';
            defense.surveyLastTransport = 'CACHE';
          }
          defense.surveyLastRoadCount = Math.max(0, graph.edges.length);
        }
      }
      chunkState.lastAcquisition = {
        chunkId: chunk.id,
        source,
        at: this.now(),
        responseElements: Math.max(0, Number(acquisitionReport?.responseElements) || 0),
        acceptedWays: Math.max(0, Number(acquisitionReport?.acceptedWays) || 0),
        excludedWays: Math.max(0, Number(acquisitionReport?.excludedWays) || 0),
        retainedSegments: Math.max(0, Number(acquisitionReport?.retainedSegmentCount) || 0),
        graphEdges: Math.max(0, Number(graph.edges.length) || 0),
        addedEdges: Math.max(0, Number(mergeResult.addedEdges) || 0)
      };
      chunkState.updatedAt = this.now();
    }, 'roads:chunk-merged', { validate: true });

    this.graphChanged({ reason: source, chunkId: chunk.id, ...mergeResult });
    this.onStatus?.({
      type: 'loaded',
      chunkId: chunk.id,
      text: graph.edges.length > 0
        ? `${mode === 'survey' ? '測量施設が新しい道路区域を追加しました' : '新しい道路区域を確認しました'}（道路 ${mergeResult.addedEdges}${mode === 'survey' && networkSuccess?.host ? ` / ${networkSuccess.host} ${networkSuccess.transport}` : ''}）`
        : mode === 'survey' ? '測量区域に利用可能な道路はありませんでした。' : 'この区域には利用可能な道路がありません。'
    });
  }

  graphChanged(detail) {
    const graph = this.store.snapshot().world.roadGraph;
    this.renderer?.setGraph(graph);
    this.renderer?.invalidateStatic?.();
    this.renderer?.render?.();
    this.onGraphChanged?.(detail);
  }

  abort() {
    this.generation += 1;
    this.queue.length = 0;
    this.pending.clear();
    this.abortController?.abort();
    this.abortController = null;
    this.lastSurveyCheckAt = 0;
    this.lastMovementPoint = null;
  }

  async clearCurrentWorld() {
    const graph = this.store.snapshot().world.roadGraph;
    if (!graph) return false;
    return this.cache?.removeWorld?.(roadWorldId(graph)).catch(() => false) ?? false;
  }

  destroy() {
    this.abort();
    this.cache?.close?.();
  }
}
