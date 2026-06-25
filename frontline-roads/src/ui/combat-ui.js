import { distance } from '../core/utilities.js';
import { DEFENSE_DEFINITIONS, ENEMY_BASE_DEFINITIONS, ENEMY_DEFINITIONS, defenseRuntimeDefinition } from '../combat/definitions.js';
import { ownedBaseById } from '../base/field-bases.js';
import { constructionRangeSummary } from '../base/construction-range.js';
import { defensePresentation, uniqueDefenseDescriptionParagraphs } from '../combat/defense-presentation.js';
import { surveyFacilityPresentation } from '../exploration/survey-system.js';
import { scaleEnemyDefinition } from '../combat/enemy-scaling.js';
import { enemyBehaviorForDefinition, waveDoctrineDefinition } from '../combat/enemy-personalities.js';
import { edgeMidpoint } from '../combat/combat-geometry.js';
import { enemyPosition } from '../combat/enemy-system.js';
import { FRIENDLY_SQUAD_DEFINITIONS, FRIENDLY_SQUAD_ORDER, FRIENDLY_SQUAD_STATUS, friendlySquadPosition } from '../combat/friendly-force-system.js';
import { friendlySquadRuntimeDefinition } from '../combat/friendly-force-definitions.js';
import { recoveryPresentation } from '../combat/friendly-recovery-system.js';
import { medicalCoverageForSquad } from '../combat/friendly-healing-system.js';
import {
  FRIENDLY_ORDER_MODE,
  buildFriendlyRouteOptions,
  commandStartNodeId,
  friendlyRouteIndexAtPoint,
  nearestRoadNode,
  orderDestinationNodeId,
  validateRetreatDestination
} from '../combat/friendly-route-planner.js';
import { remainingRouteDistance } from '../rendering/threat-analysis.js';
import { bundleText } from '../civilization/inventory-system.js';
import { frontierPresentation } from '../exploration/frontier-system.js';
import { EXPLORATION_INTERACTION_RANGE_METERS, explorationSitePresentation } from '../exploration/exploration-system.js';
import { RECOVERY_COLLECTION_DURATION_SECONDS, RECOVERY_ITEM_STATUS, RECOVERY_RANGE_METERS, recoveryEligibility, recoveryItemPoint, recoveryItemPresentation } from '../exploration/recovery-system.js';
import { RESOURCE_LABELS } from '../civilization/data.js';
import { defenseUpgradeStatus } from '../civilization/defense-upgrade.js';
import { queryRequired, setVisible } from './dom.js';

export class CombatUi {
  constructor({ store, buildSystem, civilizationSystem, explorationSystem, recoverySystem, friendlyForceSystem, camera, renderer, notifications, persist = null, openDeployment = null, requestSurvey = null }) {
    this.store = store;
    this.buildSystem = buildSystem;
    this.civilizationSystem = civilizationSystem;
    this.explorationSystem = explorationSystem;
    this.recoverySystem = recoverySystem;
    this.friendlyForceSystem = friendlyForceSystem;
    this.persist = persist;
    this.openDeployment = openDeployment;
    this.requestSurvey = requestSurvey;
    this.camera = camera;
    this.renderer = renderer;
    this.notifications = notifications;
    this.selectedTool = 'select';
    this.selectedObject = null;
    this.buildCandidate = null;
    this.buildSites = [];
    this.buildPlacementSignature = '';
    this.toolAffordabilitySignature = '';
    this.orderPlanning = null;
    this.contextDisclosureKey = '';
    this.contextDisclosureOpen = false;
    this.pendingDefenseRemovalId = null;
    this.defensePanelMode = 'summary';
    this.defensePanelDefenseId = null;
    this.tools = queryRequired('#combatTools');
    this.cityHp = queryRequired('#cityHp');
    this.enemyCount = queryRequired('#enemyCount');
    this.civilizationLevel = queryRequired('#civilizationLevel');
    this.context = queryRequired('#contextPanel');
    this.contextTitle = queryRequired('#contextTitle');
    this.contextText = queryRequired('#contextText');
    this.contextActions = queryRequired('#contextActions');
    this.renderTools();
  }

  clearObjectSelection({ hideContext = true } = {}) {
    if (this.orderPlanning) { this.orderPlanning = null; this.renderer.setFriendlyOrderPlanning(null); }
    this.selectedObject = null;
    this.pendingDefenseRemovalId = null;
    this.defensePanelMode = 'summary';
    this.defensePanelDefenseId = null;
    this.renderer.setFocus(null);
    if (hideContext) setVisible(this.context, false);
  }

  contextDisclosureIdentity() {
    if (this.selectedTool !== 'select') return `build:${this.selectedTool}`;
    if (this.orderPlanning) return `order:${this.selectedObject?.id ?? 'none'}:${this.orderPlanning.mode ?? 'unknown'}`;
    if (this.selectedObject) return `${this.selectedObject.kind}:${this.selectedObject.id}`;
    return 'none';
  }

  affordabilitySignature(state) {
    return Object.keys(DEFENSE_DEFINITIONS)
      .map(type => `${type}:${this.buildSystem.canAfford(state, type) ? 1 : 0}`)
      .join('|');
  }

  renderTools(state = this.store.snapshot()) {
    this.toolAffordabilitySignature = this.affordabilitySignature(state);
    this.tools.textContent = '';
    const entries = [['select', { name: '選択', icon: '☝', cost: null }], ...Object.entries(DEFENSE_DEFINITIONS)];
    for (const [type, definition] of entries) {
      const affordable = type === 'select' || this.buildSystem.canAfford(state, type);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `toolButton${type === this.selectedTool ? ' is-selected' : ''}${affordable ? '' : ' is-unaffordable'}`;
      button.dataset.tool = type;
      button.setAttribute?.('aria-pressed', String(type === this.selectedTool));
      const cost = definition.cost ? bundleText(definition.cost) : '';
      button.innerHTML = `<strong>${definition.icon}</strong><span>${definition.name}</span>${cost ? `<small>${cost}</small>` : ''}`;
      button.addEventListener('click', () => this.selectTool(type));
      this.tools.appendChild(button);
    }
  }

  selectTool(type) {
    this.selectedTool = type === 'select' || DEFENSE_DEFINITIONS[type] ? type : 'select';
    this.buildCandidate = null;
    this.buildPlacementSignature = '';
    this.clearObjectSelection({ hideContext: this.selectedTool === 'select' });
    this.renderTools();

    if (this.selectedTool === 'select') {
      this.buildSites = [];
      this.renderer.setBuildPlacement(null);
      this.context.classList?.remove('is-build-mode', 'has-candidate', 'is-order-mode', 'is-defense-mode', 'is-defense-summary', 'is-defense-details', 'is-defense-upgrade', 'is-target-mode');
      this.notifications.show('設備・敵拠点・部隊を選択できます。');
      return;
    }

    this.refreshBuildPlacement(true);
    this.renderContext();
    const presentation = defensePresentation(this.selectedTool);
    this.notifications.show(`${presentation?.role ?? '建設'}：表示された有効地点を選択してください。`);
  }

  placementSignature(state) {
    if (this.selectedTool === 'select') return 'select';
    const definition = DEFENSE_DEFINITIONS[this.selectedTool];
    const resourceState = Object.keys(definition.cost)
      .map(key => `${key}:${state.inventory.resources[key] ?? 0}`)
      .join(',');
    const occupiedState = state.combat.defenses
      .filter(defense => defense.kind === definition.kind)
      .map(defense => `${defense.id}:${defense.hp > 0 ? 1 : 0}`)
      .join(',');
    const graph = state.world.roadGraph;
    const anchorState = this.buildSystem.getBuildAnchors(state)
      .map(anchor => `${anchor.id}:${anchor.point.x.toFixed(1)},${anchor.point.y.toFixed(1)}:${Number(anchor.range).toFixed(0)}`)
      .join(';');
    return [
      this.selectedTool,
      resourceState,
      occupiedState,
      graph?.nodes?.length ?? 0,
      graph?.edges?.length ?? 0,
      anchorState
    ].join('|');
  }

