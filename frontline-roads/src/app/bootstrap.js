import { APP_VERSION, LifecycleState, ROAD_CONFIG } from '../core/constants.js';
import { EventBus } from '../core/event-bus.js';
import { createInitialState } from '../core/state-schema.js';
import { StateStore } from '../core/state-store.js';
import { cloneRuntimeState } from '../core/runtime-state.js';
import { LifecycleController } from './lifecycle.js';
import { GeolocationService } from '../location/geolocation-service.js';
import { latLonToXY } from '../location/location-privacy.js';
import { OverpassClient } from '../roads/overpass-client.js';
import { RoadService } from '../roads/road-service.js';
import { RoadWorldManager } from '../roads/road-world-manager.js';
import { chunkForWorldPoint, chunkFullyInsideCircle, createRoadChunkState, ensureRoadChunkState, graphCoveredChunkIds, parseChunkId } from '../roads/world-chunk-grid.js';
import { normalizeRuntimeState } from '../core/state-normalizer.js';
import { BasePlacementService } from '../base/base-placement-service.js';
import { hasEstablishedHomeBase } from '../base/base-state.js';
import { SaveRepository } from '../persistence/save-repository.js';
import { RoadChunkCache } from '../persistence/road-chunk-cache.js';
import { Camera } from '../rendering/camera.js';
import { Renderer } from '../rendering/renderer.js';
import { MapInput } from '../ui/map-input.js';
import { BasePlacementScreen } from '../ui/base-placement-screen.js';
import { Notifications } from '../ui/notifications.js';
import { queryRequired, setVisible } from '../ui/dom.js';
import { createDevelopmentDependencies } from './development-fixture.js';
import { initializeCombatState } from '../combat/combat-initializer.js';
import { CombatSystem } from '../combat/combat-system.js';
import { BuildSystem } from '../combat/build-system.js';
import { CombatUi } from '../ui/combat-ui.js';
import { CivilizationUi } from '../ui/civilization-ui.js';
import { DeploymentUi } from '../ui/deployment-ui.js';
import { BaseCommandUi } from '../ui/base-command-ui.js';
import { MenuUi } from '../ui/menu-ui.js';
import { RadarPreferences } from '../ui/radar-preferences.js';
import { GameLoop } from './game-loop.js';
import { OfflineSimulator } from '../persistence/offline-simulator.js';
import { CivilizationSystem } from '../civilization/civilization-system.js';
import { RESOURCE_LABELS } from '../civilization/data.js';
import { TabCoordinator } from '../persistence/tab-coordinator.js';
import { registerPwa } from './pwa.js';

