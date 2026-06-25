import { distance } from '../core/utilities.js';
import { defenseRuntimeDefinition } from '../combat/definitions.js';
import { chunksIntersectingCircle, neighboringChunks } from '../roads/world-chunk-grid.js';
import { activePlayerBases } from '../base/player-bases.js';
import { activeFieldBases } from '../base/field-bases.js';
import { ROAD_CONFIG } from '../core/constants.js';

export const SURVEY_FACILITY_TYPE = 'survey';

const SURVEY_STATUS_LABELS = Object.freeze({
  WAITING: '次回測量待ち',
  QUEUED: '取得待ち',
  LOADING: '道路取得中',
  RETRY_WAIT: '再試行待ち',
  COMPLETE: '範囲内取得完了',
  ERROR: '取得失敗'
});

function hasOperationalAnchor(state, defense) {
  if (defense.buildAnchorKind === 'FIELD') {
    return activeFieldBases(state).some(base => base.id === defense.baseId);
  }
  if (defense.buildAnchorKind === 'MAJOR') {
    return activePlayerBases(state).some(base => base.id === defense.baseId);
  }
  return true;
}

export function activeSurveyFacilities(state) {
  return (state?.combat?.defenses ?? [])
    .filter(defense => defense.type === SURVEY_FACILITY_TYPE && defense.kind === 'tower' && defense.hp > 0)
    .filter(defense => hasOperationalAnchor(state, defense))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

export function synchronizeSurveyFacility(defense, worldTimeMs = Date.now()) {
  if (!defense || defense.type !== SURVEY_FACILITY_TYPE) return defense;
  defenseRuntimeDefinition(defense);
  defense.surveyNextAt = Number(defense.surveyNextAt) || worldTimeMs + ROAD_CONFIG.surveyInitialDelayMs;
  defense.surveyLastChunkId ??= null;
  defense.surveyStatus ??= 'WAITING';
  defense.surveyCompletedCount = Math.max(0, Math.floor(Number(defense.surveyCompletedCount) || 0));
  defense.surveyErrorCount = Math.max(0, Math.floor(Number(defense.surveyErrorCount) || 0));
  defense.surveyRetryAt = Math.max(0, Number(defense.surveyRetryAt) || 0);
  defense.surveyLastError = defense.surveyLastError ? String(defense.surveyLastError).slice(0, 240) : null;
  defense.surveyLastSuccessAt = Math.max(0, Number(defense.surveyLastSuccessAt) || 0);
  defense.surveyLastConnectionAt = Math.max(0, Number(defense.surveyLastConnectionAt) || 0);
  defense.surveyLastResponseElements = Math.max(0, Math.floor(Number(defense.surveyLastResponseElements) || 0));
  defense.surveyLastErrorStage = defense.surveyLastErrorStage === 'PROCESSING' || defense.surveyLastErrorStage === 'NETWORK' ? defense.surveyLastErrorStage : null;
  defense.surveyLastEndpoint = defense.surveyLastEndpoint ? String(defense.surveyLastEndpoint).slice(0, 100) : null;
  defense.surveyLastTransport = ['GET', 'POST', 'SANDBOX_JSONP', 'CACHE'].includes(defense.surveyLastTransport) ? defense.surveyLastTransport : null;
  defense.surveyLastRoadCount = Math.max(0, Math.floor(Number(defense.surveyLastRoadCount) || 0));
  return defense;
}

function hasLoadedNeighbor(chunk, loaded) {
  return neighboringChunks(chunk, 1)
    .some(candidate => candidate.id !== chunk.id && loaded.has(candidate.id));
}

export function surveyChunkCandidates(state, defense, { pendingIds = new Set(), now = Date.now(), retryCooldownMs = 0 } = {}) {
  const graph = state?.world?.roadGraph;
  const chunks = state?.world?.roadChunks;
  const node = graph?.nodeById?.get(defense?.nodeId);
  const definition = defenseRuntimeDefinition(defense);
  const radius = Math.max(0, Number(definition?.surveyRadius) || 0);
  if (!node || !chunks || radius <= 0) return [];

  const loaded = new Set([...(chunks.loaded ?? []), ...(chunks.empty ?? [])]);
  const refresh = new Set(chunks.refresh ?? []);
  const acquisitionAnchors = new Set([...loaded, ...(chunks.integrated ?? [])]);
  return chunksIntersectingCircle(node, radius, chunks.sizeMeters)
    .filter(chunk => (refresh.has(chunk.id) || !loaded.has(chunk.id)) && !pendingIds.has(chunk.id))
    .filter(chunk => {
      const failure = chunks.failed?.[chunk.id];
      if (!failure) return true;
      const failedAt = Number(failure.at);
      return !Number.isFinite(failedAt) || now - failedAt >= retryCooldownMs;
    })
    .filter(chunk => hasLoadedNeighbor(chunk, acquisitionAnchors))
    .map(chunk => ({
      ...chunk,
      distance: distance(node, chunk.center)
    }))
    .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
}

export function surveyFacilityPresentation(state, defense, pendingIds = new Set()) {
  if (!defense || defense.type !== SURVEY_FACILITY_TYPE) return null;
  const definition = defenseRuntimeDefinition(defense);
  const now = Number(state?.runtime?.worldTimeMs) || Date.now();
  const candidates = surveyChunkCandidates(state, defense, { pendingIds, now, retryCooldownMs: 0 });
  const status = defense.surveyStatus ?? 'WAITING';
  const nextAt = Math.max(Number(defense.surveyNextAt) || now, Number(defense.surveyRetryAt) || 0);
  return {
    radius: Number(definition?.surveyRadius) || 0,
    intervalSeconds: Number(definition?.scanInterval) || 0,
    nextScanSeconds: Math.max(0, Math.ceil((nextAt - now) / 1000)),
    remainingChunks: candidates.length,
    completedCount: Math.max(0, Number(defense.surveyCompletedCount) || 0),
    errorCount: Math.max(0, Number(defense.surveyErrorCount) || 0),
    lastError: defense.surveyLastError ?? null,
    lastSuccessAt: Math.max(0, Number(defense.surveyLastSuccessAt) || 0),
    lastConnectionAt: Math.max(0, Number(defense.surveyLastConnectionAt) || 0),
    lastResponseElements: Math.max(0, Number(defense.surveyLastResponseElements) || 0),
    lastErrorStage: defense.surveyLastErrorStage ?? null,
    lastEndpoint: defense.surveyLastEndpoint ?? null,
    lastTransport: defense.surveyLastTransport ?? null,
    lastRoadCount: Math.max(0, Number(defense.surveyLastRoadCount) || 0),
    status,
    statusLabel: SURVEY_STATUS_LABELS[status] ?? status
  };
}
