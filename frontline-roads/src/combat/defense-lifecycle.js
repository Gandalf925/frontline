export function detachDefense(state, defenseId) {
  const defenses = state.combat?.defenses ?? [];
  const index = defenses.findIndex(defense => defense.id === defenseId);
  if (index < 0) return null;

  const [defense] = defenses.splice(index, 1);
  for (const enemy of state.combat?.enemies ?? []) {
    if (enemy.targetDefenseId !== defense.id) continue;
    enemy.targetDefenseId = null;
    enemy.reroutePending = true;
  }
  return defense;
}