class FrontlineRoadsApp {
  constructor() {
    this.events = new EventBus();
    this.saveRepository = new SaveRepository();
    this.store = new StateStore(createInitialState(), this.events, { cloneState: cloneRuntimeState });
    this.lifecycle = new LifecycleController(this.store);
    const fixtureRequested = new URLSearchParams(location.search).get('devFixture') === '1';
    const localFixtureAllowed = ['localhost', '127.0.0.1', '::1'].includes(location.hostname) || location.protocol === 'file:' || globalThis.__FRONTLINE_TEST_FIXTURE__ === true;
    const developmentMode = fixtureRequested && localFixtureAllowed;
    const development = developmentMode ? createDevelopmentDependencies() : null;
    this.geolocation = development?.geolocation ?? new GeolocationService();
    this.roadService = new RoadService(new OverpassClient({
      fetchImpl: development?.fetchImpl ?? globalThis.fetch
    }));
    this.roadChunkCache = new RoadChunkCache();
    this.camera = new Camera();
    this.renderer = new Renderer(queryRequired('#mapCanvas'), this.camera);
    this.renderer.setStateProvider(() => this.store.renderView());
    this.renderer.bindEvents(this.events);
    this.radarPreferences = new RadarPreferences({ onChange: preferences => this.renderer.setPreferences(preferences) });
    this.baseScreen = new BasePlacementScreen();
    this.notifications = new Notifications(queryRequired('#notification'));
    this.combatSystem = new CombatSystem(this.events);
    this.civilizationSystem = new CivilizationSystem(this.events);
    this.offlineSimulator = new OfflineSimulator({
      combatSystem: new CombatSystem(null),
      civilizationSystem: new CivilizationSystem(null)
    });
    this.buildSystem = new BuildSystem(this.events);
    this.combatUi = new CombatUi({
      store: this.store,
      buildSystem: this.buildSystem,
      civilizationSystem: this.civilizationSystem,
      explorationSystem: this.combatSystem.explorationSystem,
      recoverySystem: this.combatSystem.recoverySystem,
      friendlyForceSystem: this.combatSystem.friendlyForceSystem,
      camera: this.camera,
      renderer: this.renderer,
      notifications: this.notifications,
      persist: () => this.persist(),
      openDeployment: target => {
        if (target?.kind === 'enemyBase') this.deploymentUi?.openForEnemyBase(target.id);
        if (target?.kind === 'enemy') this.deploymentUi?.openForEnemy(target.id);
        if (target?.kind === 'recoveryItem') this.deploymentUi?.openForRecoveryItem(target.id);
      },
      requestSurvey: defenseId => this.roadWorld?.requestSurvey(defenseId)
    });
    this.roadWorld = new RoadWorldManager({
      roadService: this.roadService,
      cache: this.roadChunkCache,
      store: this.store,
      renderer: this.renderer,
      onGraphChanged: () => {
        this.store.transaction(state => {
          this.combatSystem.frontierSystem.reconcile(state);
          this.combatSystem.explorationSystem.reconcile(state);
        }, 'world:graph-expanded');
        this.combatUi.refreshBuildPlacement(true);
        this.combatUi.update();
        if (this.store.read(state => state.lifecycle) === LifecycleState.PLAYING) this.persist({ notify: false });
      },
      onStatus: status => {
        if (status.type === 'loaded' || status.type === 'error') this.notifications.show(status.text, 4500);
      }
    });
    this.deploymentUi = new DeploymentUi({
      store: this.store,
      friendlyForceSystem: this.combatSystem.friendlyForceSystem,
      notifications: this.notifications,
      persist: () => this.persist()
    });
    this.baseCommandUi = new BaseCommandUi({
      store: this.store,
      playerBaseSystem: this.civilizationSystem.playerBases,
      fieldBaseSystem: this.civilizationSystem.fieldBases,
      renderer: this.renderer,
      notifications: this.notifications,
      persist: () => this.persist()
    });
    this.civilizationUi = new CivilizationUi({
      store: this.store,
      civilizationSystem: this.civilizationSystem,
      notifications: this.notifications,
      persist: () => this.persist()
    });
    this.menuUi = new MenuUi({
      onSave: () => this.persist(),
      onReset: () => this.reset(),
      notifications: this.notifications
    });
    this.gameLoop = new GameLoop({
      store: this.store,
      combatSystem: this.combatSystem,
      civilizationSystem: this.civilizationSystem,
      renderer: this.renderer,
      saveRepository: this.saveRepository,
      onUiUpdate: () => {
        const view = this.store.uiSnapshot();
        this.combatUi.update(view);
        this.deploymentUi.update(view);
        this.baseCommandUi.update(view);
        this.civilizationUi.update(view);
        this.roadWorld.considerSurveyFacilities();
      },
      onError: error => this.notifications.show(error?.message ?? '保存に失敗しました。'),
      onSaveDisabled: () => this.updateStorageUi(),
      getPerformanceProfile: () => this.renderer.getPerformanceProfile()
    });
    this.selection = null;
    this.basePlacement = null;
    this.roadLoadController = null;
    this.startupGeneration = 0;
    this.stopLocationWatch = null;
    this.criticalSaveQueued = false;
    this.tabCoordinator = new TabCoordinator();
    this.tabCoordinator.start(primary => this.handlePrimaryChange(primary));
    this.mapInput = new MapInput(queryRequired('#mapCanvas'), this.camera, {
      onViewChanged: () => { this.renderer.invalidateStatic(); this.renderer.render(); },
      onTap: worldPoint => this.handleMapTap(worldPoint)
    });
    this.bindControls();
    this.bindEvents();
    this.updateStorageUi();
  }

