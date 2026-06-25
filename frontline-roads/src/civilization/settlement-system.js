import { stableId } from '../core/utilities.js';
import { CIVILIZATIONS, SETTLEMENT_BUILDINGS } from './data.js';
import { addBundle, consumeBundle, missingBundle, recalculateCapacity } from './inventory-system.js';

export function usedSettlementSlots(state) {
  return (state.civilization.buildings ?? []).length;
}

export function settlementSlotLimit(state) {
  return CIVILIZATIONS[state.civilization.level ?? 0]?.slots ?? CIVILIZATIONS[0].slots;
}

export function isBuildingUnlocked(state, type) {
  const definition = SETTLEMENT_BUILDINGS[type];
  return Boolean(definition && (state.civilization.level ?? 0) >= definition.level);
}

function deterministicBuildingIndex(seed, length) {
  let hash = 2166136261;
  for (const character of String(seed)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return length ? (hash >>> 0) % length : 0;
}

function removeBuilding(state, buildingId) {
  const index = state.civilization.buildings.findIndex(building => building.id === buildingId);
  if (index < 0) return null;
  const [building] = state.civilization.buildings.splice(index, 1);
  state.civilization.productionQueues = state.civilization.productionQueues.filter(queue => queue.buildingId !== building.id);
  return building;
}

export class SettlementSystem {
  constructor(events = null) {
    this.events = events;
  }

  build(state, type) {
    const definition = SETTLEMENT_BUILDINGS[type];
    if (!definition) return { ok: false, reason: '不明な施設です。' };
    if (!isBuildingUnlocked(state, type)) return { ok: false, reason: '文明レベルが不足しています。' };
    if (usedSettlementSlots(state) >= settlementSlotLimit(state)) return { ok: false, reason: '集落の建設枠がありません。' };
    const existing = state.civilization.buildings.filter(building => building.type === type).length;
    if (definition.limit && existing >= definition.limit) return { ok: false, reason: 'この施設はこれ以上建設できません。' };
    if (!consumeBundle(state, definition.cost)) return { ok: false, reason: '資源が不足しています。', missing: missingBundle(state, definition.cost) };
    const building = {
      id: stableId('building', type, state.runtime?.worldTimeMs ?? Date.now(), state.civilization.buildings.length),
      type,
      hp: 240,
      maxHp: 240,
      outputBuffer: {},
      history: { produced: 0, repairs: 0 },
      createdAt: state.runtime?.worldTimeMs ?? Date.now()
    };
    state.civilization.buildings.push(building);
    recalculateCapacity(state);
    this.events?.emit('civilization:building-built', { building });
    return { ok: true, building };
  }

  repair(state, buildingId) {
    const building = state.civilization.buildings.find(item => item.id === buildingId);
    if (!building) return { ok: false, reason: '施設が見つかりません。' };
    const missingHp = Math.max(0, building.maxHp - building.hp);
    if (missingHp <= 0) return { ok: false, reason: '修理は不要です。' };
    const definition = SETTLEMENT_BUILDINGS[building.type];
    const ratio = missingHp / building.maxHp;
    const cost = Object.fromEntries(Object.entries(definition.cost).map(([key, value]) => [key, Math.max(1, Math.ceil(value * 0.25 * ratio))]));
    if (!consumeBundle(state, cost)) return { ok: false, reason: '修理資源が不足しています。', missing: missingBundle(state, cost) };
    building.hp = building.maxHp;
    building.history.repairs += missingHp;
    state.civilization.progress.totalRepairHpPaid += missingHp;
    recalculateCapacity(state);
    this.events?.emit('civilization:building-repaired', { building, cost });
    return { ok: true, cost };
  }

  demolish(state, buildingId) {
    const building = state.civilization.buildings.find(item => item.id === buildingId);
    if (!building) return { ok: false, reason: '施設が見つかりません。' };
    const definition = SETTLEMENT_BUILDINGS[building.type];
    removeBuilding(state, building.id);
    const refund = Object.fromEntries(
      Object.entries(definition?.cost ?? {})
        .map(([key, value]) => [key, Math.floor(value * 0.3)])
        .filter(([, value]) => value > 0)
    );
    addBundle(state, refund);
    recalculateCapacity(state);
    this.events?.emit('civilization:building-demolished', { building, refund });
    return { ok: true, refund };
  }

  processDamageQueue(state) {
    const queue = state.combat.pendingSettlementDamage ?? [];
    state.combat.pendingSettlementDamage = [];
    for (const incident of queue) {
      const candidates = state.civilization.buildings.filter(building => building.hp > 0);
      if (!candidates.length) continue;
      const target = candidates[deterministicBuildingIndex(incident.enemyId ?? incident.enemyType, candidates.length)];
      target.hp = Math.max(0, target.hp - Math.max(0, Number(incident.damage) || 0));
      if (target.hp > 0) continue;
      const destroyed = removeBuilding(state, target.id) ?? target;
      recalculateCapacity(state);
      this.events?.emit('civilization:building-destroyed', { building: destroyed, incident });
      this.events?.emit('message', { text: `${SETTLEMENT_BUILDINGS[destroyed.type]?.name ?? '集落施設'}が破壊され、建設枠から撤去されました。` });
    }
  }
}