  refreshBuildPlacement(force = false, state = this.store.snapshot()) {
    if (this.selectedTool === 'select') {
      this.renderer.setBuildPlacement(null);
      return;
    }
    const signature = this.placementSignature(state);
    if (!force && signature === this.buildPlacementSignature) return;

    if (this.buildCandidate) {
      const validation = this.buildSystem.validateCandidate(state, this.buildCandidate, { checkResources: false });
      this.buildCandidate = validation.ok ? validation.candidate : null;
    }
    this.buildSites = this.buildSystem.listBuildSites(state, this.selectedTool);
    const buildStatus = this.buildSystem.getBuildStatus(state, this.selectedTool);
    const affordable = buildStatus.ok;
    this.renderer.setBuildPlacement({
      type: this.selectedTool,
      anchors: this.buildSystem.getBuildAnchors(state),
      sites: this.buildSites,
      candidate: this.buildCandidate,
      affordable
    });
    this.buildPlacementSignature = signature;
  }

  nearestObject(state, point, tolerance, afterObject = null) {
    const graph = state.world.roadGraph;
    const candidates = [];
    for (const item of state.world.recoveryItems ?? []) {
      if (item.status !== 'AVAILABLE') continue;
      const itemPosition = recoveryItemPoint(state, item);
      candidates.push({ kind: 'recoveryItem', id: item.id, point: itemPosition, distance: distance(point, itemPosition) });
    }
    for (const site of state.world.explorationSites ?? []) {
      if (site.status === 'CLEARED') continue;
      const node = graph.nodeById.get(site.nodeId);
      if (node) candidates.push({ kind: 'explorationSite', id: site.id, point: node, distance: distance(point, node) });
    }
    for (const source of state.world.frontierSources ?? []) {
      if (source.status === 'CLEARED' || (state.world.explorationSites ?? []).some(site => site.sourceId === source.id && site.status !== 'CLEARED')) continue;
      const node = graph.nodeById.get(source.entryNodeId);
      if (node) candidates.push({ kind: 'frontier', id: source.id, point: node, distance: distance(point, node) });
    }
    for (const base of state.world.enemyBases) {
      if (!base.alive) continue;
      const node = graph.nodeById.get(base.nodeId);
      if (node) candidates.push({ kind: 'enemyBase', id: base.id, point: node, distance: distance(point, node) });
    }
    for (const defense of state.combat.defenses) {
      const position = defense.kind === 'barrier' ? edgeMidpoint(graph, defense.edgeId) : graph.nodeById.get(defense.nodeId);
      if (position) candidates.push({
        kind: 'defense',
        id: defense.id,
        point: position,
        distance: distance(point, position),
        priority: 0
      });
    }
    for (const enemy of state.combat.enemies) {
      if (enemy.hp <= 0 || enemy.departDelay > 0) continue;
      const position = enemyPosition(state, enemy);
      candidates.push({ kind: 'enemy', id: enemy.id, point: position, distance: distance(point, position) });
    }
    for (const squad of state.combat.friendlySquads ?? []) {
      if (squad.hp <= 0) continue;
      const position = friendlySquadPosition(state, squad);
      candidates.push({ kind: 'friendlySquad', id: squad.id, point: position, distance: distance(point, position) });
    }
    const city = graph.nodeById.get(state.world.city.nodeId);
    if (city) candidates.push({ kind: 'city', id: 'city', point: city, distance: distance(point, city) });
    candidates.sort((a, b) => a.distance - b.distance || (a.priority ?? 0) - (b.priority ?? 0));
    const nearby = candidates.filter(candidate => candidate.distance <= tolerance);
    if (afterObject && nearby.length > 1) {
      const selectedIndex = nearby.findIndex(candidate => candidate.kind === afterObject.kind && candidate.id === afterObject.id);
      if (selectedIndex >= 0) return nearby[(selectedIndex + 1) % nearby.length];
    }
    return nearby[0] ?? null;
  }

  selectedFriendlySquad(state = this.store.snapshot()) {
    if (this.selectedObject?.kind !== 'friendlySquad') return null;
    return (state.combat.friendlySquads ?? []).find(squad => squad.id === this.selectedObject.id && squad.hp > 0) ?? null;
  }

  updateOrderPlanningOverlay() {
    this.renderer.setFriendlyOrderPlanning(this.orderPlanning ? {
      squadId: this.orderPlanning.squadId,
      mode: this.orderPlanning.mode,
      destinationNodeId: this.orderPlanning.destinationNodeId,
      waypointNodeIds: [...this.orderPlanning.waypointNodeIds],
      routes: this.orderPlanning.routes,
      selectedRouteIndex: this.orderPlanning.selectedRouteIndex,
    } : null);
  }

  rebuildOrderRoutes(state = this.store.snapshot()) {
    if (!this.orderPlanning) return;
    const squad = (state.combat.friendlySquads ?? []).find(item => item.id === this.orderPlanning.squadId && item.hp > 0);
    if (!squad) { this.cancelOrderPlanning(); return; }
    this.orderPlanning.startNodeId = commandStartNodeId(state, squad);
    this.orderPlanning.routes = this.orderPlanning.destinationNodeId
      ? buildFriendlyRouteOptions(state, squad, this.orderPlanning.destinationNodeId, this.orderPlanning.waypointNodeIds)
      : [];
    this.orderPlanning.selectedRouteIndex = Math.min(
      this.orderPlanning.selectedRouteIndex,
      Math.max(0, this.orderPlanning.routes.length - 1)
    );
    this.updateOrderPlanningOverlay();
  }

  beginOrderPlanning(mode) {
    const state = this.store.snapshot();
    const squad = this.selectedFriendlySquad(state);
    if (!squad) return;
    const destinationNodeId = orderDestinationNodeId(state, squad, mode);
    if (mode !== FRIENDLY_ORDER_MODE.RETREAT && !destinationNodeId) {
      this.notifications.show(mode === FRIENDLY_ORDER_MODE.RESUME ? '元の攻撃目標は既に失われています。' : '出撃元へ戻る経路を設定できません。');
      return;
    }
    this.selectedTool = 'select';
    this.buildCandidate = null;
    this.buildSites = [];
    this.renderer.setBuildPlacement(null);
    this.renderTools();
    this.orderPlanning = {
      mode,
      squadId: squad.id,
      destinationNodeId,
      waypointNodeIds: [],
      routes: [],
      selectedRouteIndex: 0
    };
    this.rebuildOrderRoutes();
    this.renderContext();
    this.notifications.show(mode === FRIENDLY_ORDER_MODE.RETREAT
      ? 'MAP上で後退地点を選択してください。続けて最大2か所の経由地点を追加できます。'
      : '表示された経路を選ぶか、MAP上で最大2か所の経由地点を追加してください。');
  }

  handleOrderPlanningTap(worldPoint) {
    const state = this.store.snapshot();
    const squad = this.selectedFriendlySquad(state);
    if (!this.orderPlanning || !squad) return;
    if (this.orderPlanning.destinationNodeId && this.orderPlanning.routes.length) {
      const routeIndex = friendlyRouteIndexAtPoint(state, squad, this.orderPlanning.routes, worldPoint, 12 / this.camera.scale);
      if (routeIndex >= 0) {
        this.selectOrderRoute(routeIndex);
        this.notifications.show(`${this.orderPlanning.routes[routeIndex].label}ルートを選択しました。`);
        return;
      }
    }
    const nearest = nearestRoadNode(state, worldPoint, 28 / this.camera.scale);
    if (!nearest) { this.notifications.show('道路上の交差点または経路線を選択してください。'); return; }
    const nodeId = nearest.node.id;
    if (this.orderPlanning.mode === FRIENDLY_ORDER_MODE.RETREAT && !this.orderPlanning.destinationNodeId) {
      const validation = validateRetreatDestination(state, squad, nodeId);
      if (!validation.ok) { this.notifications.show(validation.reason); return; }
      this.orderPlanning.destinationNodeId = nodeId;
      this.orderPlanning.waypointNodeIds = [];
      this.orderPlanning.selectedRouteIndex = 0;
      this.rebuildOrderRoutes();
      this.renderContext();
      return;
    }
    if (nodeId === this.orderPlanning.destinationNodeId || nodeId === commandStartNodeId(state, squad)) {
      this.notifications.show('目的地または現在の進路先とは別の交差点を選択してください。');
      return;
    }
    if (this.orderPlanning.waypointNodeIds.includes(nodeId)) {
      this.notifications.show('その経由地点は既に選択されています。');
      return;
    }
    if (this.orderPlanning.waypointNodeIds.length >= 2) {
      this.notifications.show('経由地点は最大2か所です。');
      return;
    }
    this.orderPlanning.waypointNodeIds.push(nodeId);
    this.orderPlanning.selectedRouteIndex = 0;
    this.rebuildOrderRoutes();
    this.renderContext();
  }