  updateStorageUi() {
    const available = this.saveRepository.isAvailable();
    this.menuUi.setSaveAvailable(available);
    const warning = queryRequired('#storageWarning');
    warning.textContent = available ? '' : '保存機能を利用できません。このタブを閉じると進行状況は失われます。';
    setVisible(warning, !available);
  }

  handleFatal(error) {
    console.error(error);
    document.body.dataset.fatal = 'true';
    try {
      const message = error?.message ? `起動に失敗しました：${error.message}` : '起動に失敗しました。ページを再読み込みしてください。';
      this.baseScreen.showError(message);
      queryRequired('#lifecycleText').textContent = 'ERROR';
    } catch {
      document.body.textContent = 'FRONTLINE ROADSの起動に失敗しました。ページを再読み込みしてください。';
    }
  }

  bindControls() {
    queryRequired('#confirmBase').addEventListener('click', () => this.confirmBase());
    queryRequired('#retryLocation').addEventListener('click', () => this.startNewGame());
    queryRequired('#zoomIn').addEventListener('click', () => {
      this.camera.zoomAt(1.25, { x: this.camera.viewportWidth / 2, y: this.camera.viewportHeight / 2 });
      this.renderer.render();
    });
    queryRequired('#zoomOut').addEventListener('click', () => {
      this.camera.zoomAt(0.8, { x: this.camera.viewportWidth / 2, y: this.camera.viewportHeight / 2 });
      this.renderer.render();
    });
    queryRequired('#recenter').addEventListener('click', () => this.recenterMap());
    queryRequired('#gameZoomIn').addEventListener('click', () => {
      this.camera.zoomAt(1.25, { x: this.camera.viewportWidth / 2, y: this.camera.viewportHeight / 2 });
      this.renderer.render();
    });
    queryRequired('#gameZoomOut').addEventListener('click', () => {
      this.camera.zoomAt(0.8, { x: this.camera.viewportWidth / 2, y: this.camera.viewportHeight / 2 });
      this.renderer.render();
    });
    queryRequired('#focusSelectedBase').addEventListener('click', () => {
      if (!this.baseCommandUi.focusCurrentBase()) this.notifications.show('表示できる拠点がありません。');
    });
    queryRequired('#focusPlayer').addEventListener('click', () => this.recenterMap());
    queryRequired('#offlineClose').addEventListener('click', () => setVisible(queryRequired('#offlineSummary'), false));
    document.addEventListener('visibilitychange', () => this.handleVisibilityChange());
  }

  bindEvents() {
    this.events.on('message', payload => this.notifications.show(payload.text));
    this.events.on('lifecycle:changed', ({ current }) => {
      document.documentElement.dataset.lifecycle = current;
      queryRequired('#lifecycleText').textContent = current;
    });
    this.events.on('civilization:level-up', () => { this.civilizationUi.render(); this.baseCommandUi.render(); });
    this.events.on('combat:defense-destroyed', () => this.queueCriticalSave());
    this.events.on('civilization:building-destroyed', () => this.queueCriticalSave());
    this.events.on('combat:city-defeated', () => this.queueCriticalSave());
  }

  queueCriticalSave() {
    if (this.criticalSaveQueued) return;
    this.criticalSaveQueued = true;
    const schedule = globalThis.queueMicrotask ?? (callback => Promise.resolve().then(callback));
    schedule(() => {
      this.criticalSaveQueued = false;
      this.persist({ notify: false });
    });
  }

