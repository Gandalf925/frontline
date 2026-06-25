import { ROAD_CONFIG } from '../core/constants.js';
import { formatMeters } from '../core/utilities.js';
import { queryRequired, setVisible } from './dom.js';

function viewportSize(documentRef) {
  const root = documentRef.documentElement;
  return {
    width: Math.max(1, globalThis.innerWidth || root.clientWidth || 1),
    height: Math.max(1, globalThis.innerHeight || root.clientHeight || 1)
  };
}

export class BasePlacementScreen {
  constructor(root = document) {
    this.overlay = queryRequired('#basePlacementOverlay', root);
    this.mapViewport = queryRequired('#baseMapViewport', root);
    this.status = queryRequired('#basePlacementStatus', root);
    this.confirmButton = queryRequired('#confirmBase', root);
    this.retryButton = queryRequired('#retryLocation', root);
    this.zoomInButton = queryRequired('#zoomIn', root);
    this.zoomOutButton = queryRequired('#zoomOut', root);
    this.recenterButton = queryRequired('#recenter', root);
    this.document = this.overlay.ownerDocument;
    this.documentRoot = this.document.documentElement;
    this.syncFrame = null;
    this.boundSyncViewport = () => this.scheduleViewportSync();
    this.resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(this.boundSyncViewport)
      : null;
    this.resizeObserver?.observe(this.mapViewport);
    globalThis.addEventListener?.('resize', this.boundSyncViewport);
    globalThis.addEventListener?.('orientationchange', this.boundSyncViewport);
    this.scheduleViewportSync();
  }

  scheduleViewportSync() {
    if (this.syncFrame != null) return;
    const schedule = globalThis.requestAnimationFrame
      ? callback => globalThis.requestAnimationFrame(callback)
      : callback => setTimeout(callback, 0);
    this.syncFrame = schedule(() => {
      this.syncFrame = null;
      this.syncViewportClip();
    });
  }

  syncViewportClip() {
    const rect = this.mapViewport.getBoundingClientRect();
    const viewport = viewportSize(this.document);
    const top = Math.max(0, Math.round(rect.top));
    const right = Math.max(0, Math.round(viewport.width - rect.right));
    const bottom = Math.max(0, Math.round(viewport.height - rect.bottom));
    const left = Math.max(0, Math.round(rect.left));
    this.documentRoot.style.setProperty('--base-map-top', `${top}px`);
    this.documentRoot.style.setProperty('--base-map-right', `${right}px`);
    this.documentRoot.style.setProperty('--base-map-bottom', `${bottom}px`);
    this.documentRoot.style.setProperty('--base-map-left', `${left}px`);
  }

  showLoading(message) {
    setVisible(this.overlay, true);
    this.status.textContent = message;
    this.confirmButton.disabled = true;
    this.scheduleViewportSync();
  }

  showSelection(selection) {
    this.scheduleViewportSync();
    if (!selection) {
      this.status.textContent = `現在地から${ROAD_CONFIG.selectionRadiusMeters / 1000}km以内の道路をタップしてください。`;
      this.confirmButton.disabled = true;
      return;
    }
    if (!selection.valid) {
      this.status.textContent = `${formatMeters(selection.distanceFromOrigin)}離れています。1km以内の道路を選択してください。`;
      this.confirmButton.disabled = true;
      return;
    }
    this.status.textContent = `${formatMeters(selection.distanceFromOrigin)}先の道路を選択中です。確定すると、その道路を中心に即時開始します。`;
    this.confirmButton.disabled = false;
  }

  hide() {
    setVisible(this.overlay, false);
  }

  showError(message) {
    setVisible(this.overlay, true);
    this.status.textContent = message;
    this.confirmButton.disabled = true;
    this.scheduleViewportSync();
  }

  destroy() {
    this.resizeObserver?.disconnect();
    globalThis.removeEventListener?.('resize', this.boundSyncViewport);
    globalThis.removeEventListener?.('orientationchange', this.boundSyncViewport);
    if (this.syncFrame != null) {
      if (globalThis.cancelAnimationFrame) globalThis.cancelAnimationFrame(this.syncFrame);
      else clearTimeout(this.syncFrame);
      this.syncFrame = null;
    }
  }
}
