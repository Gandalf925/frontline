import { enemyPosition } from './enemy-system.js';
import { ENEMY_DEFINITIONS } from './definitions.js';

function cellKey(x, y, size) {
  return `${Math.floor(x / size)},${Math.floor(y / size)}`;
}

export function buildCombatSpatialIndex(state, cellSize = 48) {
  const cells = new Map();
  const entries = [];
  const positions = new Map();
  const commanders = [];
  const speedAuras = [];
  const shields = [];
  for (const enemy of state.combat.enemies ?? []) {
    if (enemy.hp <= 0 || enemy.departDelay > 0) continue;
    const position = enemyPosition(state, enemy);
    const entry = { enemy, position };
    entries.push(entry);
    positions.set(enemy.id, position);
    const key = cellKey(position.x, position.y, cellSize);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(entry);
    if (enemy.type === 'commander') commanders.push(entry);
    const definition = ENEMY_DEFINITIONS[enemy.type] ?? {};
    if ((definition.speedAura ?? definition.commanderAura ?? 0) > 0) speedAuras.push(entry);
    if ((definition.shieldAura ?? 0) > 0) shields.push(entry);
  }

  function query(point, range) {
    const result = [];
    const minX = Math.floor((point.x - range) / cellSize);
    const maxX = Math.floor((point.x + range) / cellSize);
    const minY = Math.floor((point.y - range) / cellSize);
    const maxY = Math.floor((point.y + range) / cellSize);
    const rangeSquared = range * range;
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        for (const entry of cells.get(`${x},${y}`) ?? []) {
          const dx = entry.position.x - point.x;
          const dy = entry.position.y - point.y;
          if (dx * dx + dy * dy <= rangeSquared) result.push(entry);
        }
      }
    }
    return result;
  }

  return { cellSize, cells, entries, positions, commanders, speedAuras, shields, query };
}