  cancelOrderPlanning() {
    this.orderPlanning = null;
    this.updateOrderPlanningOverlay();
    this.renderContext();
  }

  removeLastWaypoint() {
    if (!this.orderPlanning?.waypointNodeIds.length) return;
    this.orderPlanning.waypointNodeIds.pop();
    this.orderPlanning.selectedRouteIndex = 0;
    this.rebuildOrderRoutes();
    this.renderContext();
  }

  resetRetreatDestination() {
    if (!this.orderPlanning || this.orderPlanning.mode !== FRIENDLY_ORDER_MODE.RETREAT) return;
    this.orderPlanning.destinationNodeId = null;
    this.orderPlanning.waypointNodeIds = [];
    this.orderPlanning.routes = [];
    this.orderPlanning.selectedRouteIndex = 0;
    this.updateOrderPlanningOverlay();
    this.renderContext();
  }

  selectOrderRoute(index) {
    if (!this.orderPlanning || !this.orderPlanning.routes[index]) return;
    this.orderPlanning.selectedRouteIndex = index;
    this.updateOrderPlanningOverlay();
    this.renderContext();
  }

  confirmOrderPlanning() {
    if (!this.orderPlanning) return;
    const priorIndex = this.orderPlanning.selectedRouteIndex;
    this.rebuildOrderRoutes();
    this.orderPlanning.selectedRouteIndex = Math.min(priorIndex, Math.max(0, this.orderPlanning.routes.length - 1));
    const route = this.orderPlanning.routes[this.orderPlanning.selectedRouteIndex];
    if (!route) { this.notifications.show('実行可能な道路経路がありません。'); return; }
    const currentState = this.store.snapshot();
    const currentSquad = (currentState.combat.friendlySquads ?? []).find(item => item.id === this.orderPlanning.squadId);
    const order = this.orderPlanning.mode === FRIENDLY_ORDER_MODE.RETREAT
      ? FRIENDLY_SQUAD_ORDER.RETREAT
      : this.orderPlanning.mode === FRIENDLY_ORDER_MODE.WITHDRAW
        ? FRIENDLY_SQUAD_ORDER.WITHDRAW
        : currentSquad?.heldOrder === FRIENDLY_SQUAD_ORDER.RETREAT
          ? FRIENDLY_SQUAD_ORDER.RETREAT
          : FRIENDLY_SQUAD_ORDER.ADVANCE;
    let result;
    this.store.transaction(state => {
      result = this.friendlyForceSystem.issueRouteOrder(state, this.orderPlanning.squadId, {
        order,
        path: route.path,
        destinationNodeId: this.orderPlanning.destinationNodeId
      });
    }, 'friendly:order', { emit: true, validate: true });
    if (!result?.ok) { this.notifications.show(result?.reason ?? '命令を実行できません。'); return; }
    this.orderPlanning = null;
    this.updateOrderPlanningOverlay();
    this.persist?.();
    this.notifications.show(order === FRIENDLY_SQUAD_ORDER.RETREAT ? '後退を開始しました。' : order === FRIENDLY_SQUAD_ORDER.WITHDRAW ? '撤退を開始しました。' : '選択ルートで進軍を再開しました。');
    this.renderContext();
  }

  holdSelectedSquad() {
    const squad = this.selectedFriendlySquad();
    if (!squad) return;
    let result;
    this.store.transaction(state => { result = this.friendlyForceSystem.hold(state, squad.id); }, 'friendly:hold', { emit: true, validate: true });
    this.notifications.show(result?.ok ? '部隊を停止させました。' : result?.reason ?? '停止できません。');
    if (result?.ok) this.persist?.();
    this.renderContext();
  }

  renderOrderPlanningContext(state, squad) {
    this.context.classList?.add('is-order-mode');
    const plan = this.orderPlanning;
    const selectedRoute = plan.routes[plan.selectedRouteIndex] ?? null;
    const modeLabel = plan.mode === FRIENDLY_ORDER_MODE.RETREAT ? '後退' : plan.mode === FRIENDLY_ORDER_MODE.WITHDRAW ? '撤退' : '進軍再開';
    const instruction = !plan.destinationNodeId
      ? 'MAP上で後退先の交差点を選択してください。敵基地へ近づく地点は後退先にできません。'
      : selectedRoute
        ? `${modeLabel}ルートを確認してください。MAPタップで最大2か所の経由地点を追加できます。`
        : '選択地点へ到達できる道路経路がありません。目的地または経由地点を変更してください。';
    this.contextTitle.textContent = `ALLY ORDER // ${modeLabel}`;
    this.setContextContent(instruction, [
      ['ROUTES', String(plan.routes.length)],
      ['SELECT', selectedRoute?.label ?? 'NONE'],
      ['DIST', selectedRoute ? `${Math.round(selectedRoute.physicalDistance)}m` : '--'],
      ['ETA', selectedRoute ? `${Math.max(1, Math.ceil(selectedRoute.etaSeconds / 60))}分` : '--'],
      ['RISK', selectedRoute?.risk ?? '--'],
      ['CONTACT', selectedRoute ? String(selectedRoute.enemyContacts) : '--'],
      ['VIA', `${plan.waypointNodeIds.length}/2`]
    ], [
      plan.mode === FRIENDLY_ORDER_MODE.WITHDRAW ? '撤退を確定すると現在の攻撃任務は破棄され、再開できません。' : '未発見の敵は危険度計算に含まれません。',
      squad.edgeId && squad.edgeProgress > 0 ? '道路途中では現在の区間を次の交差点まで進んでから選択ルートへ入ります。' : '命令確定後、選択ルートへ直ちに移行します。'
    ]);
    plan.routes.forEach((route, index) => this.action(
      `${index + 1}. ${route.label}${index === plan.selectedRouteIndex ? ' ✓' : ''}`,
      () => this.selectOrderRoute(index),
      index === plan.selectedRouteIndex ? 'primary' : ''
    ));
    if (plan.waypointNodeIds.length) this.action('最後の経由地点を取消', () => this.removeLastWaypoint());
    if (plan.mode === FRIENDLY_ORDER_MODE.RETREAT && plan.destinationNodeId) this.action('後退地点を選び直す', () => this.resetRetreatDestination());
    const confirm = this.action(`${modeLabel}を確定`, () => this.confirmOrderPlanning(), 'primary');
    confirm.disabled = !selectedRoute;
    this.action('命令を取消', () => this.cancelOrderPlanning());
    setVisible(this.context, true);
  }

  handleMapTap(worldPoint) {
    if (this.orderPlanning) {
      this.handleOrderPlanningTap(worldPoint);
      return;
    }
    if (this.selectedTool === 'select') {
      const state = this.store.snapshot();
      const nextObject = this.nearestObject(state, worldPoint, 24 / this.camera.scale, this.selectedObject);
      const sameObject = nextObject
        && this.selectedObject
        && nextObject.kind === this.selectedObject.kind
        && nextObject.id === this.selectedObject.id;
      if (sameObject || !nextObject) {
        this.clearObjectSelection();
        return;
      }
      this.pendingDefenseRemovalId = null;
      this.defensePanelMode = 'summary';
      this.defensePanelDefenseId = null;
      this.selectedObject = nextObject;
      this.renderer.setFocus({ kind: nextObject.kind, id: nextObject.id });
      this.renderContext();
      return;
    }

    const state = this.store.snapshot();
    const result = this.buildSystem.previewAt(state, this.selectedTool, worldPoint, 24 / this.camera.scale);
    if (!result.ok) {
      this.buildCandidate = null;
      this.refreshBuildPlacement(true);
      this.renderContext();
      this.notifications.show(result.reason ?? 'この位置には設置できません。');
      return;
    }
    this.buildCandidate = result.candidate;
    this.refreshBuildPlacement(true);
    this.renderContext();
    this.notifications.show('設置候補を選択しました。範囲と効果を確認して建設を確定してください。');
  }

