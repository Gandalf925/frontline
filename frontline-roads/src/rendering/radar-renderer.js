const TAU = Math.PI * 2;

function viewportRadius(width, height, center) {
  return Math.max(
    Math.hypot(center.x, center.y),
    Math.hypot(width - center.x, center.y),
    Math.hypot(center.x, height - center.y),
    Math.hypot(width - center.x, height - center.y)
  );
}

export function radarSweepAngle(timeMs = 0, preferences = {}) {
  if (preferences.motion === false) return -Math.PI / 2;
  return (timeMs * 0.00038 - Math.PI / 2) % TAU;
}

export function radarCenter(camera, marker = null) {
  if (marker) return camera.worldToScreen(marker);
  return { x: camera.viewportWidth / 2, y: camera.viewportHeight / 2 };
}

function drawGrid(context, width, height, center, preferences = {}) {
  const baseSelection = preferences.sceneMode === 'base-selection';
  const spacingBase = preferences.quality === 'minimal' ? 104 : preferences.quality === 'full' ? 58 : 76;
  const divisor = preferences.quality === 'minimal' ? 4 : preferences.quality === 'full' ? 8 : 6;
  const spacing = Math.max(42, Math.min(spacingBase, Math.min(width, height) / divisor));
  context.save();
  context.strokeStyle = baseSelection ? 'rgba(92, 255, 223, 0.11)' : 'rgba(48, 224, 191, 0.065)';
  context.lineWidth = 1;
  context.setLineDash([1, 7]);
  const offsetX = ((center.x % spacing) + spacing) % spacing;
  const offsetY = ((center.y % spacing) + spacing) % spacing;
  for (let x = offsetX; x <= width; x += spacing) {
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke();
  }
  for (let y = offsetY; y <= height; y += spacing) {
    context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
  }
  context.restore();
}

function drawRings(context, width, height, center, preferences = {}) {
  const baseSelection = preferences.sceneMode === 'base-selection';
  const maximum = viewportRadius(width, height, center);
  const ringGap = preferences.quality === 'minimal'
    ? Math.max(88, Math.min(width, height) / 3.4)
    : Math.max(64, Math.min(104, Math.min(width, height) / 4.4));
  context.save();
  context.lineWidth = 1;
  context.strokeStyle = baseSelection ? 'rgba(110, 255, 228, 0.19)' : 'rgba(66, 255, 210, 0.14)';
  for (let radius = ringGap; radius <= maximum + ringGap; radius += ringGap) {
    context.beginPath(); context.arc(center.x, center.y, radius, 0, TAU); context.stroke();
  }
  context.strokeStyle = baseSelection ? 'rgba(96, 255, 224, 0.075)' : 'rgba(96, 255, 224, 0.105)';
  const rayCount = preferences.quality === 'minimal' ? 4 : preferences.quality === 'full' ? 12 : 8;
  for (let index = 0; index < rayCount; index += 1) {
    const angle = index * TAU / rayCount;
    context.beginPath();
    context.moveTo(center.x, center.y);
    context.lineTo(center.x + Math.cos(angle) * maximum, center.y + Math.sin(angle) * maximum);
    context.stroke();
  }
  context.strokeStyle = baseSelection ? 'rgba(146, 255, 236, 0.42)' : 'rgba(112, 255, 226, 0.3)';
  context.lineWidth = baseSelection ? 1.35 : 1.2;
  context.beginPath();
  context.moveTo(center.x - 12, center.y); context.lineTo(center.x + 12, center.y);
  context.moveTo(center.x, center.y - 12); context.lineTo(center.x, center.y + 12); context.stroke();
  if (preferences.quality !== 'minimal') {
    context.fillStyle = 'rgba(135, 255, 228, 0.42)';
    context.font = '600 10px ui-monospace, monospace';
    context.textAlign = 'center'; context.textBaseline = 'middle';
    const labelRadius = Math.min(maximum - 12, ringGap * 2.6);
    context.fillText('N', center.x, center.y - labelRadius);
    context.fillText('E', center.x + labelRadius, center.y);
    context.fillText('S', center.x, center.y + labelRadius);
    context.fillText('W', center.x - labelRadius, center.y);
  }
  context.restore();
}

