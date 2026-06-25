import { DEFENSE_LINES, defenseLineForType } from './data.js';
import { RECOVERY_BALANCE } from '../core/recovery-balance.js';

export function defenseLine(defense) {
  if (defense.isGate) return 'gate';
  if (defense.kind === 'barrier') return 'barrier';
  return defenseLineForType(defense.type);
}

export function repairCostForDefense(defense, repairHp) {
  const line = defenseLine(defense);
  const definition = DEFENSE_LINES[line]?.[defense.tier ?? 0];
  const hasDedicatedRepair = Boolean(definition?.repair);
  const source = definition?.repair ?? definition?.cost ?? definition?.upgrade ?? {};
  const costMultiplier = hasDedicatedRepair ? 1 : RECOVERY_BALANCE.towerRepairCostMultiplier;
  const ratio = Math.max(0, repairHp) / Math.max(1, defense.maxHp ?? 1);
  return Object.fromEntries(
    Object.entries(source)
      .map(([resource, amount]) => [resource, Math.ceil(amount * ratio * costMultiplier)])
      .filter(([, amount]) => amount > 0)
  );
}