  confirmBuildCandidate() {
    if (!this.buildCandidate || this.selectedTool === 'select') return;
    const state = this.store.snapshot();
    const validation = this.buildSystem.validateCandidate(state, this.buildCandidate, { checkResources: true });
    if (!validation.ok) {
      this.notifications.show(validation.reason ?? '建設できません。');
      this.refreshBuildPlacement(true);
      this.renderContext();
      return;
    }

    let result = null;
    this.store.transaction(draft => {
      result = this.buildSystem.buildCandidate(draft, validation.candidate);
    }, 'combat:build', { emit: true, validate: true });
    if (!result?.ok) {
      this.notifications.show(result?.reason ?? '建設できません。');
      this.refreshBuildPlacement(true);
      this.renderContext();
      return;
    }

    this.persist?.();
    this.notifications.show(`${DEFENSE_DEFINITIONS[this.selectedTool].name}を設置しました。`);
    this.buildCandidate = null;
    this.buildPlacementSignature = '';
    this.renderTools();
    this.refreshBuildPlacement(true);
    this.renderContext();
  }

  cancelBuildCandidate() {
    this.buildCandidate = null;
    this.refreshBuildPlacement(true);
    this.renderContext();
  }

  appendContextMetrics(metrics = []) {
    if (!metrics.length) return null;
    const grid = document.createElement('div');
    grid.className = 'contextMetricGrid';
    for (const [label, value] of metrics) {
      const item = document.createElement('span');
      const key = document.createElement('small');
      const data = document.createElement('b');
      key.textContent = label;
      data.textContent = value;
      item.append(key, data);
      grid.appendChild(item);
    }
    this.contextText.appendChild(grid);
    return grid;
  }

  setContextMetrics(metrics = []) {
    this.contextText.textContent = '';
    this.appendContextMetrics(metrics);
  }

  setDefensePanelMode(mode, defenseId) {
    this.defensePanelMode = mode;
    this.defensePanelDefenseId = defenseId;
    this.pendingDefenseRemovalId = null;
    this.renderContext();
  }

  setDefenseDetails(presentation, notes = []) {
    this.contextText.textContent = '';
    const copy = document.createElement('div');
    copy.className = 'defenseDetailCopy';
    uniqueDefenseDescriptionParagraphs(presentation, notes)
      .forEach((text, index) => {
        const paragraph = document.createElement('p');
        paragraph.className = index === 0 ? 'contextSummary' : 'contextDetail';
        paragraph.textContent = text;
        copy.appendChild(paragraph);
      });
    this.contextText.appendChild(copy);
  }

  setContextContent(summary, metrics = [], details = []) {
    this.contextText.textContent = '';
    this.appendContextMetrics(metrics);

    const explanation = [summary, ...details]
      .filter(detailText => typeof detailText === 'string' && detailText.trim().length);
    if (!explanation.length) return;
    const disclosureKey = this.contextDisclosureIdentity();
    if (this.contextDisclosureKey !== disclosureKey) {
      this.contextDisclosureKey = disclosureKey;
      this.contextDisclosureOpen = false;
    }
    const disclosure = document.createElement('details');
    disclosure.className = 'contextDisclosure';
    disclosure.open = this.contextDisclosureOpen;
    disclosure.addEventListener('toggle', () => {
      if (this.contextDisclosureKey === disclosureKey) this.contextDisclosureOpen = Boolean(disclosure.open);
    });
    const toggle = document.createElement('summary');
    toggle.textContent = '説明を表示';
    disclosure.appendChild(toggle);
    explanation.forEach((detailText, index) => {
      const detail = document.createElement('p');
      detail.className = index === 0 ? 'contextSummary' : 'contextDetail';
      detail.textContent = detailText;
      disclosure.appendChild(detail);
    });
    this.contextText.appendChild(disclosure);
  }

  appendDefenseUpgradePreview(state, defense, status) {
    const block = document.createElement('div');
    block.className = `defenseUpgradePreview ${status.ok ? 'is-ready' : status.atMax ? 'is-max' : 'is-locked'}`;
    const heading = document.createElement('div');
    heading.className = 'defenseUpgradeHeading';
    const label = document.createElement('small');
    label.textContent = status.atMax ? 'UPGRADE COMPLETE' : `NEXT // TIER ${status.nextTier}`;
    const name = document.createElement('strong');
    name.textContent = status.atMax ? '最高Tierへ到達' : status.nextDefinition?.name ?? '強化先不明';
    heading.append(label, name);
    block.appendChild(heading);

    if (status.atMax) {
      const note = document.createElement('p');
      note.textContent = 'この設備は現在の最終形です。';
      block.appendChild(note);
      this.contextText.appendChild(block);
      return;
    }

    const current = defenseRuntimeDefinition(defense);
    const next = defenseRuntimeDefinition({ ...defense, tier: status.nextTier, maxHp: status.nextMaxHp, line: status.line });
    const rows = [];
    const add = (labelText, before, after) => {
      if (String(before) !== String(after)) rows.push([labelText, `${before} → ${after}`]);
    };
    add('HP', defense.maxHp, status.nextMaxHp);
    if (defense.kind !== 'barrier') add('射程', `${current.range}m`, `${next.range}m`);
    if (defense.type === 'gun') {
      add('威力', current.damage, next.damage);
      add('再装填', `${current.cooldown}秒`, `${next.cooldown}秒`);
    } else if (defense.type === 'mortar') {
      add('中心威力', current.damage, next.damage);
      add('再装填', `${current.cooldown}秒`, `${next.cooldown}秒`);
      add('爆発半径', `${current.blastRadius}m`, `${next.blastRadius}m`);
      add('最大命中', current.maxTargets, next.maxTargets);
      add('周辺威力', `${Math.round(current.splashMultiplier * 100)}%`, `${Math.round(next.splashMultiplier * 100)}%`);
    } else if (defense.type === 'slow') {
      add('減速率', `${Math.round(current.slow * 100)}%`, `${Math.round(next.slow * 100)}%`);
      add('効果時間', `${current.slowSeconds}秒`, `${next.slowSeconds}秒`);
      add('最大対象', current.maxTargets, next.maxTargets);
      add('再発動', `${current.cooldown}秒`, `${next.cooldown}秒`);
    } else if (defense.type === 'relay') {
      add('塔修復', current.repairTower, next.repairTower);
      add('壁修復', current.repairBarrier, next.repairBarrier);
      add('再作動', `${current.cooldown}秒`, `${next.cooldown}秒`);
    } else if (defense.type === 'medical') {
      add('回復範囲', `${current.range}m`, `${next.range}m`);
      add('回復速度', `${(current.recoveryRate * 100).toFixed(1)}%/秒`, `${(next.recoveryRate * 100).toFixed(1)}%/秒`);
    } else if (defense.type === 'survey') {
      add('MAP半径', `${current.surveyRadius}m`, `${next.surveyRadius}m`);
      add('区域取得', `${current.scanInterval}秒`, `${next.scanInterval}秒`);
    }

    const grid = document.createElement('div');
    grid.className = 'defenseUpgradeDeltaGrid';
    for (const [keyText, valueText] of rows) {
      const item = document.createElement('span');
      const key = document.createElement('small');
      const value = document.createElement('b');
      key.textContent = keyText;
      value.textContent = valueText;
      item.append(key, value);
      grid.appendChild(item);
    }
    if (rows.length) block.appendChild(grid);

    const cost = document.createElement('p');
    cost.className = 'defenseUpgradeCost';
    cost.textContent = `強化費用：${bundleText(status.cost)}`;
    block.appendChild(cost);
    if (!status.ok) {
      const reason = document.createElement('p');
      reason.className = 'defenseUpgradeReason';
      reason.textContent = status.reason;
      block.appendChild(reason);
    }
    this.contextText.appendChild(block);
  }

