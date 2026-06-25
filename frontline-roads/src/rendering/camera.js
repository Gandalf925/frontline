import { clamp } from '../core/utilities.js';

export class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.scale = 1;
    this.minScale = 0.25;
    this.maxScale = 5;
    this.viewportWidth = 1;
    this.viewportHeight = 1;
  }

  setViewport(width, height) {
    this.viewportWidth = width;
    this.viewportHeight = height;
  }

  worldToScreen(point) {
    return {
      x: (point.x - this.x) * this.scale + this.viewportWidth / 2,
      y: (point.y - this.y) * this.scale + this.viewportHeight / 2
    };
  }

  screenToWorld(point) {
    return {
      x: (point.x - this.viewportWidth / 2) / this.scale + this.x,
      y: (point.y - this.viewportHeight / 2) / this.scale + this.y
    };
  }

  panScreen(dx, dy) {
    this.x -= dx / this.scale;
    this.y -= dy / this.scale;
  }

  zoomAt(factor, screenPoint) {
    const before = this.screenToWorld(screenPoint);
    this.scale = clamp(this.scale * factor, this.minScale, this.maxScale);
    const after = this.screenToWorld(screenPoint);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
  }

  fitBounds(bounds, padding = 40) {
    const width = Math.max(1, bounds.maxX - bounds.minX);
    const height = Math.max(1, bounds.maxY - bounds.minY);
    this.x = (bounds.minX + bounds.maxX) / 2;
    this.y = (bounds.minY + bounds.maxY) / 2;
    this.scale = clamp(Math.min(
      (this.viewportWidth - padding * 2) / width,
      (this.viewportHeight - padding * 2) / height
    ), this.minScale, this.maxScale);
  }
}
