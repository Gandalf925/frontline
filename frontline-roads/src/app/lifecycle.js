import { LifecycleState } from '../core/constants.js';

export class LifecycleController {
  constructor(store) {
    this.store = store;
  }

  boot() { this.store.transition(LifecycleState.LOAD_SAVE); }
  requireLocation() { this.store.transition(LifecycleState.LOCATION_REQUIRED); }
  startRoadLoading() { this.store.transition(LifecycleState.ROAD_LOADING); }
  startBaseSelection() { this.store.transition(LifecycleState.BASE_SELECTION); }
  startInitialization() { this.store.transition(LifecycleState.INITIALIZING); }
  startPlaying() { this.store.transition(LifecycleState.PLAYING); }
  pause() { this.store.transition(LifecycleState.PAUSED); }
  resume() { this.store.transition(LifecycleState.PLAYING); }
  destroy() { this.store.transition(LifecycleState.DESTROYED); }
}
