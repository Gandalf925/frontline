export class EventBus {
  #listeners = new Map();
  #batchDepth = 0;
  #queuedEvents = [];

  on(type, listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    const listeners = this.#listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
    return () => this.off(type, listener);
  }

  off(type, listener) {
    const listeners = this.#listeners.get(type);
    if (!listeners) return;
    listeners.delete(listener);
    if (listeners.size === 0) this.#listeners.delete(type);
  }

  emit(type, payload) {
    if (this.#batchDepth > 0) {
      this.#queuedEvents.push({ type, payload });
      return;
    }
    this.#dispatch(type, payload);
  }

  transaction(callback) {
    const outermost = this.#batchDepth === 0;
    const queueStart = this.#queuedEvents.length;
    this.#batchDepth += 1;
    try {
      const result = callback();
      this.#batchDepth -= 1;
      if (outermost) {
        const queued = this.#queuedEvents.splice(0);
        for (const event of queued) this.#dispatch(event.type, event.payload);
      }
      return result;
    } catch (error) {
      this.#batchDepth -= 1;
      this.#queuedEvents.splice(queueStart);
      throw error;
    }
  }

  #dispatch(type, payload) {
    for (const listener of this.#listeners.get(type) ?? []) {
      try { listener(payload); }
      catch (error) { console.error(`Event listener failed: ${type}`, error); }
    }
  }

  clear() {
    this.#listeners.clear();
    this.#queuedEvents.length = 0;
    this.#batchDepth = 0;
  }
}