  action(label, handler, className = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.className = className;
    button.addEventListener('click', handler);
    this.contextActions.appendChild(button);
    return button;
  }

  mutateAction(action, reason) {
    let result;
    this.store.transaction(state => { result = action(state); }, reason, { emit: true, validate: true });
    if (result?.ok) this.persist?.();
    this.notifications.show(result?.ok ? result?.message ?? '操作を実行しました。' : result?.reason ?? '操作できません。');
    this.renderContext();
    this.renderer.render();
  }

  requestDefenseRemoval(defenseId) {
    if (this.pendingDefenseRemovalId !== defenseId) {
      this.pendingDefenseRemovalId = defenseId;
      this.notifications.show('撤去すると設備は消失し、資源は返還されません。もう一度ボタンを押すと確定します。');
      this.renderContext();
      return;
    }

    let result;
    this.store.transaction(state => { result = this.buildSystem.removeDefense(state, defenseId); }, 'defense:remove', { emit: true, validate: true });
    this.pendingDefenseRemovalId = null;
    if (!result?.ok) {
      this.notifications.show(result?.reason ?? '設備を撤去できません。');
      this.renderContext();
      return;
    }

    this.clearObjectSelection();
    this.renderTools();
    this.renderer.render();
    this.persist?.();
    this.notifications.show(result.message ?? '設備を撤去しました。');
  }

  cancelDefenseRemoval() {
    this.pendingDefenseRemovalId = null;
    this.renderContext();
  }

  renderBuildContext(state = this.store.snapshot()) {
    const definition = DEFENSE_DEFINITIONS[this.selectedTool];
    const presentation = defensePresentation(this.selectedTool, definition);
    if (!definition || !presentation) {
      this.selectTool('select');
      return;
    }
    const buildStatus = this.buildSystem.getBuildStatus(state, this.selectedTool);
    const affordable = buildStatus.ok;
    this.context.classList?.add('is-build-mode');
    this.context.classList?.toggle('has-candidate', Boolean(this.buildCandidate));
    this.contextActions.textContent = '';
    this.contextTitle.textContent = `BUILD // ${definition.name} // ${presentation.role}`;
    const instruction = !buildStatus.ok && buildStatus.requiredCivilizationLevel
      ? buildStatus.reason
      : this.buildCandidate
      ? '白い照準が現在の設置候補です。効果範囲と費用を確認して確定してください。'
      : this.buildSites.length
        ? '緑色で表示された有効地点から設置位置を選択してください。'
        : '現在の建設可能範囲内に空いている設置地点がありません。';
    const anchors = this.buildSystem.getBuildAnchors(state);
    const ranges = constructionRangeSummary(state.civilization?.level);
    const metrics = [
      ...presentation.metrics,
      ['COST', bundleText(definition.cost)],
      ['STATUS', affordable ? 'READY' : buildStatus.reason ?? '利用不可'],
      ['SITES', String(this.buildSites.length)],
      ['ZONES', anchors.map(anchor => `${anchor.label} ${Math.round(anchor.range)}m`).join(' + ') || 'NONE'],
      ...(this.buildCandidate ? [['SOURCE', this.buildCandidate.anchorLabel ?? '再計算']] : [])
    ];
    this.setContextContent(instruction, metrics, [
      presentation.summary,
      presentation.effect,
      presentation.placement,
      `新設時はTier ${definition.initialTier ?? 0}です。文明レベル上昇後、既設設備を選択して資源を支払い個別に強化できます。`,
      this.selectedTool === 'survey'
        ? `測量施設は主要拠点・簡易拠点ごとに1基までです。現在の設置範囲は主要拠点${ranges.major}m、簡易拠点${ranges.field}mです。遠隔取得で見えるのは道路と未確認前線だけで、現地情報は実際の移動後に表示されます。`
        : `文明Lv.${ranges.level}の建設可能範囲は主要拠点${ranges.major}m、簡易拠点${ranges.field}m、現在地${ranges.player}m、出撃中の遠征部隊${ranges.expedition}mです。拠点範囲は文明レベルに応じて段階的に広がりますが、後半でも現地移動・前線拠点・遠征部隊が必要な上限に抑えられます。設置済み施設は新たな建設基準点にはなりません。移動先の道路は周辺区域の取得完了後に建設へ利用できます。`
    ]);
    if (this.buildCandidate) {
      const confirm = this.action(affordable ? '建設を確定' : buildStatus.requiredCivilizationLevel ? '文明未解禁' : '資源不足', () => this.confirmBuildCandidate(), 'primary');
      confirm.disabled = !affordable;
      this.action('候補を解除', () => this.cancelBuildCandidate());
    }
    this.action('選択モードへ戻る', () => this.selectTool('select'));
    setVisible(this.context, true);
  }