function drawSweep(context, width, height, center, timeMs, preferences = {}) {
  if (preferences.sceneMode === 'base-selection') return;
  const maximum = viewportRadius(width, height, center) + 24;
  const head = radarSweepAngle(timeMs, preferences);
  const sector = preferences.quality === 'minimal' ? Math.PI * 0.18 : Math.PI * 0.32;
  context.save();
  context.globalCompositeOperation = preferences.quality === 'full' ? 'screen' : 'source-over';
  if (preferences.quality !== 'minimal') {
    const gradient = context.createRadialGradient(center.x, center.y, 0, center.x, center.y, maximum);
    gradient.addColorStop(0, 'rgba(54,255,201,0.018)');
    gradient.addColorStop(0.58, preferences.quality === 'full' ? 'rgba(34,246,196,0.07)' : 'rgba(34,246,196,0.05)');
    gradient.addColorStop(1, 'rgba(20,214,179,0)');
    context.fillStyle = gradient;
    context.beginPath();
    context.moveTo(center.x, center.y);
    context.arc(center.x, center.y, maximum, head - sector, head);
    context.closePath();
    context.fill();
  }
  context.strokeStyle = preferences.quality === 'minimal' ? 'rgba(100,255,221,0.38)' : 'rgba(100,255,221,0.52)';
  context.lineWidth = preferences.quality === 'minimal' ? 1 : 1.3;
  if (preferences.quality === 'full') {
    context.shadowColor = 'rgba(48,255,207,0.65)';
    context.shadowBlur = 9;
  }
  context.beginPath();
  context.moveTo(center.x, center.y);
  context.lineTo(center.x + Math.cos(head) * maximum, center.y + Math.sin(head) * maximum);
  context.stroke();
  context.restore();
}

function drawScreenTexture(context, width, height, preferences = {}) {
  const baseSelection = preferences.sceneMode === 'base-selection';
  if (preferences.quality === 'full' && !baseSelection) {
    context.save();
    context.fillStyle = 'rgba(91, 255, 219, 0.014)';
    for (let y = 0; y < height; y += 7) context.fillRect(0, y, width, 1);
    context.restore();
  }
  const vignette = context.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.2, width / 2, height / 2, Math.max(width, height) * 0.72);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(0.72, baseSelection ? 'rgba(0,8,8,0.035)' : 'rgba(0,8,8,0.07)');
  vignette.addColorStop(1, baseSelection ? 'rgba(0,5,7,0.22)' : (preferences.quality === 'minimal' ? 'rgba(0,5,7,0.48)' : 'rgba(0,5,7,0.62)'));
  context.fillStyle = vignette;
  context.fillRect(0, 0, width, height);
}

export function drawRadarStaticBackdrop(context, width, height, center, preferences = {}) {
  const baseSelection = preferences.sceneMode === 'base-selection';
  const background = context.createRadialGradient(center.x, center.y, 0, center.x, center.y, Math.max(width, height));
  background.addColorStop(0, baseSelection ? '#0a3029' : '#06221d');
  background.addColorStop(0.44, baseSelection ? '#07201c' : '#041411');
  background.addColorStop(1, baseSelection ? '#03100f' : '#010706');
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
  drawGrid(context, width, height, center, preferences);
  drawRings(context, width, height, center, preferences);
}

export function drawRadarSweep(context, width, height, center, timeMs = 0, preferences = {}) {
  drawSweep(context, width, height, center, timeMs, preferences);
}

export function drawRadarStaticOverlay(context, width, height, preferences = {}) {
  drawScreenTexture(context, width, height, preferences);
}

export function drawRadarBackdrop(context, width, height, center, timeMs = 0, preferences = {}) {
  drawRadarStaticBackdrop(context, width, height, center, preferences);
  drawRadarSweep(context, width, height, center, timeMs, preferences);
}

export function drawRadarOverlay(context, width, height, _timeMs = 0, preferences = {}) {
  drawRadarStaticOverlay(context, width, height, preferences);
}

export function sweepIntensity(point, center, sweepAngle) {
  const angle = Math.atan2(point.y - center.y, point.x - center.x);
  let gap = Math.abs(angle - sweepAngle) % TAU;
  if (gap > Math.PI) gap = TAU - gap;
  return Math.max(0, 1 - gap / (Math.PI * 0.32));
}