  async start() {
    queryRequired('#versionText').textContent = APP_VERSION;
    this.lifecycle.boot();
    const loadWarning = this.saveRepository.consumeWarning();
    const saved = this.saveRepository.load();
    if (saved && hasEstablishedHomeBase(saved) && saved.world.roadGraph) {
      const handled = await this.restoreSavedGame(saved, loadWarning);
      if (handled) return;
    }
    this.lifecycle.requireLocation();
    await this.startNewGame();
    const warning = loadWarning ?? this.saveRepository.consumeWarning();
    if (warning) this.notifications.show(warning, 6500);
  }

  restoreValidatedSave(saved) {
    saved.lifecycle = LifecycleState.LOAD_SAVE;
    this.store.replace(saved, 'save:loaded');
    this.store.transaction(draft => normalizeRuntimeState(draft), 'save:rehydrated', { validate: true });
  }

  resetAfterInvalidSave() {
    this.saveRepository.quarantineCurrent('保存データを復元できなかったため、新しいゲームとして開始します。破損データは無効化しました。');
    this.store.replace(createInitialState(), 'save:recovery-reset');
    this.lifecycle = new LifecycleController(this.store);
    this.lifecycle.boot();
    this.notifications.show('保存データを復元できなかったため、新しいゲームとして開始します。', 6500);
  }

  async restoreSavedGame(saved, loadWarning = null) {
    try {
      this.restoreValidatedSave(saved);
    } catch (error) {
      console.error('Save validation failed', error);
      this.resetAfterInvalidSave();
      return false;
    }

    try {
      await this.roadWorld.restoreCachedChunks();
    } catch (error) {
      console.warn('Optional road cache restore failed', error);
      this.notifications.show('道路キャッシュを復元できませんでした。保存済みの進行データで続行します。', 5000);
    }

    let offlineSummary = null;
    if (this.tabCoordinator.isPrimary()) {
      const beforeOffline = this.store.snapshot();
      const lastSavedAt = this.store.read(state => state.runtime.lastSavedAt || Date.now());
      const elapsedSeconds = Math.max(0, (Date.now() - lastSavedAt) / 1000);
      try {
        this.store.transaction(draft => {
          offlineSummary = this.offlineSimulator.simulate(draft, elapsedSeconds);
        }, 'offline:simulated', { validate: true });
      } catch (error) {
        console.error('Offline simulation failed', error);
        this.store.replace(beforeOffline, 'offline:rollback');
        this.notifications.show('不在中の進行計算を適用できませんでした。保存時点から再開します。', 6000);
      }
    }

    try {
      this.store.transition(LifecycleState.PLAYING);
      if (this.tabCoordinator.isPrimary()) this.persist({ notify: false });
      this.openSavedGame();
      this.showOfflineSummary(offlineSummary);
      if (loadWarning) this.notifications.show(loadWarning, 6500);
      return true;
    } catch (error) {
      console.error('Saved game UI startup failed', error);
      this.handleFatal(error);
      return true;
    }
  }

