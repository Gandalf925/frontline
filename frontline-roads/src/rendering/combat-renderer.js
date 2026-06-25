import { clamp } from '../core/utilities.js';
import { edgeMidpoint } from '../combat/combat-geometry.js';
import { enemyPosition } from '../combat/enemy-system.js';
import { friendlySquadPosition } from '../combat/friendly-force-system.js';
import { friendlySquadDefinition } from '../combat/friendly-force-definitions.js';
import { recoveryItemPoint } from '../exploration/recovery-system.js';
import { defenseRuntimeDefinition } from '../combat/definitions.js';
import { sweepIntensity } from './radar-renderer.js';

const TAU = Math.PI * 2;

function glow(context, color, blur = 12, quality = 'full') {
  if (quality !== 'full') return;
  context.shadowColor = color;
  context.shadowBlur = blur;
}

function ring(context, point, radius, color, lineWidth = 1.5, alpha = 1, dashed = false) {
  context.save();
  context.globalAlpha = alpha;
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  if (dashed) context.setLineDash([3, 3]);
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, TAU);
  context.stroke();
  context.restore();
}

function polygon(context, point, radius, sides, rotation, fill, stroke, lineWidth = 1.5) {
  context.beginPath();
  for (let index = 0; index < sides; index += 1) {
    const angle = rotation + index * TAU / sides;
    const x = point.x + Math.cos(angle) * radius;
    const y = point.y + Math.sin(angle) * radius;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
  context.fillStyle = fill;
  context.fill();
  context.strokeStyle = stroke;
  context.lineWidth = lineWidth;
  context.stroke();
}

function drawHealthBar(context, point, value, maximum, width = 24, offset = 12, quality = 'balanced') {
  const ratio = clamp(value / Math.max(1, maximum), 0, 1);
  context.save();
  context.fillStyle = 'rgba(0, 10, 10, 0.86)';
  context.fillRect(point.x - width / 2 - 1, point.y + offset - 1, width + 2, 4);
  context.fillStyle = ratio < 0.3 ? '#ff5268' : ratio < 0.65 ? '#ffc857' : '#65ffd0';
  if (quality === 'full') {
    context.shadowColor = context.fillStyle;
    context.shadowBlur = 5;
  }
  context.fillRect(point.x - width / 2, point.y + offset, width * ratio, 2);
  context.restore();
}

function drawTicks(context, point, radius, color) {
  context.save();
  context.strokeStyle = color;
  context.lineWidth = 1.2;
  for (let index = 0; index < 4; index += 1) {
    const angle = index * Math.PI / 2;
    const inner = radius + 2;
    const outer = radius + 6;
    context.beginPath();
    context.moveTo(point.x + Math.cos(angle) * inner, point.y + Math.sin(angle) * inner);
    context.lineTo(point.x + Math.cos(angle) * outer, point.y + Math.sin(angle) * outer);
    context.stroke();
  }
  context.restore();
}

function drawEnemyBase(context, point, timeMs, quality) {
  const pulse = 14 + Math.sin(timeMs * 0.004) * 2;
  context.save();
  glow(context, '#ff4965', 18, quality);
  polygon(context, point, 10, 4, Math.PI / 4, 'rgba(255,73,101,0.22)', '#ff4965', 1.7);
  ring(context, point, pulse, '#ff6b7d', 1, 0.65, true);
  drawTicks(context, point, 12, '#ff6b7d');
  context.fillStyle = '#ffb3bd';
  context.font = '700 8px ui-monospace, monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('HOST', point.x, point.y + 0.5);
  context.restore();
}

function drawBarrier(context, point, angle, quality) {
  context.save();
  context.translate(point.x, point.y);
  context.rotate(angle);
  glow(context, '#ffc857', 9, quality);
  context.fillStyle = 'rgba(255,200,87,0.2)';
  context.strokeStyle = '#ffc857';
  context.lineWidth = 1.2;
  context.fillRect(-11, -4, 22, 8);
  context.strokeRect(-11, -4, 22, 8);
  context.beginPath();
  for (let x = -8; x <= 8; x += 4) {
    context.moveTo(x, -4);
    context.lineTo(x + 4, 4);
  }
  context.stroke();
  context.restore();
}


function drawGate(context, point, angle, quality) {
  context.save();
  context.translate(point.x, point.y);
  context.rotate(angle);
  glow(context, '#ffd978', 11, quality);
  context.strokeStyle = '#ffd978';
  context.fillStyle = 'rgba(255,217,120,0.18)';
  context.lineWidth = 1.8;
  context.fillRect(-12, -6, 24, 12);
  context.strokeRect(-12, -6, 24, 12);
  context.beginPath();
  context.moveTo(-8, -6); context.lineTo(-8, 6);
  context.moveTo(8, -6); context.lineTo(8, 6);
  context.moveTo(0, -6); context.lineTo(0, 6);
  context.stroke();
  context.restore();
}

function defenseColor(type) {
  if (type === 'mortar') return '#ffbc73';
  if (type === 'relay') return '#68ffd4';
  if (type === 'survey') return '#ffd166';
  if (type === 'medical') return '#ff8fb3';
  if (type === 'fieldBarracks') return '#91f0b5';
  if (type === 'slow') return '#bb8cff';
  return '#65d7ff';
}

function drawDefense(context, point, type, quality, icon = '?') {
  const color = defenseColor(type);
  context.save();
  glow(context, color, 11, quality);
  ring(context, point, 9.5, color, 1.3, 0.72);
  context.fillStyle = color;
  context.font = '800 11px ui-monospace, monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(icon, point.x, point.y + 0.5);
  context.restore();
}

function drawEnemyBlip(context, point, radius, slowed, intensity, timeMs, quality = 'balanced') {
  const color = slowed ? '#bd86ff' : '#ff4e69';
  const pulse = radius + 2.5 + Math.sin(timeMs * 0.008 + point.x * 0.02) * 1.4;
  context.save();
  context.globalAlpha = 0.68 + intensity * 0.32;
  glow(context, color, 7 + intensity * 9, quality);
  context.fillStyle = color;
  context.beginPath();
  context.arc(point.x, point.y, Math.max(2.4, radius * 0.56), 0, TAU);
  context.fill();
  if (quality !== 'minimal') ring(context, point, pulse, color, 1, 0.24 + intensity * 0.46);
  context.restore();
}


function drawEnemyBlipBatch(context, entries, timeMs, quality) {
  if (!entries.length) return;
  const dense = entries.length > 180;
  const normal = [];
  const slowed = [];
  for (const entry of entries) (entry.enemy.slowTimer > 0 ? slowed : normal).push(entry);
  const pulseOffset = Math.sin(timeMs * 0.008) * 0.9;
  const drawGroup = (group, color) => {
    if (!group.length) return;
    context.save();
    context.globalAlpha = quality === 'minimal' ? 0.78 : 0.84;
    context.fillStyle = color;
    context.beginPath();
    for (const entry of group) {
      const radius = Math.max(2.2, (entry.enemy.radius ?? 5) * 0.52);
      context.moveTo(entry.point.x + radius, entry.point.y);
      context.arc(entry.point.x, entry.point.y, radius, 0, TAU);
    }
    context.fill();
    if (quality === 'balanced' && !dense) {
      context.globalAlpha = 0.28;
      context.strokeStyle = color;
      context.lineWidth = 1;
      context.beginPath();
      for (const entry of group) {
        const radius = Math.max(4.4, (entry.enemy.radius ?? 5) + 2.1 + pulseOffset);
        context.moveTo(entry.point.x + radius, entry.point.y);
        context.arc(entry.point.x, entry.point.y, radius, 0, TAU);
      }
      context.stroke();
    }
    context.restore();
  };
  drawGroup(normal, '#ff4e69');
  drawGroup(slowed, '#bd86ff');
}


function drawFriendlySquad(context, point, status, type, timeMs, quality) {
  const definition = friendlySquadDefinition(type);
  const baseColors = { assault: '#65d7ff', skirmisher: '#62ffd2', siege: '#ffbd70', heavy: '#b9a4ff', expedition: '#f4f59a', retrieval: '#ffffff' };
  const baseColor = baseColors[definition.type] ?? '#65d7ff';
  const color = status === 'ENGAGED' || status === 'ATTACKING_BASE' ? '#fff3a1' : baseColor;
  const sides = definition.type === 'skirmisher' ? 3 : definition.type === 'heavy' ? 6 : definition.type === 'siege' ? 5 : definition.type === 'retrieval' ? 8 : 4;
  const pulse = 10 + Math.sin(timeMs * 0.006) * 1.2;
  context.save();
  glow(context, color, 13, quality);
  polygon(context, point, 6.5, sides, Math.PI / 4, 'rgba(101,215,255,0.2)', color, 1.5);
  ring(context, point, pulse, color, 1, 0.52, true);
  context.fillStyle = color;
  context.font = '800 7px ui-monospace, monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(definition.shortLabel, point.x, point.y + 0.5);
  context.restore();
}

function drawCity(context, point, timeMs, quality) {
  const pulse = 17 + Math.sin(timeMs * 0.0035) * 1.5;
  context.save();
  glow(context, '#8affdf', 18, quality);
  ring(context, point, pulse, '#8affdf', 1.4, 0.5, true);
  ring(context, point, 12.5, '#d5fff4', 2, 0.95);
  ring(context, point, 7.5, '#65ffd0', 1.2, 0.9);
  drawTicks(context, point, 13, '#9effe4');
  context.fillStyle = '#dffff7';
  context.font = '800 8px ui-monospace, monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('HQ', point.x, point.y + 0.4);
  context.restore();
}


function drawFieldBase(context, point, active, timeMs, quality) {
  const color = active ? '#65d7ff' : '#7c8b91';
  const pulse = 11 + Math.sin(timeMs * 0.0038) * 1.1;
  context.save();
  glow(context, color, active ? 10 : 2, quality);
  polygon(context, point, 7, 4, Math.PI / 4, active ? 'rgba(101,215,255,0.14)' : 'rgba(100,112,118,0.16)', color, 1.3);
  ring(context, point, pulse, color, 1, active ? 0.42 : 0.24, true);
  context.fillStyle = color;
  context.font = '800 7px ui-monospace, monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(active ? 'FIELD' : 'RUIN', point.x, point.y + 0.4);
  context.restore();
}

function drawPlayerBase(context, point, timeMs, quality) {
  const pulse = 13 + Math.sin(timeMs * 0.0035) * 1.2;
  context.save();
  glow(context, '#65d7ff', 14, quality);
  polygon(context, point, 8.5, 6, Math.PI / 6, 'rgba(101,215,255,0.16)', '#65d7ff', 1.5);
  ring(context, point, pulse, '#65d7ff', 1, 0.45, true);
  context.fillStyle = '#d9f6ff';
  context.font = '800 7px ui-monospace, monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('BASE', point.x, point.y + 0.4);
  context.restore();
}


function visiblePoint(point, camera, margin = 28) {
  return point.x >= -margin && point.y >= -margin && point.x <= camera.viewportWidth + margin && point.y <= camera.viewportHeight + margin;
}

function shouldDrawHealth(value, maximum, quality) {
  const ratio = value / Math.max(1, maximum);
  if (quality === 'full') return ratio < 1;
  if (quality === 'balanced') return ratio < 0.8;
  return ratio < 0.5;
}


function drawRecoveryItem(context, point, timeMs, quality) {
  const pulse = 11 + Math.sin(timeMs * 0.005) * 1.5;
  context.save();
  glow(context, '#ffd166', 16, quality);
  polygon(context, point, 6, 4, Math.PI / 4, 'rgba(255,209,102,0.2)', '#ffd166', 1.5);
  ring(context, point, pulse, '#ffd166', 1, 0.55, true);
  context.fillStyle = '#fff1bf';
  context.font = '800 7px ui-monospace, monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('ITEM', point.x, point.y + 0.5);
  context.restore();
}

function drawPlayer(context, point, quality) {
  context.save();
  glow(context, '#f1fff9', 12, quality);
  polygon(context, point, 6.5, 3, -Math.PI / 2, 'rgba(241,255,249,0.18)', '#f1fff9', 1.5);
  ring(context, point, 10, '#65ffd0', 1, 0.5);
  context.restore();
}

export function drawCombatState(context, state, camera, radar = {}) {
  if (!state?.world?.city || !state.world.roadGraph?.nodeById) return;
  const graph = state.world.roadGraph;
  const timeMs = radar.timeMs ?? 0;
  const quality = radar.preferences?.quality ?? 'balanced';

  for (const base of state.world.enemyBases ?? []) {
    if (!base.alive) continue;
    const node = graph.nodeById.get(base.nodeId);
    if (!node) continue;
    const point = camera.worldToScreen(node);
    if (visiblePoint(point, camera)) {
      drawEnemyBase(context, point, timeMs, quality);
      if (shouldDrawHealth(base.hp, base.maxHp, quality)) drawHealthBar(context, point, base.hp, base.maxHp, 26, 15, quality);
    }
  }



  for (const defense of state.combat.defenses ?? []) {
    const runtime = defenseRuntimeDefinition(defense);
    if (defense.hp <= 0) continue;
    if (defense.kind === 'barrier') {
      const middle = edgeMidpoint(graph, defense.edgeId);
      if (!middle) continue;
      const point = camera.worldToScreen(middle);
      const edge = graph.edgeById.get(defense.edgeId);
      const a = edge && graph.nodeById.get(edge.a);
      const b = edge && graph.nodeById.get(edge.b);
      if (!a || !b || !visiblePoint(point, camera)) continue;
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      if (defense.isGate) drawGate(context, point, angle, quality);
      else drawBarrier(context, point, angle, quality);
      if (shouldDrawHealth(defense.hp, defense.maxHp, quality)) drawHealthBar(context, point, defense.hp, defense.maxHp, 22, 9, quality);
      continue;
    }
    const node = graph.nodeById.get(defense.nodeId);
    if (!node) continue;
    const point = camera.worldToScreen(node);
    if (!visiblePoint(point, camera)) continue;
    drawDefense(context, point, defense.type, quality, runtime.icon ?? '?');
    if (shouldDrawHealth(defense.hp, defense.maxHp, quality)) drawHealthBar(context, point, defense.hp, defense.maxHp, 20, 11, quality);
  }

  for (const item of state.world.recoveryItems ?? []) {
    if (item.status !== 'AVAILABLE') continue;
    const itemPosition = recoveryItemPoint(state, item);
    const point = camera.worldToScreen(itemPosition);
    if (visiblePoint(point, camera, 24)) drawRecoveryItem(context, point, timeMs, quality);
  }

  for (const squad of state.combat.friendlySquads ?? []) {
    if (squad.hp <= 0) continue;
    const point = camera.worldToScreen(friendlySquadPosition(state, squad));
    if (!visiblePoint(point, camera, 24)) continue;
    drawFriendlySquad(context, point, squad.status, squad.type, timeMs, quality);
    if (shouldDrawHealth(squad.hp, squad.maxHp, quality)) drawHealthBar(context, point, squad.hp, squad.maxHp, 22, 10, quality);
  }

  const edgeCounts = new Map();
  const edgeEnemyIndices = new Map();
  const edgeNormals = new Map();
  const visibleEnemies = [];
  for (const enemy of state.combat.enemies ?? []) {
    if (enemy.hp <= 0 || enemy.departDelay > 0) continue;
    if (enemy.edgeId) edgeCounts.set(enemy.edgeId, (edgeCounts.get(enemy.edgeId) ?? 0) + 1);
    const position = enemyPosition(state, enemy);
    let renderPosition = position;
    if (enemy.edgeId) {
      const edge = graph.edgeById.get(enemy.edgeId);
      if (edge) {
        let normal = edgeNormals.get(edge.id);
        if (!normal) {
          const a = graph.nodeById.get(edge.a);
          const b = graph.nodeById.get(edge.b);
          if (a && b) {
            const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
            edgeNormals.set(edge.id, normal);
          }
        }
        if (normal) {
          const index = edgeEnemyIndices.get(enemy.edgeId) ?? 0;
          edgeEnemyIndices.set(enemy.edgeId, index + 1);
          const lane = ((index % 7) - 3) * 2.15;
          renderPosition = { x: position.x + normal.x * lane, y: position.y + normal.y * lane };
        }
      }
    }
    const point = camera.worldToScreen(renderPosition);
    if (visiblePoint(point, camera, 20)) visibleEnemies.push({ enemy, point });
  }

  if (quality !== 'minimal') {
    context.save();
    context.lineCap = 'round';
    context.globalCompositeOperation = quality === 'full' ? 'screen' : 'source-over';
    for (const [edgeId, count] of edgeCounts) {
      const edge = graph.edgeById.get(edgeId);
      if (!edge) continue;
      const aNode = graph.nodeById.get(edge.a);
      const bNode = graph.nodeById.get(edge.b);
      if (!aNode || !bNode) continue;
      const a = camera.worldToScreen(aNode);
      const b = camera.worldToScreen(bNode);
      if ((a.x < -20 && b.x < -20) || (a.y < -20 && b.y < -20) || (a.x > camera.viewportWidth + 20 && b.x > camera.viewportWidth + 20) || (a.y > camera.viewportHeight + 20 && b.y > camera.viewportHeight + 20)) continue;
      context.strokeStyle = `rgba(255,67,91,${Math.min(0.34, 0.05 + count * 0.012)})`;
      if (quality === 'full') { context.shadowColor = '#ff435b'; context.shadowBlur = Math.min(12, 3 + count * 0.4); }
      context.lineWidth = Math.min(12, 1.5 + count * 0.48);
      context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
    }
    context.restore();
  }

  if (quality === 'full') {
    for (const entry of visibleEnemies) {
      const intensity = radar.center ? sweepIntensity(entry.point, radar.center, radar.sweepAngle ?? 0) : 0;
      drawEnemyBlip(context, entry.point, entry.enemy.radius ?? 5, entry.enemy.slowTimer > 0, intensity, timeMs, quality);
    }
  } else {
    drawEnemyBlipBatch(context, visibleEnemies, timeMs, quality);
  }

  if (quality === 'full') {
    for (const entry of visibleEnemies) {
      if (shouldDrawHealth(entry.enemy.hp, entry.enemy.maxHp, quality)) {
        drawHealthBar(context, entry.point, entry.enemy.hp, entry.enemy.maxHp, 16, 8, quality);
      }
    }
  } else if (quality === 'balanced') {
    const healthLimit = visibleEnemies.length > 180 ? 12 : 20;
    const damaged = [];
    for (const entry of visibleEnemies) {
      if (!shouldDrawHealth(entry.enemy.hp, entry.enemy.maxHp, quality)) continue;
      const ratio = entry.enemy.hp / Math.max(1, entry.enemy.maxHp);
      let insertAt = damaged.findIndex(item => ratio < item.ratio);
      if (insertAt < 0) insertAt = damaged.length;
      if (insertAt < healthLimit) damaged.splice(insertAt, 0, { entry, ratio });
      if (damaged.length > healthLimit) damaged.pop();
    }
    for (const item of damaged) {
      const entry = item.entry;
      drawHealthBar(context, entry.point, entry.enemy.hp, entry.enemy.maxHp, 16, 8, quality);
    }
  }

  for (const base of state.world.playerBases ?? []) {
    if (base.primary) continue;
    const node = graph.nodeById.get(base.nodeId) ?? base;
    const point = camera.worldToScreen(node);
    if (!visiblePoint(point, camera, 32)) continue;
    const active = base.status === 'ESTABLISHED' && base.hp > 0;
    if (active) drawPlayerBase(context, point, timeMs, quality);
    else drawFieldBase(context, point, false, timeMs, quality);
    if (active && shouldDrawHealth(base.hp, base.maxHp, quality)) drawHealthBar(context, point, base.hp, base.maxHp, 24, 14, quality);
  }

  for (const base of state.world.fieldBases ?? []) {
    const node = graph.nodeById.get(base.nodeId) ?? base;
    const point = camera.worldToScreen(node);
    if (!visiblePoint(point, camera, 28)) continue;
    const active = base.status === 'ESTABLISHED' && base.hp > 0;
    drawFieldBase(context, point, active, timeMs, quality);
    if (active && shouldDrawHealth(base.hp, base.maxHp, quality)) drawHealthBar(context, point, base.hp, base.maxHp, 20, 12, quality);
  }

  const cityNode = graph.nodeById.get(state.world.city.nodeId);
  if (cityNode) {
    const point = camera.worldToScreen(cityNode);
    if (visiblePoint(point, camera, 40)) {
      drawCity(context, point, timeMs, quality);
      if (shouldDrawHealth(state.world.city.hp, state.world.city.maxHp, quality)) drawHealthBar(context, point, state.world.city.hp, state.world.city.maxHp, 30, 17, quality);
    }
  }

  if (state.player.worldPosition) { const point = camera.worldToScreen(state.player.worldPosition); if (visiblePoint(point, camera)) drawPlayer(context, point, quality); }
}
