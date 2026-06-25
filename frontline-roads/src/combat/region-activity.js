import { distance } from '../core/utilities.js';
import { activeOwnedBases } from '../base/field-bases.js';

export const REGION_ACTIVITY = Object.freeze({
  ACTIVE: 'ACTIVE',
  PERIPHERAL: 'PERIPHERAL',
  DORMANT: 'DORMANT'
});

export const REGION_ACTIVITY_CONFIG = Object.freeze({
  activeRadiusMeters: 900,
  peripheralRadiusMeters: 2400,
  peripheralIntervalSeconds: 2,
  dormantIntervalSeconds: 8,
  maximumSimulationSubstepSeconds: 0.25
});

function finitePoint(point) {
  return point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y));
}

export function regionActivityAnchors(state) {
  const anchors = activeOwnedBases(state).filter(finitePoint).map(base => ({ x: base.x, y: base.y }));
  if (finitePoint(state.player?.worldPosition)) {
    const player = state.player.worldPosition;
    if (!anchors.some(anchor => distance(anchor, player) < 1)) anchors.push(player);
  }
  return anchors;
}

export function regionActivityForAnchors(point, anchors = []) {
  if (!finitePoint(point) || anchors.length === 0) return REGION_ACTIVITY.ACTIVE;
  let nearestSquared = Infinity;
  for (const anchor of anchors) {
    const dx = Number(anchor.x) - Number(point.x);
    const dy = Number(anchor.y) - Number(point.y);
    nearestSquared = Math.min(nearestSquared, dx * dx + dy * dy);
  }
  if (nearestSquared <= REGION_ACTIVITY_CONFIG.activeRadiusMeters ** 2) return REGION_ACTIVITY.ACTIVE;
  if (nearestSquared <= REGION_ACTIVITY_CONFIG.peripheralRadiusMeters ** 2) return REGION_ACTIVITY.PERIPHERAL;
  return REGION_ACTIVITY.DORMANT;
}

export function regionActivityAtPoint(state, point) {
  return regionActivityForAnchors(point, regionActivityAnchors(state));
}

export function ensureRegionalSimulationState(state) {
  state.runtime.regionalSimulation ??= {};
  const value = state.runtime.regionalSimulation;
  value.peripheralAccumulator = Math.max(0, Number(value.peripheralAccumulator) || 0);
  value.dormantAccumulator = Math.max(0, Number(value.dormantAccumulator) || 0);
  return value;
}

function consumeInterval(value, interval) {
  const count = Math.floor((value + 1e-9) / interval);
  return {
    elapsed: count * interval,
    remainder: Math.max(0, value - count * interval)
  };
}

export function consumeRegionalSimulationTime(state, deltaSeconds) {
  const elapsed = Math.max(0, Number(deltaSeconds) || 0);
  const runtime = ensureRegionalSimulationState(state);
  runtime.peripheralAccumulator += elapsed;
  runtime.dormantAccumulator += elapsed;

  const peripheral = consumeInterval(runtime.peripheralAccumulator, REGION_ACTIVITY_CONFIG.peripheralIntervalSeconds);
  const dormant = consumeInterval(runtime.dormantAccumulator, REGION_ACTIVITY_CONFIG.dormantIntervalSeconds);
  runtime.peripheralAccumulator = peripheral.remainder;
  runtime.dormantAccumulator = dormant.remainder;

  return {
    active: elapsed,
    peripheral: peripheral.elapsed,
    dormant: dormant.elapsed
  };
}
