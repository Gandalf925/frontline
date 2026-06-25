export const APP_VERSION = '0.33.1-tab-resume-recovery';
export const SAVE_KEY = 'frontline_roads_refactor_v2';
export const SCHEMA_VERSION = 2;

export const LifecycleState = Object.freeze({
  BOOT: 'BOOT',
  LOAD_SAVE: 'LOAD_SAVE',
  MIGRATION: 'MIGRATION',
  LOCATION_REQUIRED: 'LOCATION_REQUIRED',
  ROAD_LOADING: 'ROAD_LOADING',
  BASE_SELECTION: 'BASE_SELECTION',
  INITIALIZING: 'INITIALIZING',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  ERROR: 'ERROR',
  DESTROYED: 'DESTROYED'
});

export const ALLOWED_TRANSITIONS = Object.freeze({
  BOOT: ['LOAD_SAVE', 'DESTROYED'],
  LOAD_SAVE: ['MIGRATION', 'LOCATION_REQUIRED', 'PLAYING', 'ERROR', 'DESTROYED'],
  MIGRATION: ['LOCATION_REQUIRED', 'PLAYING', 'ERROR', 'DESTROYED'],
  LOCATION_REQUIRED: ['ROAD_LOADING', 'ERROR', 'DESTROYED'],
  ROAD_LOADING: ['BASE_SELECTION', 'LOCATION_REQUIRED', 'ERROR', 'DESTROYED'],
  BASE_SELECTION: ['INITIALIZING', 'LOCATION_REQUIRED', 'ERROR', 'DESTROYED'],
  INITIALIZING: ['PLAYING', 'ERROR', 'DESTROYED'],
  PLAYING: ['PAUSED', 'ERROR', 'DESTROYED'],
  PAUSED: ['PLAYING', 'ERROR', 'DESTROYED'],
  ERROR: ['LOCATION_REQUIRED', 'LOAD_SAVE', 'DESTROYED'],
  DESTROYED: []
});

export const ROAD_CONFIG = Object.freeze({
  selectionRadiusMeters: 1000,
  fetchRadiusMeters: 1500,
  initialRetentionRadiusMeters: 1250,
  chunkSizeMeters: 600,
  chunkFetchRadiusMeters: 900,
  chunkRetentionPaddingMeters: 120,
  chunkPrefetchRadius: 1,
  chunkPrefetchDistanceMeters: 180,
  roadFrontierDistanceMeters: 220,
  roadFrontierEdgeMarginMeters: 260,
  roadOffNetworkDistanceMeters: 90,
  roadLookaheadMeters: 420,
  roadExpansionRadiusMeters: 260,
  roadMinimumMovementMeters: 8,
  movementChunkBatchLimit: 6,
  movementChunkRetryCooldownMs: 45 * 1000,
  chunkRetryCooldownMs: 5 * 60 * 1000,
  surveyInitialDelayMs: 5 * 1000,
  surveyRetryCooldownMs: 90 * 1000,
  overpassTimeoutMs: 18000,
  overpassTotalTimeoutMs: 90000,
  emptyResultConfirmationEndpoints: 2,
  minimumRawSegments: 18,
  minimumNodes: 14,
  minimumEdges: 16,
  maxSegmentLengthMeters: 280,
  minSegmentLengthMeters: 5,
  maxDistanceFromCenterMeters: 1250,
  selectionTolerancePixels: 24
});
