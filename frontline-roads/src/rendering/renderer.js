import { performanceProfile } from '../app/performance-profile.js';
import { drawRoadGraph } from './road-renderer.js';
import { drawCombatState } from './combat-renderer.js';
import {
  drawRadarStaticBackdrop, drawRadarSweep, drawRadarStaticOverlay,
  radarCenter, radarSweepAngle
} from './radar-renderer.js';
import { drawThreatRoutes, drawTacticalFocus } from './tactical-overlay.js';
import { drawBuildPlacement } from './build-placement-overlay.js';
import { drawFriendlyOrderPlanning } from './friendly-order-overlay.js';
import { CombatEffects } from './combat-effects.js';
import { drawFrontierSignals } from './frontier-renderer.js';
import { drawExplorationSites } from './exploration-renderer.js';

const ACTIVE_GAME_STATES = new Set(['PLAYING', 'PAUSED']);

function createLayer(canvas) {
  const documentRef = canvas.ownerDocument ?? globalThis.document;
  if (documentRef?.createElement) return documentRef.createElement('canvas');
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(1, 1);
  return null;
}

function configureLayer(layer, width, height, dpr) {
  if (!layer) return null;
  layer.width = Math.max(1, Math.round(width * dpr));
  layer.height = Math.max(1, Math.round(height * dpr));
  const context = layer.getContext?.('2d');
  context?.setTransform?.(dpr, 0, 0, dpr, 0, 0);
  return context;
}

