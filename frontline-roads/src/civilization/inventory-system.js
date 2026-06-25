import {
  BASE_RESOURCES, CIVILIZATIONS, INITIAL_RESOURCES, ORE_RESOURCES,
  PROCESSED_RESOURCES, RESOURCE_KEYS, RESOURCE_LABELS, SETTLEMENT_BUILDINGS,
  emptyResourceBundle
} from './data.js';

const METALS = new Set(['copperIngot', 'tinIngot', 'bronzeIngot', 'ironBloom', 'wroughtIron', 'steel', 'mechanism']);

export function resourceCategory(key) {
  if (BASE_RESOURCES.includes(key)) return 'base';
  if (ORE_RESOURCES.includes(key)) return 'ore';
  if (METALS.has(key)) return 'metal';
  if (PROCESSED_RESOURCES.includes(key)) return 'processed';
  return null;
}

export function normalizeBundle(bundle = {}) {
  const normalized = {};
  for (const key of RESOURCE_KEYS) {
    const amount = Math.max(0, Math.floor(Number(bundle[key]) || 0));
    if (amount > 0) normalized[key] = amount;
  }
  return normalized;
}

export function bundleText(bundle = {}) {
  const values = Object.entries(normalizeBundle(bundle));
  return values.length ? values.map(([key, value]) => `${RESOURCE_LABELS[key] ?? key} ${value}`).join('・') : 'なし';
}

export function currentCivilization(state) {
  return CIVILIZATIONS[state.civilization?.level ?? 0] ?? CIVILIZATIONS[0];
}

export function ensureInventoryState(state, { initialize = false } = {}) {
  state.inventory ??= {};
  state.inventory.resources ??= {};
  const resources = emptyResourceBundle();
  for (const key of RESOURCE_KEYS) resources[key] = Math.max(0, Math.floor(Number(state.inventory.resources[key]) || 0));
  if (initialize && RESOURCE_KEYS.every(key => resources[key] === 0)) Object.assign(resources, INITIAL_RESOURCES);
  state.inventory.resources = resources;
  state.inventory.overflow ??= {};
  state.inventory.capacity ??= {};
  state.inventory.lastOverflowSweepAt ??= state.runtime?.worldTimeMs ?? Date.now();
  recalculateCapacity(state);
  return state.inventory;
}

export function recalculateCapacity(state, timestamp = state.runtime?.worldTimeMs ?? Date.now()) {
  const base = { ...(currentCivilization(state).capacity ?? CIVILIZATIONS[0].capacity) };
  const counts = new Map();
  for (const building of state.civilization?.buildings ?? []) {
    const definition = SETTLEMENT_BUILDINGS[building.type];
    if (!definition?.capacityBonus) continue;
    const count = counts.get(building.type) ?? 0;
    counts.set(building.type, count + 1);
    const multiplier = count === 0 ? 1 : 0.5;
    for (const [category, amount] of Object.entries(definition.capacityBonus)) {
      base[category] = (base[category] ?? 0) + Math.floor(amount * multiplier);
    }
  }
  state.inventory.capacity = base;
  for (const key of RESOURCE_KEYS) {
    const capacity = base[resourceCategory(key)] ?? 0;
    const stored = state.inventory.resources[key] ?? 0;
    if (stored <= capacity) continue;
    const overflowAmount = stored - capacity;
    state.inventory.resources[key] = capacity;
    const overflow = state.inventory.overflow[key] ?? { amount: 0, expiresAt: timestamp + 86400000 };
    overflow.amount += overflowAmount;
    overflow.expiresAt = Math.max(overflow.expiresAt, timestamp + 86400000);
    state.inventory.overflow[key] = overflow;
  }
  restoreOverflow(state, timestamp);
  return base;
}

export function restoreOverflow(state, timestamp = state.runtime?.worldTimeMs ?? Date.now()) {
  for (const [key, overflow] of Object.entries(state.inventory.overflow ?? {})) {
    if (!overflow || overflow.amount <= 0 || overflow.expiresAt <= timestamp) {
      delete state.inventory.overflow[key];
      continue;
    }
    const capacity = state.inventory.capacity[resourceCategory(key)] ?? 0;
    const free = Math.max(0, capacity - (state.inventory.resources[key] ?? 0));
    const restored = Math.min(free, overflow.amount);
    state.inventory.resources[key] = (state.inventory.resources[key] ?? 0) + restored;
    overflow.amount -= restored;
    if (overflow.amount <= 0) delete state.inventory.overflow[key];
  }
  state.inventory.lastOverflowSweepAt = timestamp;
}

export function hasBundle(state, bundle) {
  return Object.entries(normalizeBundle(bundle)).every(([key, amount]) => (state.inventory.resources[key] ?? 0) >= amount);
}

export function missingBundle(state, bundle) {
  const missing = {};
  for (const [key, amount] of Object.entries(normalizeBundle(bundle))) {
    const gap = amount - (state.inventory.resources[key] ?? 0);
    if (gap > 0) missing[key] = gap;
  }
  return missing;
}

export function consumeBundle(state, bundle) {
  const normalized = normalizeBundle(bundle);
  if (!hasBundle(state, normalized)) return false;
  for (const [key, amount] of Object.entries(normalized)) state.inventory.resources[key] -= amount;
  return true;
}

export function addBundle(state, bundle, { timestamp = state.runtime?.worldTimeMs ?? Date.now() } = {}) {
  ensureInventoryState(state);
  const accepted = {};
  const overflowed = {};
  for (const [key, amount] of Object.entries(normalizeBundle(bundle))) {
    const category = resourceCategory(key);
    const capacity = state.inventory.capacity[category] ?? 0;
    const current = state.inventory.resources[key] ?? 0;
    const acceptedAmount = Math.min(amount, Math.max(0, capacity - current));
    const overflowAmount = amount - acceptedAmount;
    if (acceptedAmount > 0) {
      state.inventory.resources[key] = current + acceptedAmount;
      accepted[key] = acceptedAmount;
    }
    if (overflowAmount > 0) {
      const overflow = state.inventory.overflow[key] ?? { amount: 0, expiresAt: timestamp + 86400000 };
      overflow.amount += overflowAmount;
      overflow.expiresAt = Math.max(overflow.expiresAt, timestamp + 86400000);
      state.inventory.overflow[key] = overflow;
      overflowed[key] = overflowAmount;
    }
  }
  return { accepted, overflowed };
}

export class InventorySystem {
  update(state) {
    if (!state.inventory) return;
    const timestamp = state.runtime?.worldTimeMs ?? Date.now();
    if (timestamp - (state.inventory.lastOverflowSweepAt ?? 0) >= 10000) restoreOverflow(state, timestamp);
  }
}