  async startNewGame() {
    if (!this.tabCoordinator.isPrimary()) {
      this.baseScreen.showError('別のタブがゲーム進行を担当しています。そちらを閉じると、このタブで開始できます。');
      return;
    }
    const generation = ++this.startupGeneration;
    this.roadLoadController?.abort();
    this.roadLoadController = new AbortController();
    this.selection = null;
    this.renderer.setSelection(null);
    this.baseScreen.showLoading('位置情報を取得しています…');

    try {
      const lifecycle = this.store.read(state => state.lifecycle);
      if ([LifecycleState.ERROR, LifecycleState.ROAD_LOADING, LifecycleState.BASE_SELECTION].includes(lifecycle)) {
        this.store.transition(LifecycleState.LOCATION_REQUIRED);
      }
      const currentLocation = await this.geolocation.getCurrentPosition();
      if (generation !== this.startupGeneration) return;
      this.store.transaction(draft => {
        draft.player.currentPosition = { lat: currentLocation.lat, lon: currentLocation.lon };
        draft.player.locationAccuracy = currentLocation.accuracy;
        draft.player.locationUpdatedAt = currentLocation.timestamp ?? Date.now();
        draft.runtime.lastError = null;
      }, 'location:resolved');
      this.lifecycle.startRoadLoading();
      this.baseScreen.showLoading('現在地から1km圏内の道路を読み込んでいます…');

      const graph = await this.roadService.loadAround(currentLocation, {
        signal: this.roadLoadController.signal,
        onAttempt: ({ index, total, transport, attempt, totalAttempts }) => this.baseScreen.showLoading(`道路サーバーへ接続しています… ${transport} (${index}/${total}, 試行 ${attempt}/${totalAttempts})`)
      });
      if (generation !== this.startupGeneration) return;
      this.store.transaction(draft => {
        draft.world.roadGraph = graph;
        const integratedChunkIds = graphCoveredChunkIds(graph);
        const loadedChunkIds = integratedChunkIds.filter(id => chunkFullyInsideCircle(
          parseChunkId(id),
          { x: 0, y: 0 },
          ROAD_CONFIG.initialRetentionRadiusMeters
        ));
        const refreshChunkIds = integratedChunkIds.filter(id => !loadedChunkIds.includes(id));
        const playerPoint = latLonToXY(currentLocation.lat, currentLocation.lon, graph.center);
        const observedChunkId = chunkForWorldPoint(playerPoint).id;
        draft.world.roadChunks = createRoadChunkState({
          initialLoadedChunkIds: loadedChunkIds,
          initialIntegratedChunkIds: integratedChunkIds,
          initialRefreshChunkIds: refreshChunkIds,
          initialObservedChunkIds: loadedChunkIds.includes(observedChunkId) ? [observedChunkId] : []
        });
      }, 'roads:loaded');
      this.basePlacement = new BasePlacementService(graph, currentLocation);
      this.renderer.setGraph(graph);
      this.renderer.setHomeBase(null);
      this.renderer.fitGraph();
      this.lifecycle.startBaseSelection();
      this.baseScreen.showSelection(null);
    } catch (error) {
      if (generation !== this.startupGeneration || error?.name === 'AbortError') return;
      this.store.setError(error);
      this.baseScreen.showError([error?.message ?? '初期化に失敗しました。', error?.details ? `診断: ${error.details}` : null].filter(Boolean).join('\n'));
    }
  }

  handleMapTap(worldPoint) {
    const lifecycle = this.store.read(state => state.lifecycle);
    if (lifecycle === LifecycleState.PLAYING) {
      this.combatUi.handleMapTap(worldPoint);
      return;
    }
    if (lifecycle !== LifecycleState.BASE_SELECTION || !this.basePlacement) return;
    const tolerance = 24 / this.camera.scale;
    const selection = this.basePlacement.findNearestRoad(worldPoint, tolerance);
    this.selection = selection;
    this.renderer.setSelection(selection);
    this.renderer.render();
    this.baseScreen.showSelection(selection);
  }

  confirmBase() {
    if (!this.tabCoordinator.isPrimary()) {
      this.notifications.show('別のタブがゲーム進行を担当しています。');
      return;
    }
    if (!this.selection?.valid || !this.basePlacement) return;
    try {
      this.lifecycle.startInitialization();
      const { graph, homeBase } = this.basePlacement.establishHomeBase(this.selection);
      this.store.transaction(draft => {
        draft.world.roadGraph = graph;
        draft.world.roadChunks = ensureRoadChunkState(draft.world);
        draft.world.homeBase = homeBase;
        initializeCombatState(draft);
      }, 'base:established');
      this.lifecycle.startPlaying();
      this.persist({ notify: false });
      this.renderer.setGraph(graph);
      this.renderer.setSelection(null);
      this.renderer.setHomeBase(homeBase);
      this.renderer.render();
      this.baseScreen.hide();
      setVisible(queryRequired('#playingHud'), true);
      queryRequired('#baseSummary').textContent = `拠点設置完了：初回現在地から約${Math.round(homeBase.selectedDistanceMeters)}m`;
      this.combatUi.update();
      this.baseCommandUi.update();
      this.civilizationUi.updateSummary();
      this.startRuntime();
      this.notifications.show('拠点を設置しました。移動すると周辺道路を順次偵察し、MAPへ追加します。');
    } catch (error) {
      this.store.setError(error);
      this.baseScreen.showError(error?.message ?? '拠点の設置に失敗しました。');
    }
  }

