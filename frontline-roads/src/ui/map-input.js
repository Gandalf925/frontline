export class MapInput {
  constructor(canvas, camera, callbacks = {}) {
    this.canvas = canvas;
    this.camera = camera;
    this.callbacks = callbacks;
    this.pointers = new Map();
    this.lastPinchDistance = null;
    this.moved = false;
    this.abortController = new AbortController();
    this.bind();
  }

  bind() {
    const options = { signal: this.abortController.signal };
    this.canvas.addEventListener('pointerdown', event => this.onPointerDown(event), options);
    this.canvas.addEventListener('pointermove', event => this.onPointerMove(event), options);
    this.canvas.addEventListener('pointerup', event => this.onPointerUp(event), options);
    this.canvas.addEventListener('pointercancel', event => this.onPointerUp(event), options);
    this.canvas.addEventListener('wheel', event => this.onWheel(event), { ...options, passive: false });
  }

  onPointerDown(event) {
    this.canvas.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY
    });
    this.moved = false;
  }

  onPointerMove(event) {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) > 7) this.moved = true;

    const active = [...this.pointers.values()];
    if (active.length === 1) {
      this.camera.panScreen(dx, dy);
      this.callbacks.onViewChanged?.();
      return;
    }
    if (active.length >= 2) {
      const [a, b] = active;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (this.lastPinchDistance) this.camera.zoomAt(distance / this.lastPinchDistance, center);
      this.lastPinchDistance = distance;
      this.callbacks.onViewChanged?.();
    }
  }

  onPointerUp(event) {
    const pointer = this.pointers.get(event.pointerId);
    const wasSingle = this.pointers.size === 1;
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.lastPinchDistance = null;
    if (pointer && wasSingle && !this.moved) {
      const rect = this.canvas.getBoundingClientRect();
      const screenPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      this.callbacks.onTap?.(this.camera.screenToWorld(screenPoint), screenPoint);
    }
  }

  onWheel(event) {
    event.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    this.camera.zoomAt(Math.exp(-event.deltaY * 0.0015), {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    });
    this.callbacks.onViewChanged?.();
  }

  destroy() {
    this.abortController.abort();
    this.pointers.clear();
  }
}
