const TAU = Math.PI * 2;

const EFFECT_DURATION = Object.freeze({
  shot: 260,
  explosion: 720,
  kill: 780,
  cityHit: 680,
  cityDefeated: 1500,
  defenseBuilt: 780,
  defenseRepaired: 720,
  defenseUpgraded: 920,
  defenseDestroyed: 1000,
  waveLaunched: 1200
});

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function easeOut(value) {
  return 1 - (1 - value) ** 3;
}

function ring(context, point, radius, color, alpha, width = 1.5, dashed = false, glowEnabled = true) {
  context.save();
  context.globalAlpha = alpha;
  context.strokeStyle = color;
  if (glowEnabled) {
    context.shadowColor = color;
    context.shadowBlur = 12;
  }
  context.lineWidth = width;
  if (dashed) context.setLineDash([4, 4]);
  context.beginPath();
  context.arc(point.x, point.y, Math.max(0, radius), 0, TAU);
  context.stroke();
  context.restore();
}

function cross(context, point, radius, color, alpha, glowEnabled = true) {
  context.save();
  context.globalAlpha = alpha;
  context.strokeStyle = color;
  if (glowEnabled) {
    context.shadowColor = color;
    context.shadowBlur = 10;
  }
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(point.x - radius, point.y - radius);
  context.lineTo(point.x + radius, point.y + radius);
  context.moveTo(point.x + radius, point.y - radius);
  context.lineTo(point.x - radius, point.y + radius);
  context.stroke();
  context.restore();
}

function objectPosition(state, payload) {
  const graph = state?.world?.roadGraph;
  if (!graph) return null;
  if (payload.position) return payload.position;
  if (payload.defenseId) {
    const defense = state.combat.defenses.find(item => item.id === payload.defenseId);
    if (!defense) return null;
    if (defense.kind === 'barrier') {
      const edge = graph.edgeById.get(defense.edgeId);
      const a = edge && graph.nodeById.get(edge.a);
      const b = edge && graph.nodeById.get(edge.b);
      return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
    }
    return graph.nodeById.get(defense.nodeId) ?? null;
  }
  if (payload.baseId) {
    const base = state.world.enemyBases.find(item => item.id === payload.baseId);
    return base ? graph.nodeById.get(base.nodeId) ?? null : null;
  }
  if (payload.city) return graph.nodeById.get(state.world.city?.nodeId) ?? null;
  return null;
}

export class CombatEffects {
  constructor({ maximum = 96, clock = nowMs } = {}) {
    this.maximum = maximum;
    this.clock = clock;
    this.effects = [];
    this.unsubscribers = [];
    this.stateProvider = null;
  }

  bind(events, stateProvider) {
    this.unbind();
    this.stateProvider = stateProvider;
    const register = (event, type, transform = payload => payload) => {
      this.unsubscribers.push(events.on(event, payload => this.add(type, transform(payload ?? {}))));
    };
    register('combat:shot', 'shot');
    register('combat:explosion', 'explosion');
    register('combat:enemy-killed', 'kill');
    register('combat:city-hit', 'cityHit', payload => ({ ...payload, city: true }));
    register('combat:city-defeated', 'cityDefeated', payload => ({ ...payload, city: true }));
    register('combat:defense-built', 'defenseBuilt', payload => ({ defenseId: payload.defense?.id }));
    register('combat:defense-repaired', 'defenseRepaired');
    register('combat:defense-upgraded', 'defenseUpgraded');
    register('combat:defense-destroyed', 'defenseDestroyed');
    register('combat:wave-launched', 'waveLaunched');
  }

  unbind() {
    for (const unsubscribe of this.unsubscribers) unsubscribe?.();
    this.unsubscribers = [];
  }

  add(type, payload = {}) {
    const duration = EFFECT_DURATION[type];
    if (!duration) return;
    this.effects.push({ type, payload, startedAt: this.clock(), duration });
    if (this.effects.length > this.maximum) this.effects.splice(0, this.effects.length - this.maximum);
  }

  active(timeMs = this.clock()) {
    this.effects = this.effects.filter(effect => timeMs - effect.startedAt <= effect.duration);
    return this.effects;
  }

