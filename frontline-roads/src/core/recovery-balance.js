export const RECOVERY_BALANCE = Object.freeze({
  defenseBreakthroughRegroupSeconds: 150,
  cityDefeatRegroupSeconds: Object.freeze({ opening: 210, standard: 150 }),
  cityRecoveryHpRatio: Object.freeze({ opening: 0.6, standard: 0.5 }),
  cityDefeatCost: Object.freeze({ opening: Object.freeze({ wood: 10, stone: 6 }), standard: Object.freeze({ wood: 22, stone: 14 }) }),
  cityDefeatReserve: Object.freeze({ opening: Object.freeze({ wood: 50, stone: 40 }), standard: Object.freeze({ wood: 80, stone: 60 }) }),
  towerRepairCostMultiplier: 0.55
});

export function beginEnemyRegroup(state, seconds) {
  const now = Math.max(0, Number(state.runtime?.worldTimeMs) || 0);
  const until = now + Math.max(0, Number(seconds) || 0) * 1000;
  state.combat.enemyRegroupUntil = Math.max(Number(state.combat.enemyRegroupUntil) || 0, until);
  return state.combat.enemyRegroupUntil;
}

export function enemyRegroupActive(state) {
  return (Number(state.combat?.enemyRegroupUntil) || 0) > (Number(state.runtime?.worldTimeMs) || 0);
}

export function applyCityDefeatRecovery(state, opening) {
  const mode = opening ? 'opening' : 'standard';
  const ratio = RECOVERY_BALANCE.cityRecoveryHpRatio[mode];
  const hp = Math.max(1, Math.round(Math.max(1, Number(state.world.city?.maxHp) || 100) * ratio));
  const requested = RECOVERY_BALANCE.cityDefeatCost[mode];
  const reserve = RECOVERY_BALANCE.cityDefeatReserve[mode];
  const paid = {};
  for (const [resource, amount] of Object.entries(requested)) {
    const available = Math.max(0, Math.floor(Number(state.inventory?.resources?.[resource]) || 0));
    const protectedAmount = Math.max(0, Math.floor(Number(reserve[resource]) || 0));
    const taken = Math.min(Math.max(0, Math.floor(Number(amount) || 0)), Math.max(0, available - protectedAmount));
    if (taken > 0) {
      state.inventory.resources[resource] = available - taken;
      paid[resource] = taken;
    }
  }
  return { hp, requested, reserve, paid, fullyPaid: Object.entries(requested).every(([key, amount]) => (paid[key] || 0) >= amount), regroupSeconds: RECOVERY_BALANCE.cityDefeatRegroupSeconds[mode] };
}