  restoreEstablishedGameUi({ fitGraph = false } = {}) {
    const state = this.store.snapshot();
    if (!hasEstablishedHomeBase(state) || !state.world.roadGraph) return false;
    this.renderer.setGraph(state.world.roadGraph);
    this.renderer.setHomeBase(state.world.homeBase);
    if (fitGraph) this.renderer.fitGraph();
    this.baseScreen.hide();
    setVisible(queryRequired('#playingHud'), true);
    queryRequired('#baseSummary').textContent = `保存済み拠点：初回現在地から約${Math.round(state.world.homeBase.selectedDistanceMeters ?? 0)}m`;
    this.combatUi.update();
    this.baseCommandUi.update();
    this.civilizationUi.updateSummary();
    this.renderer.render();
    return true;
  }

  openSavedGame() {
    this.restoreEstablishedGameUi({ fitGraph: true });
    this.startRuntime();
  }

  recenterMap() {
    const lifecycle = this.store.read(state => state.lifecycle);
    const player = this.store.read(state => state.player.worldPosition);
    if (lifecycle === LifecycleState.PLAYING && player) {
      this.renderer.centerOn(player);
      return;
    }
    this.renderer.fitGraph();
  }

  startLocationTracking() {
    this.stopLocationWatch?.();
    this.stopLocationWatch = this.geolocation.watchPosition(locationValue => {
      this.store.transaction(state => {
        state.player.currentPosition = { lat: locationValue.lat, lon: locationValue.lon };
        state.player.locationAccuracy = locationValue.accuracy;
        state.player.locationUpdatedAt = locationValue.timestamp ?? Date.now();
        state.player.worldPosition = latLonToXY(locationValue.lat, locationValue.lon, state.world.roadGraph.center);
      }, 'location:watch');
      this.renderer.render();
      this.roadWorld.considerLocation(locationValue);
    }, error => this.notifications.show(`位置追跡：${error.message}`));
  }

  showOfflineSummary(summary) {
    const element = queryRequired('#offlineSummary');
    if (!summary) { setVisible(element, false); return; }
    const minutes = Math.round(summary.simulatedSeconds / 60);
    const resourceText = Object.entries(summary.resources ?? {})
      .map(([key, value]) => `${RESOURCE_LABELS[key] ?? key} ${value > 0 ? '+' : ''}${value}`)
      .join('・');
    const parts = [`${minutes}分進行`, `撃破 ${summary.kills}`, `都市被害 ${summary.cityDamage}`];
    if (resourceText) parts.push(resourceText);
    if (summary.defensesLost > 0) parts.push(`防衛設備損失 ${summary.defensesLost}`);
    if (summary.buildingsLost > 0) parts.push(`集落施設損失 ${summary.buildingsLost}`);
    if (summary.civilizationAdvanced > 0) parts.push(`文明 +${summary.civilizationAdvanced}`);
    if (summary.capped) parts.push('長時間分は上限適用');
    queryRequired('#offlineText').textContent = parts.join('・');
    setVisible(element, true);
  }