  draw(context, camera, state, timeMs, width, height, preferences = {}) {
    const effects = this.active(timeMs);
    const quality = preferences.quality ?? 'balanced';
    const glowEnabled = quality === 'full';
    const maximumDrawn = quality === 'full' ? 96 : quality === 'balanced' ? 40 : 16;
    const visibleEffects = effects.slice(Math.max(0, effects.length - maximumDrawn));
    let screenAlert = 0;
    context.save();
    context.globalCompositeOperation = glowEnabled ? 'screen' : 'source-over';
    for (const effect of visibleEffects) {
      const critical = ['cityHit', 'cityDefeated', 'defenseDestroyed'].includes(effect.type);
      if (preferences.quality === 'minimal' && !critical) continue;
      const elapsed = Math.max(0, timeMs - effect.startedAt);
      const animated = preferences.motion !== false;
      const progress = animated ? Math.min(1, elapsed / effect.duration) : 0.42;
      const fade = animated ? 1 - progress : 0.72;
      const payload = effect.payload;

      if (effect.type === 'shot' && payload.from && payload.to) {
        const from = camera.worldToScreen(payload.from);
        const to = camera.worldToScreen(payload.to);
        const color = payload.type === 'slow' ? '#bb8cff' : '#65d7ff';
        const head = easeOut(progress);
        const x = from.x + (to.x - from.x) * head;
        const y = from.y + (to.y - from.y) * head;
        context.save();
        context.globalAlpha = fade;
        context.strokeStyle = color;
        if (glowEnabled) {
          context.shadowColor = color;
          context.shadowBlur = 12;
        }
        context.lineWidth = payload.type === 'slow' ? 2.2 : 1.4;
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.lineTo(x, y);
        context.stroke();
        context.restore();
        ring(context, { x, y }, 2.5 + progress * 4, color, fade, 1, false, glowEnabled);
        continue;
      }

      const world = objectPosition(state, payload);
      if (!world) continue;
      const point = camera.worldToScreen(world);

      if (effect.type === 'explosion') {
        const radius = (payload.radius ?? 28) * camera.scale * easeOut(progress);
        ring(context, point, radius, '#ffb35f', fade * 0.85, 2, false, glowEnabled);
        ring(context, point, radius * 0.58, '#ffe0a6', fade * 0.7, 1, false, glowEnabled);
      } else if (effect.type === 'kill') {
        ring(context, point, 5 + progress * 24, '#ff7588', fade * 0.8, 1.4, true, glowEnabled);
        cross(context, point, 3 + progress * 8, '#ff9aaa', fade * 0.75, glowEnabled);
      } else if (effect.type === 'cityHit') {
        screenAlert = Math.max(screenAlert, fade * 0.72);
        ring(context, point, 18 + progress * 42, '#ff5268', fade, 2, true, glowEnabled);
      } else if (effect.type === 'cityDefeated') {
        screenAlert = Math.max(screenAlert, fade);
        ring(context, point, 20 + progress * 90, '#ff284d', fade, 3, true, glowEnabled);
        ring(context, point, 12 + progress * 56, '#ff9aaa', fade * 0.8, 1.5, false, glowEnabled);
      } else if (effect.type === 'defenseBuilt') {
        ring(context, point, 7 + progress * 28, '#65ffd0', fade * 0.9, 1.4, false, glowEnabled);
      } else if (effect.type === 'defenseRepaired') {
        ring(context, point, 5 + progress * 22, '#8affdf', fade * 0.9, 1.2, true, glowEnabled);
      } else if (effect.type === 'defenseUpgraded') {
        ring(context, point, 7 + progress * 30, '#65d7ff', fade * 0.9, 1.5, false, glowEnabled);
        ring(context, point, 4 + progress * 19, '#bb8cff', fade * 0.72, 1, true, glowEnabled);
      } else if (effect.type === 'defenseDestroyed') {
        cross(context, point, 5 + progress * 16, '#ff5268', fade, glowEnabled);
        ring(context, point, 8 + progress * 28, '#ff5268', fade * 0.75, 1.4, true, glowEnabled);
      } else if (effect.type === 'waveLaunched') {
        ring(context, point, 9 + progress * 48, '#ff5268', fade * 0.85, 1.4, true, glowEnabled);
        ring(context, point, 5 + progress * 28, '#ff9f43', fade * 0.65, 1, false, glowEnabled);
      }
    }
    context.restore();

    if (screenAlert > 0) {
      context.save();
      const thickness = 10 + screenAlert * 16;
      context.strokeStyle = `rgba(255,42,78,${0.18 + screenAlert * 0.4})`;
      if (glowEnabled) {
        context.shadowColor = '#ff284d';
        context.shadowBlur = 25;
      }
      context.lineWidth = thickness;
      context.strokeRect(thickness / 2, thickness / 2, Math.max(0, width - thickness), Math.max(0, height - thickness));
      context.restore();
    }
  }

  clear() {
    this.effects = [];
  }

  destroy() {
    this.unbind();
    this.clear();
  }
}
