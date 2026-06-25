export const MAJOR_BASE_BUILD_RANGES_METERS = Object.freeze([85, 120, 160, 205, 255, 285, 315, 345]);
export const FIELD_BASE_BUILD_RANGES_METERS = Object.freeze([50, 75, 105, 140, 180, 205, 230, 255]);
export const MAJOR_BASE_BUILD_RANGE_METERS = MAJOR_BASE_BUILD_RANGES_METERS[0];
export const FIELD_BASE_BUILD_RANGE_METERS = FIELD_BASE_BUILD_RANGES_METERS[0];
export const PLAYER_BUILD_RANGE_METERS = 85;
export const EXPEDITION_BUILD_RANGE_METERS = 120;

const MAX_RANGE_LEVEL = MAJOR_BASE_BUILD_RANGES_METERS.length - 1;

export function normalizedConstructionLevel(level) {
  return Math.max(0, Math.min(MAX_RANGE_LEVEL, Math.floor(Number(level) || 0)));
}

export function majorBaseBuildRange(level) { return MAJOR_BASE_BUILD_RANGES_METERS[normalizedConstructionLevel(level)]; }
export function fieldBaseBuildRange(level) { return FIELD_BASE_BUILD_RANGES_METERS[normalizedConstructionLevel(level)]; }

export function constructionRangeForAnchorKind(kind, level) {
  if (kind === 'MAJOR') return majorBaseBuildRange(level);
  if (kind === 'FIELD') return fieldBaseBuildRange(level);
  if (kind === 'PLAYER') return PLAYER_BUILD_RANGE_METERS;
  if (kind === 'EXPEDITION') return EXPEDITION_BUILD_RANGE_METERS;
  return 0;
}

export function constructionRangeSummary(level) {
  const normalizedLevel = normalizedConstructionLevel(level);
  return {
    level: normalizedLevel,
    major: MAJOR_BASE_BUILD_RANGES_METERS[normalizedLevel],
    field: FIELD_BASE_BUILD_RANGES_METERS[normalizedLevel],
    player: PLAYER_BUILD_RANGE_METERS,
    expedition: EXPEDITION_BUILD_RANGE_METERS
  };
}
