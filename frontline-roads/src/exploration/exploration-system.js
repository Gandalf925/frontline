import { addBundle } from '../civilization/inventory-system.js';
import { distance, stableId } from '../core/utilities.js';
import { chunkCenterWorld, chunkForWorldPoint, parseChunkId } from '../roads/world-chunk-grid.js';
import { enemyPosition } from '../combat/enemy-system.js';
import { graphElementsNearPoint } from '../roads/road-graph.js';

export const EXPLORATION_INTERACTION_RANGE_METERS = 50;

const SITE_DEFINITIONS = Object.freeze({
  enemySource: { name: '敵発生源', duration: 45, icon: 'X', description: '未確認地域から侵攻を送り出す固定発生源です。周辺の敵を排除して現地で無力化します。' },
  supplyCache: { name: '放棄補給庫', duration: 15, icon: 'S', description: '放棄された備蓄です。現地で安全を確認すると資源を回収できます。' },
  survivors: { name: '避難者反応', duration: 20, icon: 'H', description: '生存者の通信反応です。現地調査により支援物資を受け取れます。' },
  communications: { name: '旧通信施設', duration: 25, icon: 'C', description: '周辺の敵性通信を解析し、未確認前線の情報精度を高めます。' },
  resourceSurvey: { name: '資源調査地点', duration: 20, icon: 'R', description: '道路沿いに資源反応があります。調査完了時に採取可能分を回収します。' },
  lookout: { name: '監視地点', duration: 12, icon: 'O', description: '周辺を見渡せる地点です。調査すると最寄りの敵性反応を特定します。' }
});

