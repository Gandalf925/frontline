import { stableId } from '../core/utilities.js';
import { resolveStorage } from './storage-access.js';

export class TabCoordinator {
  constructor({
    storage = undefined,
    eventTarget = globalThis,
    channelFactory = typeof globalThis.BroadcastChannel === 'function' ? name => new BroadcastChannel(name) : null,
    key = 'frontline_roads_primary_tab_v2',
    leaseMs = 6000,
    heartbeatMs = 2000,
    now = () => Date.now(),
    setIntervalImpl = globalThis.setInterval?.bind(globalThis),
    clearIntervalImpl = globalThis.clearInterval?.bind(globalThis),
    id = stableId('tab', Date.now(), Math.random())
  } = {}) {
    this.storage = resolveStorage(storage);
    this.eventTarget = eventTarget;
    this.channelFactory = channelFactory;
    this.key = key;
    this.leaseMs = leaseMs;
    this.heartbeatMs = heartbeatMs;
    this.now = now;
    this.setIntervalImpl = setIntervalImpl;
    this.clearIntervalImpl = clearIntervalImpl;
    this.id = id;
    this.primary = true;
    this.timer = null;
    this.channel = null;
    this.peers = new Map();
    this.onChange = null;
    this.storageListener = event => {
      if (event?.key === this.key) this.refresh();
    };
  }

  readLease() {
    try {
      const raw = this.storage?.getItem(this.key);
      if (!raw) return null;
      const lease = JSON.parse(raw);
      return lease && typeof lease.id === 'string' && Number.isFinite(lease.expiresAt) ? lease : null;
    } catch {
      return null;
    }
  }

  writeLease() {
    this.storage?.setItem(this.key, JSON.stringify({ id: this.id, expiresAt: this.now() + this.leaseMs }));
  }

  setPrimary(value) {
    const next = Boolean(value);
    if (next === this.primary) return;
    this.primary = next;
    this.onChange?.(next);
  }

  refreshStorageLease() {
    try {
      const current = this.readLease();
      if (!current || current.expiresAt <= this.now() || current.id === this.id) this.writeLease();
      const confirmed = this.readLease();
      this.setPrimary(confirmed?.id === this.id);
      return this.primary;
    } catch {
      this.storage = null;
      return this.refreshChannelElection();
    }
  }

  electChannelPrimary() {
    const cutoff = this.now() - this.leaseMs;
    for (const [peerId, seenAt] of this.peers) if (seenAt < cutoff) this.peers.delete(peerId);
    const candidates = [this.id, ...this.peers.keys()].sort();
    this.setPrimary(candidates[0] === this.id);
    return this.primary;
  }

  refreshChannelElection() {
    this.electChannelPrimary();
    this.channel?.postMessage({ id: this.id, at: this.now() });
    return this.primary;
  }

  refresh() {
    return this.storage ? this.refreshStorageLease() : this.refreshChannelElection();
  }

  start(onChange) {
    this.onChange = onChange;
    if (this.storage) {
      this.eventTarget?.addEventListener?.('storage', this.storageListener);
    } else if (this.channelFactory) {
      try {
        this.channel = this.channelFactory('frontline-roads-runtime-v2');
        const handleMessage = event => {
          const peer = event?.data;
          if (!peer?.id || peer.id === this.id) return;
          this.peers.set(peer.id, Number(peer.at) || this.now());
          this.electChannelPrimary();
        };
        if (typeof this.channel.addEventListener === 'function') this.channel.addEventListener('message', handleMessage);
        else this.channel.onmessage = handleMessage;
      } catch {
        this.channel = null;
      }
    }
    this.refresh();
    if (this.setIntervalImpl) this.timer = this.setIntervalImpl(() => this.refresh(), this.heartbeatMs);
    return this.primary;
  }

  isPrimary() {
    return this.primary;
  }

  release() {
    if (this.timer != null && this.clearIntervalImpl) this.clearIntervalImpl(this.timer);
    this.timer = null;
    this.eventTarget?.removeEventListener?.('storage', this.storageListener);
    if (this.storage) {
      try {
        const lease = this.readLease();
        if (lease?.id === this.id) this.storage.removeItem(this.key);
      } catch {
        // The lease expires automatically.
      }
    }
    try { this.channel?.close?.(); } catch { /* no-op */ }
    this.channel = null;
  }
}
