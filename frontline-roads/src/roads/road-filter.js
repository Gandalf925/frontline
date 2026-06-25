import { ALLOWED_HIGHWAYS, EXCLUDED_SERVICE, MAJOR_HIGHWAYS } from './road-constants.js';
import { clamp } from '../core/utilities.js';

export function isAllowedWay(tags = {}) {
  const highway = tags.highway;
  if (!ALLOWED_HIGHWAYS.has(highway)) return false;
  if (tags.access === 'private' || tags.access === 'no') return false;
  if (EXCLUDED_SERVICE.has(tags.service)) return false;
  if (tags.area === 'yes') return false;
  return true;
}

export function normalizeRoadName(tags = {}) {
  return String(tags.name || tags.ref || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-‐‑‒–—―]+/g, ' ');
}

export function parseLaneCount(tags = {}, highway = 'residential') {
  const direct = Number.parseFloat(String(tags.lanes || '').split(';')[0]);
  if (Number.isFinite(direct) && direct > 0) return clamp(Math.round(direct), 1, 10);
  const forward = Number.parseFloat(tags['lanes:forward']);
  const backward = Number.parseFloat(tags['lanes:backward']);
  if (Number.isFinite(forward) || Number.isFinite(backward)) {
    return clamp(Math.round((forward || 0) + (backward || 0)), 1, 10);
  }
  if (tags.oneway === 'yes' || tags.junction === 'roundabout') return 1;
  return MAJOR_HIGHWAYS.has(highway) ? 2 : 1;
}

export function roadWidthMeters(highway, lanes, tags = {}) {
  const explicit = Number.parseFloat(tags.width);
  if (Number.isFinite(explicit) && explicit > 1) return clamp(explicit, 2.5, 30);
  const base = {
    motorway: 13,
    motorway_link: 9.5,
    trunk: 12,
    trunk_link: 9,
    primary: 10.5,
    primary_link: 8.5,
    secondary: 9,
    secondary_link: 7.5,
    tertiary: 7.5,
    tertiary_link: 6.5,
    residential: 5.5,
    unclassified: 5,
    living_street: 4.5,
    service: 4.2,
    road: 4
  }[highway] ?? 5;
  return clamp(Math.max(base, lanes * 3.15 + (lanes > 1 ? 1 : 0)), 3.2, 28);
}