  renderContext(state = this.store.snapshot()) {
    if (this.selectedTool !== 'select') {
      this.renderBuildContext(state);
      return;
    }
    this.context.classList?.remove('is-build-mode', 'has-candidate', 'is-order-mode', 'is-defense-mode', 'is-defense-summary', 'is-defense-details', 'is-defense-upgrade', 'is-target-mode');
    if (!this.selectedObject) {
      setVisible(this.context, false);
      return;
    }
    this.contextActions.textContent = '';
    const selected = this.selectedObject;
    if (this.orderPlanning) {
      const squad = this.selectedFriendlySquad(state);
      if (!squad) { this.cancelOrderPlanning(); return; }
      this.renderOrderPlanningContext(state, squad);
      return;
    }
    if (selected.kind === 'recoveryItem') {
      const item = (state.world.recoveryItems ?? []).find(value => value.id === selected.id && value.status === 'AVAILABLE');
      if (!item) { this.clearObjectSelection(); return; }
      const presentation = recoveryItemPresentation(item);
      const itemPosition = recoveryItemPoint(state, item);
      const gap = state.player.worldPosition ? distance(state.player.worldPosition, itemPosition) : Infinity;
      const eligibility = recoveryEligibility(state, item);
      const collection = state.world.recoveryCollection?.itemId === item.id ? state.world.recoveryCollection : null;
      const progress = Math.min(RECOVERY_COLLECTION_DURATION_SECONDS, collection?.progressSec ?? 0);
      this.contextTitle.textContent = `RECOVERY // ${presentation.name}`;
      this.setContextContent(
        `${presentation.sourceName}の破壊地点に残された特殊回収物です。現地へ移動し、最新の位置情報で回収してください。`,
        [['DIST', Number.isFinite(gap) ? `${Math.round(gap)}m` : 'NO GPS'], ['ENTRY', `${RECOVERY_RANGE_METERS}m`], ['STATUS', collection ? 'RECOVERING' : eligibility.ok ? 'READY' : 'FIELD LOCK'], ['TIME', collection ? `${progress.toFixed(1)}/${RECOVERY_COLLECTION_DURATION_SECONDS}s` : `${RECOVERY_COLLECTION_DURATION_SECONDS}s`], ['SOURCE', presentation.sourceName], ['LOOT', presentation.lootText]],
        [presentation.description, collection ? '回収完了まで範囲内に留まってください。' : eligibility.ok ? '回収後は文明発展の実績として記録されます。' : eligibility.reason]
      );
      this.context.classList?.add('is-target-mode');
      const collect = this.action(collection ? `回収中 ${Math.floor(progress)}/${RECOVERY_COLLECTION_DURATION_SECONDS}秒` : '現地で回収', () => this.mutateAction(draft => this.recoverySystem.beginCollection(draft, item.id), 'recovery:begin'), 'primary');
      collect.disabled = Boolean(collection) || !eligibility.ok;
      const dispatch = this.action('回収部隊を派遣', () => this.openDeployment?.({ kind: 'recoveryItem', id: item.id }));
      dispatch.disabled = Boolean(collection) || typeof this.openDeployment !== 'function';
    } else if (selected.kind === 'friendlySquad') {
      const squad = (state.combat.friendlySquads ?? []).find(item => item.id === selected.id);
      if (!squad || squad.hp <= 0) { this.clearObjectSelection(); return; }
      const definition = friendlySquadRuntimeDefinition(state, squad.type);
      const remaining = remainingRouteDistance(state, squad);
      const origin = ownedBaseById(state, squad.originBaseId, { includeDestroyed: true });
      const target = state.world.enemyBases.find(base => base.id === squad.targetBaseId);
      const interceptTarget = state.combat.enemies.find(enemy => enemy.id === squad.targetEnemyId && enemy.hp > 0);
      const recoveryItem = (state.world.recoveryItems ?? []).find(item => item.id === squad.targetRecoveryItemId);
      const recoveryTargetName = recoveryItem ? recoveryItemPresentation(recoveryItem).name : null;
      this.contextTitle.textContent = `ALLY // ${definition.name}`;
      const orderLabel = ({ ADVANCE: '進軍', HOLD: '停止', RETREAT: '後退', WITHDRAW: '撤退', RETURN: '帰還' })[squad.order] ?? squad.order;
      const special = definition.type === 'skirmisher'
        ? `軽装敵への攻撃 ×${definition.lightTargetMultiplier}・重装敵 ×${definition.armoredTargetMultiplier}`
        : definition.type === 'heavy'
          ? `${definition.guardRange}m以内の味方損害を${Math.round(definition.guardShare * 100)}%肩代わり`
          : definition.type === 'expedition'
            ? `非戦闘${definition.recoveryDelaySeconds}秒後から毎秒${definition.nonCombatRecoveryPerSecond}HP回復・周囲120mを建設圏化`
            : definition.type === 'siege'
              ? '敵基地への攻撃に特化し、通常敵への火力は低い'
              : definition.type === 'engineer'
                ? `周囲${definition.repairRange}mの設備を最大${definition.repairAmount}HP手動修復・敵施設への攻撃に強い`
                : definition.type === 'artillery'
                  ? `射程${definition.engagementRange}m・半径${definition.splashRadius}mへ最大${definition.maxSplashTargets}体を範囲攻撃`
                  : definition.type === 'command'
                    ? `周囲${definition.auraRange}mの味方へ攻撃+${Math.round(definition.commandAura * 100)}%・移動+${Math.round(definition.speedAura * 100)}%`
                    : definition.type === 'retrieval'
                      ? `現地で${definition.collectionSeconds}秒停止して回収。戦闘力と耐久は非常に低い`
                      : '通常敵と敵基地の両方へ対応する標準部隊';
      if ([FRIENDLY_SQUAD_STATUS.RECOVERING, FRIENDLY_SQUAD_STATUS.READY].includes(squad.status)) {
        const recovery = recoveryPresentation(state, squad);
        const recoveryBase = ownedBaseById(state, squad.recoveryBaseId ?? squad.originBaseId, { includeDestroyed: true });
        const medical = medicalCoverageForSquad(state, squad);
        this.setContextContent(
          squad.status === FRIENDLY_SQUAD_STATUS.READY
            ? recovery.baseHealing
              ? '主要拠点で補給・回復・再編成が完了し、再出撃命令を待っています。'
              : '簡易拠点で再編成が完了し、再出撃命令を待っています。前線でのHP回復には回復施設を利用します。'
            : recovery.baseHealing
              ? '主要拠点へ帰還し、補給による回復と再編成を行っています。'
              : '簡易拠点へ帰還し、再編成を行っています。HP回復には回復施設の範囲内での待機が必要です。',
          [
            ['HP', `${Math.ceil(squad.hp)}/${squad.maxHp}`],
            ['STATUS', squad.status],
            ['BASE', recoveryBase?.name ?? '不明'],
            ['REORG', squad.status === FRIENDLY_SQUAD_STATUS.READY ? '完了' : `${Math.ceil(recovery.reorganizationRemaining)}秒`],
            ['HEAL', recovery.baseHealing ? '主要拠点補給' : medical ? `${medical.definition.name} ${Math.round(medical.distance)}m` : '範囲外']
          ],
          [special, recovery.baseHealing
            ? '主要拠点では帰還部隊へ基礎補給を行います。回復施設は拠点外でも範囲内の全味方部隊を同時に回復します。'
            : '簡易拠点には自動回復機能がありません。回復施設の射程内へ配置してください。']
        );
      } else {
        this.setContextContent(
          squad.order === FRIENDLY_SQUAD_ORDER.HOLD
            ? `指定地点で停止中です。${definition.description}`
            : squad.order === FRIENDLY_SQUAD_ORDER.RETREAT
              ? `選択した道路ルートで後退中です。${definition.description}`
              : squad.order === FRIENDLY_SQUAD_ORDER.WITHDRAW
                ? `現在の任務を破棄し、出撃元へ撤退中です。${definition.description}`
                : squad.missionType === 'RECOVERY' && recoveryItem?.status === RECOVERY_ITEM_STATUS.CARRIED
                  ? `特殊アイテムを確保し、出撃元へ輸送中です。${definition.description}`
                  : squad.missionType === 'RECOVERY' && recoveryItem
                    ? `特殊アイテムの回収地点へ進行中です。${definition.description}`
                    : squad.missionType === 'INTERCEPT' && interceptTarget
                      ? `指定した敵部隊を追跡・迎撃中です。${definition.description}`
                      : squad.targetBaseId
                        ? `敵基地へ進軍中です。${definition.description}`
                        : `任務を終えて出撃元へ帰還中です。${definition.description}`,
          [
            ['HP', `${Math.ceil(squad.hp)}/${squad.maxHp}`],
            ['MEN', String(Math.max(1, Math.ceil((squad.hp / squad.maxHp) * definition.members)))],
            ['ROLE', definition.role],
            ['STATUS', squad.status],
            ['ORDER', orderLabel],
            ['SPEED', `${definition.speed}m/s`],
            ['ENEMY DPS', String(definition.enemyDps)],
            ['BASE DPS', String(definition.baseDps)],
            ['RANGE', Number.isFinite(remaining) ? `${Math.round(remaining)}m` : 'RECALC'],
            ['ORIGIN', origin?.name ?? '不明'],
            ['TARGET', recoveryItem?.status === RECOVERY_ITEM_STATUS.CARRIED
              ? '出撃元へ輸送'
              : recoveryTargetName
                ?? (interceptTarget ? ENEMY_DEFINITIONS[interceptTarget.type]?.name ?? '敵部隊' : null)
                ?? (target ? ENEMY_BASE_DEFINITIONS[target.type]?.name ?? '敵拠点' : squad.order === FRIENDLY_SQUAD_ORDER.WITHDRAW ? '出撃元' : '帰還')]
          ],
          [special]
        );
        if (![FRIENDLY_SQUAD_ORDER.RETURN, FRIENDLY_SQUAD_ORDER.WITHDRAW].includes(squad.order)) {
          if (squad.order !== FRIENDLY_SQUAD_ORDER.HOLD) this.action('停止', () => this.holdSelectedSquad());
          if (squad.order === FRIENDLY_SQUAD_ORDER.HOLD && ((squad.missionTargetBaseId ?? squad.targetBaseId ?? squad.targetEnemyId ?? squad.targetRecoveryItemId) || squad.heldDestinationNodeId)) this.action('移動再開', () => this.beginOrderPlanning(FRIENDLY_ORDER_MODE.RESUME), 'primary');
          if (squad.type === 'engineer') this.action('周辺設備を修復', () => this.mutateAction(draft => this.friendlyForceSystem.repairNearby(draft, squad.id), 'friendly:engineer-repair'), 'primary');
          this.action('後退', () => this.beginOrderPlanning(FRIENDLY_ORDER_MODE.RETREAT));
          this.action('撤退', () => this.beginOrderPlanning(FRIENDLY_ORDER_MODE.WITHDRAW), 'danger');
        }
      }
    } else if (selected.kind === 'enemy') {
      const enemy = state.combat.enemies.find(item => item.id === selected.id);
      if (!enemy || enemy.hp <= 0) { this.clearObjectSelection(); return; }
      const definition = scaleEnemyDefinition(ENEMY_DEFINITIONS[enemy.type] ?? ENEMY_DEFINITIONS.infantry, enemy.level ?? 1);
      const behavior = enemyBehaviorForDefinition(definition, enemy.doctrineKey);
      const doctrine = waveDoctrineDefinition(enemy.doctrineKey);
      const remaining = remainingRouteDistance(state, enemy);
      const targetDefense = enemy.targetDefenseId
        ? state.combat.defenses.find(defense => defense.id === enemy.targetDefenseId && defense.hp > 0)
        : null;
      const targetFieldBase = enemy.targetFieldBaseId ? ownedBaseById(state, enemy.targetFieldBaseId) : null;
      const targetPlayerBase = enemy.targetPlayerBaseId ? ownedBaseById(state, enemy.targetPlayerBaseId) : null;
      const targetSquad = enemy.targetSquadId
        ? (state.combat.friendlySquads ?? []).find(squad => squad.id === enemy.targetSquadId && squad.hp > 0)
        : null;
      const targetName = targetDefense
        ? defenseRuntimeDefinition(targetDefense).name ?? '防衛施設'
        : targetSquad
          ? FRIENDLY_SQUAD_DEFINITIONS[targetSquad.type]?.name ?? '味方部隊'
          : targetPlayerBase?.name ?? targetFieldBase?.name ?? (enemy.targetPlayerBaseId ? '主要拠点' : enemy.targetFieldBaseId ? '簡易拠点' : '都市');
      const summary = targetDefense
        ? `${targetName}を優先目標として進行中です。目標喪失時は性格に従って再経路を選択します。`
        : targetSquad
          ? `${targetName}を追跡中です。部隊が移動すると次の道路節点で追跡経路を更新します。`
          : enemy.targetPlayerBaseId || enemy.targetFieldBaseId
            ? `${targetName}への襲撃を優先しています。都市へ直行する敵とは異なる防衛線が必要です。`
            : '都市へ進行中です。経路は敵の性格と波の作戦に応じて選択されます。';
      const routeMode = ({ FLANK: '側面迂回', EVASIVE: '危険回避', BREACH: '正面突破', SABOTAGE: '施設潜入', RAID: '拠点襲撃', HUNT: '部隊追跡', SUPPORT: '支援同行', GUARD: '護衛進軍', COMMAND: '指揮進軍', DIRECT: '最短進軍' })[enemy.path?.routeMode ?? behavior.routeMode] ?? definition.routeLabel ?? '状況判断';
      const detour = Number(enemy.path?.detourPercent) > 0 ? `+${enemy.path.detourPercent}%` : '—';
      this.contextTitle.textContent = `TARGET // ${definition.name}`;
      this.setContextContent(summary, [
        ['LEVEL', `Lv.${enemy.level ?? 1}`],
        ['HP', `${Math.ceil(enemy.hp)}/${enemy.maxHp}`],
        ['RANGE', Number.isFinite(remaining) ? `${Math.round(remaining)}m` : 'RECALC'],
        ['PERSONA', behavior.personalityLabel],
        ['TACTIC', doctrine.label],
        ['ROUTE', routeMode],
        ['DETOUR', detour],
        ['DAMAGE', String(definition.cityDamage)],
        ['OBJECTIVE', targetName]
      ], [behavior.description, `基本目標：${definition.objectiveLabel ?? '都市'}`]);
      const intercept = this.action('この敵部隊へ派兵', () => this.openDeployment?.({ kind: 'enemy', id: enemy.id }), 'primary');
      intercept.disabled = enemy.departDelay > 0 || typeof this.openDeployment !== 'function';
    } else if (selected.kind === 'explorationSite') {
      const site = (state.world.explorationSites ?? []).find(item => item.id === selected.id);
      if (!site || site.status === 'CLEARED') { this.clearObjectSelection(); return; }
      const presentation = explorationSitePresentation(site);
      const node = state.world.roadGraph.nodeById.get(site.nodeId);
      const gap = state.player.worldPosition && node ? distance(state.player.worldPosition, node) : Infinity;
      this.contextTitle.textContent = `EXPLORE // ${presentation.name}`;
      this.setContextContent(
        presentation.description,
        [
          ['DIST', Number.isFinite(gap) ? `${Math.round(gap)}m` : 'NO GPS'],
          ['ENTRY', `${EXPLORATION_INTERACTION_RANGE_METERS}m`],
          ['STATUS', site.interactionActive ? 'SCANNING' : 'READY'],
          ['PROGRESS', `${Math.floor(site.progress ?? 0)}/${site.requiredSeconds}s`],
          ['REWARD', bundleText(site.reward ?? {})]
        ],
        [site.type === 'enemySource' ? '周辺にこの発生源から出撃した敵がいる場合、無力化を開始できません。' : '調査中に範囲外へ離れても進捗は保持されます。']
      );
      const action = this.action(site.interactionActive ? '調査進行中' : '現地調査を開始', () => this.mutateAction(draft => this.explorationSystem.beginInteraction(draft, site.id), 'exploration:begin'), 'primary');
      action.disabled = site.interactionActive || gap > EXPLORATION_INTERACTION_RANGE_METERS;
    } else if (selected.kind === 'frontier') {
      const source = (state.world.frontierSources ?? []).find(item => item.id === selected.id);
      if (!source || source.status === 'CLEARED') { this.clearObjectSelection(); return; }
      const presentation = frontierPresentation(source);
      const entry = state.world.roadGraph.nodeById.get(source.entryNodeId);
      const sourceDistance = entry ? distance(entry, source.point) : Infinity;
      const playerDistance = state.player.worldPosition ? distance(state.player.worldPosition, source.point) : Infinity;
      this.contextTitle.textContent = `FRONTIER // ${presentation.title}`;
      this.setContextContent(
        presentation.stage === 'DISTANT'
          ? '道路網の外側から断続的な敵性反応を検出しています。実際にこの方向へ移動すると情報精度が上がります。'
          : '敵性反応の方向と規模が絞り込まれています。道路を探索して発生源を特定してください。',
        [
          ['SIGNAL', presentation.stage],
          ['THREAT', `T${presentation.threat}`],
          ['TYPE', presentation.profileLabel],
          ['SOURCE', Number.isFinite(sourceDistance) ? `約${Math.round(sourceDistance)}m先` : '不明'],
          ['YOU', Number.isFinite(playerDistance) ? `${Math.round(playerDistance)}m` : 'NO GPS'],
          ['WAVES', String(source.wavesSent ?? 0)]
        ],
        ['未確認地域から敵部隊が侵入します。発生源は同じ世界座標に固定され、道路を探索して近づいても遠ざかりません。']
      );
    } else if (selected.kind === 'enemyBase') {
      const base = state.world.enemyBases.find(item => item.id === selected.id);
      if (!base?.alive) { this.clearObjectSelection(); return; }
      const definition = ENEMY_BASE_DEFINITIONS[base.type];
      this.contextTitle.textContent = definition.name;
      const attackers = (state.combat.friendlySquads ?? []).filter(squad => squad.targetBaseId === base.id).length;
      this.context.classList?.add('is-target-mode');
      this.setContextContent(
        '選択中の敵拠点です。攻撃部隊は道路上を移動し、この拠点へ到達後に攻撃を開始します。',
        [['HP', `${Math.ceil(base.hp)}/${base.maxHp}`], ['LEVEL', `Lv.${base.level ?? 1}`], ['ATTACKERS', String(attackers)], ['STATUS', attackers ? 'UNDER ATTACK' : 'HOSTILE']]
      );
      const deploy = this.action(attackers ? '追加部隊を派兵' : 'この敵拠点へ派兵', () => this.openDeployment?.({ kind: 'enemyBase', id: base.id }), 'primary');
      deploy.disabled = typeof this.openDeployment !== 'function';
    } else if (selected.kind === 'defense') {
      this.context.classList?.add('is-defense-mode');
      const defense = state.combat.defenses.find(item => item.id === selected.id);
      if (!defense) { this.clearObjectSelection(); return; }
      if (this.defensePanelDefenseId !== defense.id) {
        this.defensePanelDefenseId = defense.id;
        this.defensePanelMode = 'summary';
        this.pendingDefenseRemovalId = null;
      }
      const runtime = defenseRuntimeDefinition(defense);
      const presentation = defensePresentation(defense.isGate ? 'gate' : defense.type, runtime);
      const survey = defense.type === 'survey' ? surveyFacilityPresentation(state, defense) : null;
      const operatingStatus = defense.disabledTimer > 0
          ? `停止 ${defense.disabledTimer.toFixed(1)}秒`
          : survey
            ? survey.statusLabel
            : defense.cooldown > 0 ? `再装填 ${defense.cooldown.toFixed(1)}秒` : defense.isGate ? '封鎖中' : '稼働';
      const upgrade = defenseUpgradeStatus(state, defense);
      const surveyMetrics = survey ? [
        ['NEXT', `${survey.nextScanSeconds}秒`],
        ['EXPANDED', `${survey.completedCount}区域`],
        ['REMAIN', String(survey.remainingChunks)],
        ['COMM', survey.lastConnectionAt > 0 ? '成功' : survey.lastTransport === 'CACHE' ? 'キャッシュ' : '未成功'],
        ['LINK', survey.lastEndpoint ? `${survey.lastEndpoint} ${{ SANDBOX_JSONP: '安全JSONP', GET: 'GET', POST: 'POST', CACHE: 'キャッシュ' }[survey.lastTransport] ?? survey.lastTransport ?? ''}`.trim() : '未成功'],
        ...(survey.lastConnectionAt > 0 ? [['RESPONSE', `${survey.lastResponseElements}件`]] : []),
        ...(survey.lastSuccessAt > 0 ? [['ROADS', String(survey.lastRoadCount)]] : []),
        ...(survey.errorCount > 0 ? [['RETRY', String(survey.errorCount)]] : [])
      ] : [];
      const notes = presentation ? ['強化しても損傷率は維持され、全回復はしません。'] : [];
      if (survey) {
        notes.push('遠隔測量済み区域へプレイヤーが実際に入ると、現地イベントや敵発生源の正確な情報が解禁されます。');
        if (survey.lastConnectionAt <= 0) notes.push('この施設にはまだ道路サーバーとの通信成功記録がありません。COMMが未成功のままなら「今すぐ測量」で再試行してください。');
        else if (survey.lastSuccessAt <= 0) notes.push('道路サーバーとの通信は成功していますが、道路の解析・統合はまだ完了していません。');
        if (survey.lastError) notes.push(`直近の${survey.lastErrorStage === 'PROCESSING' ? '道路処理' : '通信'}失敗：${survey.lastError}`);
      }

      this.context.classList?.add(`is-defense-${this.defensePanelMode}`);
      if (this.defensePanelMode === 'details') {
        this.contextTitle.textContent = `DETAIL // ${runtime.name}`;
        this.setDefenseDetails(presentation, notes);
        this.action('施設情報へ戻る', () => this.setDefensePanelMode('summary', defense.id), 'primary');
      } else if (this.defensePanelMode === 'upgrade') {
        this.contextTitle.textContent = `UPGRADE // ${runtime.name}`;
        this.contextText.textContent = '';
        this.appendDefenseUpgradePreview(state, defense, upgrade);
        this.action('戻る', () => this.setDefensePanelMode('summary', defense.id));
        const confirmUpgrade = this.action(upgrade.atMax ? '最高Tier' : upgrade.ok ? '強化を確定' : '強化条件を満たしていません', () => {
          this.defensePanelMode = 'summary';
          this.mutateAction(draft => this.civilizationSystem.progression.upgradeDefense(draft, defense.id), 'defense:upgrade');
        }, 'primary');
        confirmUpgrade.disabled = !upgrade.ok;
      } else {
        this.contextTitle.textContent = `${runtime.name} // Tier ${defense.tier ?? 0}`;
        this.setContextMetrics([
          ['HP', `${Math.ceil(defense.hp)}/${defense.maxHp}`],
          ['STATUS', operatingStatus],
          ['TIER', String(defense.tier ?? 0)],
          ...(presentation?.metrics ?? []).filter(([label]) => label !== 'HP'),
          ...surveyMetrics
        ]);
        this.action('説明', () => this.setDefensePanelMode('details', defense.id));
        const repair = this.action(defense.hp >= defense.maxHp ? '修理不要' : '修理', () => this.mutateAction(draft => this.civilizationSystem.progression.repairDefense(draft, defense.id), 'defense:repair'));
        repair.disabled = defense.hp >= defense.maxHp;
        if (survey) {
          const surveyBusy = ['QUEUED', 'LOADING'].includes(survey.status);
          const surveyComplete = survey.status === 'COMPLETE' && survey.remainingChunks <= 0;
          const scan = this.action(
            surveyBusy ? '測量通信中' : surveyComplete ? '範囲内取得完了' : '今すぐ測量',
            () => {
              const result = this.requestSurvey?.(defense.id) ?? { ok: false, reason: '測量通信を開始できません。' };
              this.notifications.show(result.ok ? result.message ?? '道路測量を開始しました。' : result.reason ?? '道路測量を開始できません。');
              if (result.ok) this.persist?.();
              this.renderContext();
            },
            'primary'
          );
          scan.disabled = defense.hp <= 0 || defense.disabledTimer > 0 || surveyBusy || surveyComplete || typeof this.requestSurvey !== 'function';
        }
        const upgradeButton = this.action(upgrade.atMax ? '最高Tier' : '強化', () => this.setDefensePanelMode('upgrade', defense.id), 'primary');
        upgradeButton.disabled = upgrade.atMax;
        if (defense.kind === 'barrier' && !defense.isGate) {
          const gate = this.action((state.civilization.level ?? 0) >= 2 ? '門へ変換' : '門は文明Lv.2で解禁', () => this.mutateAction(draft => this.civilizationSystem.progression.convertBarrierToGate(draft, defense.id), 'defense:gate'));
          gate.disabled = (state.civilization.level ?? 0) < 2 || defense.hp <= 0;
        }
        const removalPending = this.pendingDefenseRemovalId === defense.id;
        this.action(
          removalPending ? '撤去を確定（資源返還なし）' : '撤去',
          () => this.requestDefenseRemoval(defense.id),
          'danger'
        );
        if (removalPending) this.action('撤去を中止', () => this.cancelDefenseRemoval());
      }
    } else {
      this.contextTitle.textContent = '都市';
      this.setContextContent('防衛対象となる中枢都市です。', [['HP', `${Math.ceil(state.world.city.hp)}/${state.world.city.maxHp}`], ['CIV', String(state.civilization.level)], ['KILLS', String(state.statistics.kills ?? 0)]]);
    }
    setVisible(this.context, true);
  }

  update(state = this.store.snapshot()) {
    this.cityHp.textContent = `${Math.ceil(state.world.city?.hp ?? 0)}/${Math.ceil(state.world.city?.maxHp ?? 0)}`;
    this.enemyCount.textContent = state.combat.enemies.length;
    this.civilizationLevel.textContent = state.civilization.level;
    const affordability = this.affordabilitySignature(state);
    if (affordability !== this.toolAffordabilitySignature) this.renderTools(state);
    if (this.selectedTool !== 'select') this.refreshBuildPlacement(false, state);
    if (this.orderPlanning) {
      const squad = this.selectedFriendlySquad(state);
      const startNodeId = squad ? commandStartNodeId(state, squad) : null;
      if (!squad) this.cancelOrderPlanning();
      else if (startNodeId !== this.orderPlanning.startNodeId) this.rebuildOrderRoutes(state);
    }
    if (!this.context.hidden) this.renderContext(state);
  }
}
