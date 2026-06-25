import { DefenseSystem } from './defense-system.js';
import { EnemySystem, enemyPosition } from './enemy-system.js';
import { WaveSystem } from './wave-system.js';
import { buildCombatSpatialIndex } from './combat-spatial-index.js';
import { FrontierSystem } from '../exploration/frontier-system.js';
import { ExplorationSystem } from '../exploration/exploration-system.js';
import { FriendlyForceSystem, friendlySquadPosition } from './friendly-force-system.js';
import { RecoverySystem } from '../exploration/recovery-system.js';
import { CITY_RECOVERY_DELAY_SECONDS, CITY_RECOVERY_HP_PER_SECOND } from './definitions.js';
import { applyCityDefeatRecovery, beginEnemyRegroup } from '../core/recovery-balance.js';
import {
  REGION_ACTIVITY,
  REGION_ACTIVITY_CONFIG,
  consumeRegionalSimulationTime,
  regionActivityAnchors,
  regionActivityForAnchors
} from './region-activity.js';

function defensePoint(state, defense) {
  const graph = state.world.roadGraph;
  if (defense.kind === 'tower') return graph.nodeById.get(defense.nodeId) ?? null;
  const edge = graph.edgeById.get(defense.edgeId);
  const a = edge && graph.nodeById.get(edge.a);
  const b = edge && graph.nodeById.get(edge.b);
  return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
}

function updateCityRecovery(state, deltaSeconds) {
  const city = state.world.city;
  if (!city || city.hp <= 0 || city.hp >= city.maxHp) return;
  const elapsed = Math.max(0, Number(deltaSeconds) || 0);
  const cooldown = Math.max(0, Number(state.combat.cityRecoveryCooldown) || 0);
  state.combat.cityRecoveryCooldown = Math.max(0, cooldown - elapsed);
  const recoverySeconds = Math.max(0, elapsed - cooldown);
  if (recoverySeconds <= 0) return;
  city.hp = Math.min(city.maxHp, city.hp + CITY_RECOVERY_HP_PER_SECOND * recoverySeconds);
}

function assignmentsForState(state, spatial) {
  const enemies = new Map();
  const defenses = new Map();
  const friendlySquads = new Map();
  const anchors = regionActivityAnchors(state);
  const counts = {
    [REGION_ACTIVITY.ACTIVE]: 0,
    [REGION_ACTIVITY.PERIPHERAL]: 0,
    [REGION_ACTIVITY.DORMANT]: 0
  };
  const assign = (collection, id, point) => {
    const activity = regionActivityForAnchors(point, anchors);
    collection.set(id, activity);
    counts[activity] += 1;
  };
  for (const enemy of state.combat.enemies) {
    assign(enemies, enemy.id, spatial.positions.get(enemy.id) ?? enemyPosition(state, enemy));
  }
  for (const squad of state.combat.friendlySquads ?? []) {
    assign(friendlySquads, squad.id, friendlySquadPosition(state, squad));
  }
  for (const defense of state.combat.defenses) {
    if (defense.kind !== 'tower') continue;
    assign(defenses, defense.id, defensePoint(state, defense));
  }
  return { enemies, defenses, friendlySquads, counts };
}

export class CombatSystem {
  constructor(events) {
    this.enemySystem = new EnemySystem(events);
    this.defenseSystem = new DefenseSystem(events);
    this.waveSystem = new WaveSystem(events);
    this.friendlyForceSystem = new FriendlyForceSystem(events);
    this.recoverySystem = new RecoverySystem(events);
    this.frontierSystem = new FrontierSystem(events);
    this.explorationSystem = new ExplorationSystem(events);
    this.events = events;
  }

  updateRegion(state, elapsedSeconds, activity, assignments, initialSpatial = null) {
    let remaining = Math.max(0, elapsedSeconds);
    let spatial = initialSpatial;
    while (remaining > 0.0001) {
      const step = Math.min(REGION_ACTIVITY_CONFIG.maximumSimulationSubstepSeconds, remaining);
      spatial ??= buildCombatSpatialIndex(state);
      this.defenseSystem.update(
        state,
        step,
        spatial,
        defense => assignments.defenses.get(defense.id) === activity
      );
      this.friendlyForceSystem.update(
        state,
        step,
        spatial,
        squad => assignments.friendlySquads.get(squad.id) === activity
      );
      this.enemySystem.update(
        state,
        step,
        spatial,
        enemy => assignments.enemies.get(enemy.id) === activity
      );
      remaining -= step;
      spatial = null;
    }
  }

  update(state, deltaSeconds) {
    updateCityRecovery(state, deltaSeconds);
    this.recoverySystem.update(state, deltaSeconds);
    this.explorationSystem.update(state, deltaSeconds);
    this.frontierSystem.update(state, deltaSeconds);
    this.waveSystem.update(state, deltaSeconds);

    const due = consumeRegionalSimulationTime(state, deltaSeconds);
    const spatial = buildCombatSpatialIndex(state);
    const assignments = assignmentsForState(state, spatial);
    if (due.active > 0 && assignments.counts[REGION_ACTIVITY.ACTIVE] > 0) {
      this.updateRegion(state, due.active, REGION_ACTIVITY.ACTIVE, assignments, spatial);
    }
    if (due.peripheral > 0 && assignments.counts[REGION_ACTIVITY.PERIPHERAL] > 0) {
      this.updateRegion(state, due.peripheral, REGION_ACTIVITY.PERIPHERAL, assignments);
    }
    if (due.dormant > 0 && assignments.counts[REGION_ACTIVITY.DORMANT] > 0) {
      this.updateRegion(state, due.dormant, REGION_ACTIVITY.DORMANT, assignments);
    }

    if (state.world.city.hp <= 0) {
      const opening = Math.max(0, Math.floor(Number(state.civilization?.level) || 0)) === 0;
      const recovery = applyCityDefeatRecovery(state, opening);
      state.world.city.hp = recovery.hp;
      state.combat.cityRecoveryCooldown = CITY_RECOVERY_DELAY_SECONDS;
      state.combat.enemies = [];
      state.combat.waves.active = {};
      for (const base of state.world.enemyBases ?? []) {
        if (base.alive) base.spawnClock = 0;
      }
      beginEnemyRegroup(state, recovery.regroupSeconds);
      state.civilization.progress.perfectWaveStreak = 0;
      this.events?.emit('combat:city-defeated', { recoveryCost: recovery.requested, paid: recovery.paid, fullyPaid: recovery.fullyPaid, recoveryReserve: recovery.reserve, openingProtection: opening });
      this.events?.emit('message', {
        text: recovery.fullyPaid
          ? opening
            ? '序盤防衛線が崩壊しました。応急再編成後、修理用資源を残して敵の再進軍を遅らせました。'
            : '都市防衛線が崩壊しました。緊急再編成後、修理用資源を確保して敵の再進軍を遅らせました。'
          : '都市防衛線が崩壊しました。備蓄を使い切らず、最低限の再編成と修理余力を確保しました。'
      });
    }
  }
}