function hashNumber(text) {
  let hash = 2166136261;
  for (const character of String(text)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function nearestNodeInChunk(state, chunkIdValue, point, maximumDistance = Infinity) {
  const size = state.world.roadChunks?.sizeMeters;
  let best = null;
  for (const node of graphElementsNearPoint(state.world.roadGraph, point, maximumDistance).nodes) {
    if (size && chunkForWorldPoint(node, size).id !== chunkIdValue) continue;
    const gap = distance(node, point);
    if (gap > maximumDistance || (best && gap >= best.gap)) continue;
    best = { node, gap };
  }
  return best;
}

function siteReward(type, seed, threat = 1) {
  const variance = hashNumber(seed) % 9;
  if (type === 'enemySource') return { wood: 20 + threat * 12, stone: 16 + threat * 10, fiber: 10 + threat * 8 };
  if (type === 'supplyCache') return { wood: 18 + variance, stone: 12 + variance, fiber: 8 + Math.floor(variance / 2) };
  if (type === 'survivors') return { wood: 12, fiber: 20 + variance };
  if (type === 'resourceSurvey') return { stone: 18 + variance, copperOre: 2 + (variance % 3) };
  if (type === 'communications') return { fiber: 16 + variance };
  return { wood: 8 + variance, stone: 8 + variance };
}

function createSite({ type, nodeId, sourceId = null, seed, threat = 1, worldTimeMs }) {
  const definition = SITE_DEFINITIONS[type];
  return {
    id: stableId('exploration_site', type, nodeId, sourceId ?? seed),
    type,
    nodeId,
    sourceId,
    status: 'DISCOVERED',
    interactionActive: false,
    progress: 0,
    requiredSeconds: definition.duration,
    reward: siteReward(type, seed, threat),
    discoveredAt: worldTimeMs,
    completedAt: null
  };
}

export function explorationSitePresentation(site) {
  const definition = SITE_DEFINITIONS[site?.type] ?? SITE_DEFINITIONS.lookout;
  return { ...definition, status: site?.status ?? 'DISCOVERED' };
}

export function ensureExplorationState(state) {
  state.world.explorationSites = Array.isArray(state.world.explorationSites) ? state.world.explorationSites : [];
  state.world.exploredSiteChunks = Array.isArray(state.world.exploredSiteChunks) ? state.world.exploredSiteChunks : [];
  for (const site of state.world.explorationSites) {
    site.progress = Number(site.progress) || 0;
    site.interactionActive = Boolean(site.interactionActive);
    site.status ??= 'DISCOVERED';
  }
  return state.world.explorationSites;
}

function materializeFrontierSources(state) {
  const observed = new Set(state.world.roadChunks?.playerObserved ?? state.world.roadChunks?.loaded ?? []);
  const sites = state.world.explorationSites;
  for (const source of state.world.frontierSources ?? []) {
    if (source.status === 'CLEARED' || sites.some(site => site.sourceId === source.id)) continue;
    const sourceChunkId = chunkForWorldPoint(source.point, state.world.roadChunks.sizeMeters).id;
    if (!observed.has(sourceChunkId)) continue;
    const nearest = nearestNodeInChunk(state, sourceChunkId, source.point, 260);
    if (!nearest) continue;
    const site = createSite({
      type: 'enemySource',
      nodeId: nearest.node.id,
      sourceId: source.id,
      seed: source.id,
      threat: source.threat,
      worldTimeMs: state.runtime?.worldTimeMs ?? Date.now()
    });
    sites.push(site);
    source.entryNodeId = nearest.node.id;
    source.status = 'DISCOVERED';
    source.signalStage = 'CONTACT';
    source.discoveredAt ??= state.runtime?.worldTimeMs ?? Date.now();
  }
}

function createAmbientSites(state) {
  const processed = new Set(state.world.exploredSiteChunks);
  const cityNode = state.world.roadGraph.nodeById.get(state.world.city?.nodeId);
  for (const chunkIdValue of state.world.roadChunks?.playerObserved ?? state.world.roadChunks?.loaded ?? []) {
    if (processed.has(chunkIdValue)) continue;
    processed.add(chunkIdValue);
    state.world.exploredSiteChunks.push(chunkIdValue);
    const chunk = parseChunkId(chunkIdValue);
    const center = chunkCenterWorld(chunk, state.world.roadChunks.sizeMeters);
    if (cityNode && distance(center, cityNode) < 650) continue;
    const hash = hashNumber(`${chunkIdValue}:${Number(state.world.roadGraph.center.lat).toFixed(3)}:${Number(state.world.roadGraph.center.lon).toFixed(3)}`);
    if (hash % 100 >= 55) continue;
    const types = ['supplyCache', 'survivors', 'communications', 'resourceSurvey', 'lookout'];
    const type = types[(hash >>> 7) % types.length];
    const nearest = nearestNodeInChunk(state, chunkIdValue, center, 420);
    if (!nearest) continue;
    if (state.world.explorationSites.some(site => site.nodeId === nearest.node.id)) continue;
    state.world.explorationSites.push(createSite({
      type,
      nodeId: nearest.node.id,
      seed: `${chunkIdValue}:${type}`,
      worldTimeMs: state.runtime?.worldTimeMs ?? Date.now()
    }));
  }
}

export function reconcileExplorationSites(state) {
  ensureExplorationState(state);
  if (!state.world.roadGraph?.nodeById || !state.world.roadChunks || !state.world.city) return state.world.explorationSites;
  materializeFrontierSources(state);
  createAmbientSites(state);
  return state.world.explorationSites;
}

function sourceEnemiesNearSite(state, site, radius = 130) {
  if (!site.sourceId) return false;
  const node = state.world.roadGraph.nodeById.get(site.nodeId);
  if (!node) return false;
  return state.combat.enemies.some(enemy => enemy.hp > 0 && enemy.sourceBaseId === site.sourceId && distance(enemyPosition(state, enemy), node) <= radius);
}

function revealNearestSource(state, node) {
  const source = (state.world.frontierSources ?? [])
    .filter(item => item.status !== 'CLEARED')
    .map(item => ({ item, gap: distance(item.point, node) }))
    .sort((a, b) => a.gap - b.gap)[0]?.item;
  if (!source) return;
  source.signalStage = 'LOCATED';
  if (source.status === 'UNCONFIRMED') source.status = 'LOCATED';
}

function completeSite(state, site, events) {
  site.status = 'CLEARED';
  site.interactionActive = false;
  site.progress = site.requiredSeconds;
  site.completedAt = state.runtime?.worldTimeMs ?? Date.now();
  addBundle(state, site.reward ?? {});
  const node = state.world.roadGraph.nodeById.get(site.nodeId);
  if (site.type === 'enemySource' && site.sourceId) {
    const source = state.world.frontierSources.find(item => item.id === site.sourceId);
    if (source) {
      source.status = 'CLEARED';
      source.clearedAt = site.completedAt;
      source.spawnClock = 0;
    }
    events?.emit('message', { text: '敵発生源を無力化しました。この方向からの新たな侵攻は停止します。' });
  } else if (site.type === 'communications') {
    for (const source of state.world.frontierSources ?? []) source.spawnClock = Math.max(0, source.spawnClock - 120);
    revealNearestSource(state, node);
    events?.emit('message', { text: '通信施設を解析し、敵前線の情報を更新しました。' });
  } else if (site.type === 'lookout') {
    revealNearestSource(state, node);
    events?.emit('message', { text: '監視地点から周辺の敵性反応を特定しました。' });
  } else {
    events?.emit('message', { text: `${SITE_DEFINITIONS[site.type]?.name ?? '探索地点'}の調査を完了しました。` });
  }
  events?.emit('exploration:site-cleared', { siteId: site.id, type: site.type, reward: site.reward });
}

export class ExplorationSystem {
  constructor(events) { this.events = events; }

  reconcile(state) { return reconcileExplorationSites(state); }

  beginInteraction(state, siteId) {
    const site = ensureExplorationState(state).find(item => item.id === siteId);
    if (!site || site.status === 'CLEARED') return { ok: false, reason: 'この探索地点は既に完了しています。' };
    const node = state.world.roadGraph.nodeById.get(site.nodeId);
    const player = state.player.worldPosition;
    if (!node || !player || distance(player, node) > EXPLORATION_INTERACTION_RANGE_METERS) {
      return { ok: false, reason: `現地${EXPLORATION_INTERACTION_RANGE_METERS}m以内へ移動してください。` };
    }
    if (site.type === 'enemySource' && sourceEnemiesNearSite(state, site)) {
      return { ok: false, reason: '発生源周辺の敵を先に排除してください。' };
    }
    site.interactionActive = true;
    return { ok: true, site };
  }

  update(state, deltaSeconds) {
    this.reconcile(state);
    const player = state.player.worldPosition;
    for (const site of state.world.explorationSites) {
      if (!site.interactionActive || site.status === 'CLEARED') continue;
      const node = state.world.roadGraph.nodeById.get(site.nodeId);
      if (!player || !node || distance(player, node) > EXPLORATION_INTERACTION_RANGE_METERS) {
        site.interactionActive = false;
        this.events?.emit('message', { text: '探索範囲から離れたため調査を中断しました。進捗は保持されます。' });
        continue;
      }
      if (site.type === 'enemySource' && sourceEnemiesNearSite(state, site)) {
        site.interactionActive = false;
        this.events?.emit('message', { text: '敵が接近したため発生源の無力化を中断しました。' });
        continue;
      }
      site.progress += deltaSeconds;
      if (site.progress >= site.requiredSeconds) completeSite(state, site, this.events);
    }
  }
}