export class Renderer {
  constructor(canvas, camera) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.camera = camera;
    this.graph = null;
    this.selection = null;
    this.homeBase = null;
    this.stateProvider = null;
    this.focus = null;
    this.buildPlacement = null;
    this.friendlyOrderPlanning = null;
    this.effects = new CombatEffects();
    this.preferences = { quality: 'balanced', motion: true, routes: 'priority' };
    this.cssWidth = 1;
    this.cssHeight = 1;
    this.dpr = 1;
    this.staticDirty = true;
    this.staticSignature = '';
    this.backgroundLayer = createLayer(canvas);
    this.combatLayer = createLayer(canvas);
    this.overlayLayer = createLayer(canvas);
    this.backgroundContext = null;
    this.combatContext = null;
    this.overlayContext = null;
    this.combatDirty = true;
    this.combatSignature = '';
    this.lastAmbientFrame = 0;
    this.ambientFrameId = null;
    this.resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.resize()) : null;
    this.resizeObserver?.observe(canvas);
    this.boundWindowResize = () => this.resize();
    if (!this.resizeObserver) globalThis.addEventListener?.('resize', this.boundWindowResize);
    this.boundAmbientFrame = timestamp => this.animateAmbient(timestamp);
    this.resize();
    this.ambientFrameId = globalThis.requestAnimationFrame?.(this.boundAmbientFrame) ?? null;
  }

  getPerformanceProfile() {
    return performanceProfile(this.preferences.quality);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.cssWidth = Math.max(1, rect.width);
    this.cssHeight = Math.max(1, rect.height);
    const profile = this.getPerformanceProfile();
    this.dpr = Math.min(globalThis.devicePixelRatio || 1, profile.maxDpr);
    this.canvas.width = Math.max(1, Math.round(this.cssWidth * this.dpr));
    this.canvas.height = Math.max(1, Math.round(this.cssHeight * this.dpr));
    this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.backgroundContext = configureLayer(this.backgroundLayer, this.cssWidth, this.cssHeight, this.dpr);
    this.combatContext = configureLayer(this.combatLayer, this.cssWidth, this.cssHeight, this.dpr);
    this.overlayContext = configureLayer(this.overlayLayer, this.cssWidth, this.cssHeight, this.dpr);
    this.camera.setViewport(this.cssWidth, this.cssHeight);
    this.invalidateStatic();
    this.render();
  }

  invalidateStatic() {
    this.staticDirty = true;
    this.combatDirty = true;
  }

  invalidateCombat() {
    this.combatDirty = true;
  }

  animateAmbient(timestamp) {
    const lifecycle = this.stateProvider?.()?.lifecycle;
    const profile = this.getPerformanceProfile();
    const interval = 1000 / Math.min(profile.renderHz, 30);
    if (!ACTIVE_GAME_STATES.has(lifecycle) && this.preferences.motion && timestamp - this.lastAmbientFrame >= interval) {
      this.lastAmbientFrame = timestamp;
      this.render(timestamp);
    }
    this.ambientFrameId = globalThis.requestAnimationFrame?.(this.boundAmbientFrame) ?? null;
  }

  setGraph(graph) { this.graph = graph; this.invalidateStatic(); }
  setSelection(selection) { this.selection = selection; this.invalidateStatic(); }
  setHomeBase(homeBase) { this.homeBase = homeBase; this.invalidateStatic(); }
  setStateProvider(provider) { this.stateProvider = provider; }

  setPreferences(preferences) {
    const previousQuality = this.preferences.quality;
    this.preferences = { ...this.preferences, ...preferences };
    if (previousQuality !== this.preferences.quality) this.resize();
    else { this.invalidateStatic(); this.render(); }
  }

  bindEvents(events) { this.effects.bind(events, () => this.stateProvider?.()); }
  setFocus(focus) { this.focus = focus; this.render(); }
  setBuildPlacement(placement) { this.buildPlacement = placement; this.render(); }
  setFriendlyOrderPlanning(planning) { this.friendlyOrderPlanning = planning; this.render(); }

  centerOn(point, minimumScale = 0.75) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    this.camera.x = point.x;
    this.camera.y = point.y;
    this.camera.scale = Math.max(this.camera.scale, minimumScale);
    this.invalidateStatic();
    this.render();
  }

  fitGraph() {
    if (!this.graph?.nodes?.length) return;
    const xs = this.graph.nodes.map(node => node.x);
    const ys = this.graph.nodes.map(node => node.y);
    this.camera.fitBounds({ minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }, 36);
    this.invalidateStatic();
    this.render();
  }

  staticLayerSignature(center, scenePreferences = this.preferences) {
    return [
      this.cssWidth, this.cssHeight, this.dpr, scenePreferences.quality, scenePreferences.sceneMode ?? 'default',
      this.camera.x.toFixed(3), this.camera.y.toFixed(3), this.camera.scale.toFixed(5),
      center.x.toFixed(2), center.y.toFixed(2), this.selection?.edgeId ?? '',
      this.graph?.nodes?.length ?? 0, this.graph?.edges?.length ?? 0
    ].join('|');
  }

  rebuildStaticLayers(center, timeMs, scenePreferences = this.preferences) {
    const signature = this.staticLayerSignature(center, scenePreferences);
    if (!this.staticDirty && signature === this.staticSignature) return;
    this.staticSignature = signature;
    this.staticDirty = false;

    if (this.backgroundContext) {
      this.backgroundContext.clearRect(0, 0, this.cssWidth, this.cssHeight);
      drawRadarStaticBackdrop(this.backgroundContext, this.cssWidth, this.cssHeight, center, scenePreferences);
      if (this.graph) {
        drawRoadGraph(this.backgroundContext, this.graph, this.camera, {
          selectedEdgeId: this.selection?.edgeId ?? null,
          timeMs,
          preferences: scenePreferences
        });
      }
    }
    if (this.overlayContext) {
      this.overlayContext.clearRect(0, 0, this.cssWidth, this.cssHeight);
      drawRadarStaticOverlay(this.overlayContext, this.cssWidth, this.cssHeight, scenePreferences);
    }
  }

  combatLayerSignature(state, visualTime, scenePreferences = this.preferences) {
    const animatedKey = scenePreferences.quality === 'full' || state?.lifecycle === 'PAUSED'
      ? Math.floor(Number(visualTime) / 50)
      : 0;
    return [
      this.cssWidth, this.cssHeight, this.dpr, scenePreferences.quality,
      this.camera.x.toFixed(3), this.camera.y.toFixed(3), this.camera.scale.toFixed(5),
      state?.runtime?.worldTimeMs ?? 0, state?.runtime?.updatedAt ?? 0, animatedKey,
      state?.combat?.enemies?.length ?? 0, state?.combat?.defenses?.length ?? 0,
      state?.combat?.friendlySquads?.length ?? 0, state?.world?.recoveryItems?.length ?? 0,
      state?.world?.enemyBases?.length ?? 0, state?.world?.playerBases?.length ?? 0,
      state?.world?.fieldBases?.length ?? 0
    ].join('|');
  }

  rebuildCombatLayer(state, center, sweepAngle, visualTime, scenePreferences = this.preferences) {
    if (!this.combatContext) return false;
    const signature = this.combatLayerSignature(state, visualTime, scenePreferences);
    if (!this.combatDirty && signature === this.combatSignature) return true;
    this.combatSignature = signature;
    this.combatDirty = false;
    this.combatContext.clearRect(0, 0, this.cssWidth, this.cssHeight);
    drawCombatState(this.combatContext, state, this.camera, {
      center,
      sweepAngle,
      timeMs: visualTime,
      preferences: scenePreferences
    });
    return true;
  }

  drawCachedLayer(layer) {
    if (!layer) return false;
    this.context.drawImage(layer, 0, 0, layer.width, layer.height, 0, 0, this.cssWidth, this.cssHeight);
    return true;
  }

  scenePreferences(state) {
    if (state?.lifecycle === 'BASE_SELECTION') return { ...this.preferences, sceneMode: 'base-selection', motion: false };
    return { ...this.preferences, sceneMode: 'combat' };
  }

  render(timeMs = globalThis.performance?.now?.() ?? Date.now()) {
    const state = this.stateProvider?.();
    const anchor = state?.world?.city
      ? state.world.roadGraph?.nodeById?.get(state.world.city.nodeId)
      : this.selection?.point ?? this.homeBase;
    const center = radarCenter(this.camera, anchor);
    const scenePreferences = this.scenePreferences(state);
    const visualTime = scenePreferences.motion ? timeMs : 0;
    const sweepAngle = radarSweepAngle(visualTime, scenePreferences);
    this.rebuildStaticLayers(center, timeMs, scenePreferences);

    this.context.clearRect(0, 0, this.cssWidth, this.cssHeight);
    if (!this.drawCachedLayer(this.backgroundLayer)) {
      drawRadarStaticBackdrop(this.context, this.cssWidth, this.cssHeight, center, scenePreferences);
      if (this.graph) drawRoadGraph(this.context, this.graph, this.camera, { selectedEdgeId: this.selection?.edgeId ?? null, timeMs, preferences: scenePreferences });
    }
    drawRadarSweep(this.context, this.cssWidth, this.cssHeight, center, visualTime, scenePreferences);

    if (this.graph && ACTIVE_GAME_STATES.has(state?.lifecycle)) {
      drawFrontierSignals(this.context, state, this.camera, visualTime, scenePreferences);
      drawExplorationSites(this.context, state, this.camera, visualTime, scenePreferences);
      drawThreatRoutes(this.context, state, this.camera, this.focus, scenePreferences);
      if (this.rebuildCombatLayer(state, center, sweepAngle, visualTime, scenePreferences)) this.drawCachedLayer(this.combatLayer);
      else drawCombatState(this.context, state, this.camera, { center, sweepAngle, timeMs: visualTime, preferences: scenePreferences });
      drawTacticalFocus(this.context, state, this.camera, this.focus, visualTime, this.preferences);
      this.effects.draw(this.context, this.camera, state, timeMs, this.cssWidth, this.cssHeight, scenePreferences);
      drawBuildPlacement(this.context, this.camera, this.buildPlacement, visualTime, scenePreferences);
      drawFriendlyOrderPlanning(this.context, state, this.camera, this.friendlyOrderPlanning, visualTime);
    }

    const marker = this.selection?.point ?? this.homeBase;
    if (marker) this.drawMarker(marker, visualTime);
    if (!this.drawCachedLayer(this.overlayLayer)) drawRadarStaticOverlay(this.context, this.cssWidth, this.cssHeight, scenePreferences);
  }

  drawMarker(marker, timeMs) {
    const point = this.camera.worldToScreen(marker);
    const valid = this.selection?.valid !== false;
    const accent = valid ? '#65ffd0' : '#ff596e';
    const pulse = 12 + Math.sin(timeMs * 0.005) * 2.5;
    this.context.save();
    this.context.strokeStyle = accent;
    this.context.fillStyle = valid ? 'rgba(101,255,208,0.2)' : 'rgba(255,89,110,0.2)';
    if (this.preferences.quality === 'full') { this.context.shadowColor = accent; this.context.shadowBlur = 12; }
    this.context.lineWidth = 1.5;
    this.context.beginPath(); this.context.arc(point.x, point.y, pulse, 0, Math.PI * 2); this.context.fill(); this.context.stroke();
    this.context.setLineDash([3, 3]);
    this.context.beginPath(); this.context.arc(point.x, point.y, pulse + 6, 0, Math.PI * 2); this.context.stroke();
    this.context.setLineDash([]);
    this.context.beginPath();
    this.context.moveTo(point.x - 5, point.y); this.context.lineTo(point.x + 5, point.y);
    this.context.moveTo(point.x, point.y - 5); this.context.lineTo(point.x, point.y + 5); this.context.stroke();
    this.context.restore();
  }

  destroy() {
    this.resizeObserver?.disconnect();
    if (!this.resizeObserver) globalThis.removeEventListener?.('resize', this.boundWindowResize);
    if (this.ambientFrameId != null) globalThis.cancelAnimationFrame?.(this.ambientFrameId);
    this.ambientFrameId = null;
    this.effects.destroy();
  }
}
