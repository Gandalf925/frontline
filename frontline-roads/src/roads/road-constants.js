export const ROAD_PRIORITY = Object.freeze({
  road: 1,
  service: 2,
  living_street: 2,
  residential: 3,
  unclassified: 3,
  tertiary_link: 4,
  tertiary: 4,
  secondary_link: 5,
  secondary: 5,
  primary_link: 6,
  primary: 6,
  trunk_link: 7,
  trunk: 7,
  motorway_link: 8,
  motorway: 8
});

export const ALLOWED_HIGHWAYS = new Set(Object.keys(ROAD_PRIORITY));
export const OVERPASS_HIGHWAY_PATTERN = [...ALLOWED_HIGHWAYS]
  .sort((a, b) => b.length - a.length || a.localeCompare(b))
  .join('|');
export const MAJOR_HIGHWAYS = new Set([
  'motorway', 'motorway_link', 'trunk', 'trunk_link',
  'primary', 'primary_link', 'secondary', 'secondary_link',
  'tertiary', 'tertiary_link'
]);
export const EXCLUDED_SERVICE = new Set(['driveway', 'parking_aisle', 'drive-through', 'emergency_access', 'alley']);