  persist({ notify = true } = {}) {
    if (!this.tabCoordinator.isPrimary() || !this.saveRepository.isAvailable()) {
      this.updateStorageUi();
      return false;
    }
    try {
      const savedAt = this.saveRepository.saveDetachedState(this.store.snapshot());
      this.store.transaction(state => { state.runtime.lastSavedAt = savedAt; }, 'save:timestamp');
      this.updateStorageUi();
      return true;
    } catch (error) {
      this.updateStorageUi();
      if (notify) this.notifications.show(error?.message ?? '保存に失敗しました。');
      return false;
    }
  }

  startRuntime() {
    if (!this.tabCoordinator.isPrimary()) {
      if (this.store.read(state => state.lifecycle) === LifecycleState.PLAYING) {
        this.lifecycle.pause();
        this.store.transaction(state => { state.runtime.pauseReason = 'tab'; }, 'runtime:pause-tab');
      }
      this.notifications.show('別のタブが進行を担当しています。このタブは閲覧専用です。');
      return;
    }
    if (document.hidden) {
      if (this.store.read(state => state.lifecycle) === LifecycleState.PLAYING) {
        this.lifecycle.pause();
        this.store.transaction(state => { state.runtime.pauseReason = 'visibility'; }, 'runtime:pause-visibility');
      }
      return;
    }
    this.startLocationTracking();
    this.gameLoop.start();
  }

  pauseRuntime(reason, { save = true } = {}) {
    const lifecycle = this.store.read(state => state.lifecycle);
    if (lifecycle === LifecycleState.PLAYING) this.lifecycle.pause();
    this.store.transaction(state => { state.runtime.pauseReason = reason; }, `runtime:pause-${reason}`);
    this.gameLoop.stop({ save: save && this.tabCoordinator.isPrimary() });
    this.stopLocationWatch?.();
    this.stopLocationWatch = null;
    this.criticalSaveQueued = false;
  }

  refreshFromSavedStateForTakeover() {
    const saved = this.saveRepository.load();
    if (!saved || !hasEstablishedHomeBase(saved) || !saved.world.roadGraph) return false;
    saved.lifecycle = LifecycleState.PAUSED;
    saved.runtime.pauseReason = 'tab';
    this.store.replace(saved, 'tab:fresh-save-loaded');
    this.store.transaction(state => {
      normalizeRuntimeState(state);
    }, 'tab:fresh-save-rehydrated', { validate: true });
    this.restoreEstablishedGameUi();
    return true;
  }

  resumeRuntime(reason) {
    let lifecycle = this.store.read(state => state.lifecycle);
    let pauseReason = this.store.read(state => state.runtime.pauseReason);
    if (lifecycle !== LifecycleState.PAUSED || pauseReason !== reason || document.hidden || !this.tabCoordinator.isPrimary()) return false;
    if (reason === 'tab') {
      this.refreshFromSavedStateForTakeover();
      lifecycle = this.store.read(state => state.lifecycle);
      pauseReason = this.store.read(state => state.runtime.pauseReason);
      if (lifecycle !== LifecycleState.PAUSED || pauseReason !== 'tab') return false;
    }
    const lastSavedAt = this.store.read(state => state.runtime.lastSavedAt || Date.now());
    const elapsed = Math.max(0, (Date.now() - lastSavedAt) / 1000);
    let summary = null;
    this.store.transaction(state => {
      summary = this.offlineSimulator.simulate(state, elapsed);
      state.runtime.pauseReason = null;
    }, `runtime:resume-${reason}`);
    this.lifecycle.resume();
    this.restoreEstablishedGameUi();
    this.persist({ notify: false });
    this.showOfflineSummary(summary);
    this.startLocationTracking();
    this.gameLoop.start();
    return true;
  }

