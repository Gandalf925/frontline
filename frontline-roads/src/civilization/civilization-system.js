import { InventorySystem, ensureInventoryState } from './inventory-system.js';
import { ProductionSystem } from './production-system.js';
import { ProgressionSystem, createProgressState, ensureProject } from './progression-system.js';
import { SettlementSystem } from './settlement-system.js';
import { PlayerBaseSystem } from '../base/player-base-system.js';
import { FieldBaseSystem } from '../base/field-base-system.js';
import { ensureFriendlyForceState } from '../combat/friendly-force-system.js';
import { ensureRecoveryState } from '../exploration/recovery-system.js';
import { synchronizeDefenseTier } from './defense-upgrade.js';
import { MAX_CIVILIZATION_LEVEL } from './data.js';

export function ensureCivilizationState(state, { initializeInventory = false } = {}) {
  state.runtime ??= {};
  state.runtime.worldTimeMs ??= state.runtime.lastSavedAt || Date.now();
  state.civilization ??= {};
  state.civilization.level = Math.max(0, Math.min(MAX_CIVILIZATION_LEVEL, Number(state.civilization.level) || 0));
  state.civilization.project ??= null;
  state.civilization.buildings = Array.isArray(state.civilization.buildings)
    ? state.civilization.buildings.filter(building => !building.demolished && !building.ruined && Number(building.hp) > 0)
    : [];
  for (const building of state.civilization.buildings) {
    building.maxHp = Math.max(1, Number(building.maxHp) || 240);
    building.hp = Math.max(1, Math.min(building.maxHp, Number(building.hp) || building.maxHp));
    delete building.ruined;
    delete building.demolished;
    building.outputBuffer ??= {};
    building.history = { produced: 0, repairs: 0, ...(building.history ?? {}) };
  }
  const activeBuildingIds = new Set(state.civilization.buildings.map(building => building.id));
  state.civilization.productionQueues = Array.isArray(state.civilization.productionQueues)
    ? state.civilization.productionQueues.filter(queue => activeBuildingIds.has(queue.buildingId))
    : [];
  state.civilization.progress = { ...createProgressState(), ...(state.civilization.progress ?? {}) };
  state.civilization.progress.totalProduced ??= {};
  state.civilization.progress.bossesDefeated ??= {};
  state.civilization.progress.campsCapturedByType ??= {};
  state.civilization.progress.cityHpStreaks = { 50: 0, 60: 0, 70: 0, ...(state.civilization.progress.cityHpStreaks ?? {}) };
  state.civilization.progress.selfProducedSteel ??= 0;
  state.civilization.progress.selfProducedMechanism ??= 0;
  ensureInventoryState(state, { initialize: initializeInventory });
  ensureProject(state);
  state.combat ??= {};
  state.combat.defenses ??= [];
  ensureFriendlyForceState(state);
  ensureRecoveryState(state);
  for (const defense of state.combat.defenses) synchronizeDefenseTier(defense);
  delete state.world.outposts;
  state.world.baseRespawns ??= [];
  for (const respawn of state.world.baseRespawns) {
    respawn.remainingSec = Math.max(0, Number(respawn.remainingSec) || 0);
    respawn.attempts = Math.max(0, Number(respawn.attempts) || 0);
  }
  return state;
}

export class CivilizationSystem {
  constructor(events = null) {
    this.inventory = new InventorySystem();
    this.production = new ProductionSystem(events);
    this.progression = new ProgressionSystem(events);
    this.settlement = new SettlementSystem(events);
    this.playerBases = new PlayerBaseSystem(events);
    this.fieldBases = new FieldBaseSystem(events);
  }

  update(state, deltaSeconds) {
    this.inventory.update(state, deltaSeconds);
    this.settlement.processDamageQueue(state);
    this.production.update(state, deltaSeconds);
    this.progression.update(state, deltaSeconds);
  }
}