  handlePrimaryChange(primary) {
    const lifecycle = this.store.read(state => state.lifecycle);
    if (!primary && lifecycle === LifecycleState.PLAYING) {
      this.pauseRuntime('tab', { save: false });
      this.notifications.show('別のタブが進行を引き継ぎました。');
      return;
    }
    if (primary && [LifecycleState.LOCATION_REQUIRED, LifecycleState.ERROR].includes(lifecycle) && !this.store.read(state => state.world.homeBase)) {
      this.startNewGame();
      return;
    }
    if (primary && lifecycle === LifecycleState.PAUSED) {
      const reason = this.store.read(state => state.runtime.pauseReason);
      if (this.resumeRuntime(reason)) this.notifications.show('このタブで進行を再開しました。');
    }
  }

  handleVisibilityChange() {
    const lifecycle = this.store.read(state => state.lifecycle);
    if (![LifecycleState.PLAYING, LifecycleState.PAUSED].includes(lifecycle)) return;
    if (document.hidden) {
      if (lifecycle === LifecycleState.PLAYING) this.pauseRuntime('visibility', { save: true });
      else this.persist({ notify: false });
      return;
    }
    this.tabCoordinator.refresh();
    if (!this.resumeRuntime('visibility') && this.store.read(state => state.lifecycle) === LifecycleState.PLAYING) {
      this.restoreEstablishedGameUi();
      this.startRuntime();
    }
  }

  handlePageHide() {
    const lifecycle = this.store.read(state => state.lifecycle);
    if (lifecycle === LifecycleState.PLAYING) this.pauseRuntime('visibility', { save: true });
    else if (lifecycle === LifecycleState.PAUSED) this.persist({ notify: false });
  }

  async handlePageShow() {
    this.tabCoordinator.refresh();
    let lifecycle = this.store.read(state => state.lifecycle);
    if (![LifecycleState.PLAYING, LifecycleState.PAUSED].includes(lifecycle)) {
      const saved = this.saveRepository.load();
      if (saved && hasEstablishedHomeBase(saved) && saved.world.roadGraph) {
        await this.restoreSavedGame(saved, this.saveRepository.consumeWarning());
        return true;
      }
      return false;
    }
    this.restoreEstablishedGameUi();
    if (lifecycle === LifecycleState.PAUSED) {
      const reason = this.store.read(state => state.runtime.pauseReason);
      return this.resumeRuntime(reason);
    }
    this.startRuntime();
    return true;
  }

  async reset() {
    this.gameLoop.stop({ save: false });
    this.stopLocationWatch?.();
    this.tabCoordinator.release();
    this.startupGeneration += 1;
    this.roadLoadController?.abort();
    this.roadWorld.abort();
    await this.roadWorld.clearCurrentWorld();
    const cleared = this.saveRepository.clear();
    if (!cleared && this.saveRepository.isAvailable()) {
      this.notifications.show('保存データを初期化できませんでした。');
      return false;
    }
    location.reload();
    return true;
  }

  destroy() {
    this.gameLoop.stop({ save: this.tabCoordinator.isPrimary() });
    this.stopLocationWatch?.();
    this.tabCoordinator.release();
    this.startupGeneration += 1;
    this.roadLoadController?.abort();
    this.baseScreen.destroy();
    this.mapInput.destroy();
    this.roadWorld.destroy();
    this.renderer.destroy();
    this.events.clear();
  }
}

const app = new FrontlineRoadsApp();
const startup = app.start();
startup.then(() => {
  globalThis.__FRONTLINE_BOOT_COMPLETE__?.();
  return registerPwa();
}).catch(error => {
  globalThis.__FRONTLINE_BOOT_COMPLETE__?.();
  app.handleFatal(error);
});
globalThis.addEventListener('error', event => {
  if (event?.error) app.handleFatal(event.error);
});
globalThis.addEventListener('unhandledrejection', event => app.handleFatal(event.reason));
globalThis.addEventListener?.('pagehide', () => app.handlePageHide());
document.addEventListener('freeze', () => app.handlePageHide());
globalThis.addEventListener('pageshow', event => {
  if (!event.persisted && !document.wasDiscarded) return;
  startup.then(() => app.handlePageShow()).catch(error => app.handleFatal(error));
});
