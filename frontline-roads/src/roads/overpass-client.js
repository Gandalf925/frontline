import { ROAD_CONFIG } from '../core/constants.js';
import { AppError, ErrorCode } from '../core/errors.js';
import { sandboxJsonpRequest } from './sandbox-jsonp-transport.js';
import { OVERPASS_HIGHWAY_PATTERN } from './road-constants.js';

export const DEFAULT_ENDPOINTS = Object.freeze([
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
]);

export const OVERPASS_TRANSPORT = Object.freeze({
  POST: 'POST',
  GET: 'GET',
  SANDBOX_JSONP: 'SANDBOX_JSONP'
});

const PREFERENCE_KEY = 'frontline_roads_overpass_preference_v2';
const HIGHWAY_PATTERN = OVERPASS_HIGHWAY_PATTERN;

function endpointHost(endpoint) {
  try { return new URL(endpoint).hostname; }
  catch { return String(endpoint); }
}

function errorSummary(error) {
  if (error?.name === 'AbortError') return 'timeout';
  if (error?.name === 'TypeError' && /fetch/i.test(error?.message ?? '')) return 'browser-network-or-cors';
  return String(error?.message || error || 'unknown').replace(/\s+/g, ' ').slice(0, 120);
}

function validatePayload(data) {
  if (!Array.isArray(data?.elements)) throw new Error('invalid response payload');
  return data;
}

function safeBrowserStorage() {
  try { return globalThis.localStorage ?? null; }
  catch { return null; }
}

function radiusBounds(lat, lon, radiusMeters) {
  const latitude = Number(lat);
  const longitude = Number(lon);
  const radius = Math.max(1, Number(radiusMeters) || 1);
  const latitudeDelta = radius / 111320;
  const longitudeScale = Math.max(0.15, Math.cos(latitude * Math.PI / 180));
  const longitudeDelta = radius / (111320 * longitudeScale);
  return {
    south: latitude - latitudeDelta,
    west: longitude - longitudeDelta,
    north: latitude + latitudeDelta,
    east: longitude + longitudeDelta
  };
}

function defaultSandboxTransport() {
  return globalThis.document?.body && globalThis.window?.addEventListener ? sandboxJsonpRequest : null;
}

export class OverpassClient {
  constructor({
    fetchImpl = globalThis.fetch,
    endpoints = DEFAULT_ENDPOINTS,
    preferenceStorage = safeBrowserStorage(),
    sandboxJsonpImpl = defaultSandboxTransport()
  } = {}) {
    if (typeof fetchImpl !== 'function' && typeof sandboxJsonpImpl !== 'function') {
      throw new TypeError('A fetch or sandbox JSONP transport is required');
    }
    this.fetchImpl = typeof fetchImpl === 'function' ? fetchImpl : null;
    this.sandboxJsonpImpl = typeof sandboxJsonpImpl === 'function' ? sandboxJsonpImpl : null;
    this.endpoints = [...endpoints];
    this.preferenceStorage = preferenceStorage;
    this.preferredEndpoint = null;
    this.preferredTransports = new Map();
    this.lastSuccess = null;
    this.successSequence = 0;
    this.restorePreference();
  }

  restorePreference() {
    try {
      const value = JSON.parse(this.preferenceStorage?.getItem?.(PREFERENCE_KEY) ?? 'null');
      if (!value || !this.endpoints.includes(value.endpoint)) return;
      this.preferredEndpoint = value.endpoint;
      if (Object.values(OVERPASS_TRANSPORT).includes(value.transport)) {
        this.preferredTransports.set(value.endpoint, value.transport);
      }
    } catch {
      // Preferences are an optimization only.
    }
  }

  persistPreference(endpoint, transport) {
    try {
      this.preferenceStorage?.setItem?.(PREFERENCE_KEY, JSON.stringify({ endpoint, transport, updatedAt: Date.now() }));
    } catch {
      // Private browsing may deny storage; in-memory preference remains active.
    }
  }

  orderedEndpoints() {
    if (!this.preferredEndpoint || !this.endpoints.includes(this.preferredEndpoint)) return [...this.endpoints];
    return [this.preferredEndpoint, ...this.endpoints.filter(endpoint => endpoint !== this.preferredEndpoint)];
  }

  availableTransports(endpoint) {
    const transports = [];
    if (this.fetchImpl) transports.push(OVERPASS_TRANSPORT.POST, OVERPASS_TRANSPORT.GET);
    if (this.sandboxJsonpImpl) transports.push(OVERPASS_TRANSPORT.SANDBOX_JSONP);
    const preferred = this.preferredTransports.get(endpoint);
    if (!preferred || !transports.includes(preferred)) return transports;
    return [preferred, ...transports.filter(transport => transport !== preferred)];
  }

  buildQuery(lat, lon, radiusMeters = ROAD_CONFIG.fetchRadiusMeters, { shape = 'around' } = {}) {
    const selector = shape === 'bbox'
      ? (() => {
          const bounds = radiusBounds(lat, lon, radiusMeters);
          return `(${bounds.south.toFixed(7)},${bounds.west.toFixed(7)},${bounds.north.toFixed(7)},${bounds.east.toFixed(7)})`;
        })()
      : `(around:${radiusMeters},${lat},${lon})`;
    return [
      '[out:json][timeout:35];',
      `way["highway"~"^(${HIGHWAY_PATTERN})$"]`,
      '["access"!~"^(private|no)$"]',
      '["area"!="yes"]',
      `${selector};`,
      'out geom qt;'
    ].join('');
  }

  async fetchWithPost(endpoint, query, signal) {
    const body = new URLSearchParams({ data: query });
    const response = await this.fetchImpl(endpoint, { method: 'POST', body, signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return validatePayload(await response.json());
  }

  async fetchWithGet(endpoint, query, signal) {
    const url = new URL(endpoint);
    url.searchParams.set('data', query);
    const response = await this.fetchImpl(url.href, { method: 'GET', signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return validatePayload(await response.json());
  }

  async runAttempt(endpoint, query, timeoutMs, callerSignal, transport) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const abortFromCaller = () => controller.abort();
    callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
    try {
      if (transport === OVERPASS_TRANSPORT.GET) return await this.fetchWithGet(endpoint, query, controller.signal);
      if (transport === OVERPASS_TRANSPORT.POST) return await this.fetchWithPost(endpoint, query, controller.signal);
      return await this.sandboxJsonpImpl(endpoint, query, { signal: controller.signal, timeoutMs });
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', abortFromCaller);
    }
  }

  recordSuccess(endpoint, transport, result, { confirmedEmpty = false, emptyConfirmationCount = 0 } = {}) {
    this.preferredEndpoint = endpoint;
    this.preferredTransports.set(endpoint, transport);
    this.lastSuccess = Object.freeze({
      sequence: ++this.successSequence,
      endpoint,
      host: endpointHost(endpoint),
      transport,
      at: Date.now(),
      elementCount: result.elements.length,
      confirmedEmpty,
      emptyConfirmationCount
    });
    this.persistPreference(endpoint, transport);
  }

  getLastSuccess() {
    return this.lastSuccess ? { ...this.lastSuccess } : null;
  }

  async fetchRoads(lat, lon, {
    signal,
    radiusMeters = ROAD_CONFIG.fetchRadiusMeters,
    queryShape = 'around',
    onAttempt = null
  } = {}) {
    const query = this.buildQuery(lat, lon, radiusMeters, { shape: queryShape });
    const startedAt = Date.now();
    const failures = [];
    const emptyEndpoints = new Set();
    let firstEmpty = null;
    let attempt = 0;
    const endpoints = this.orderedEndpoints();
    const totalAttempts = endpoints.reduce((sum, endpoint) => sum + this.availableTransports(endpoint).length, 0);
    const requiredEmptyConfirmations = Math.min(ROAD_CONFIG.emptyResultConfirmationEndpoints, Math.max(1, endpoints.length));

    for (let index = 0; index < endpoints.length; index += 1) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const endpoint = endpoints[index];
      const transports = this.availableTransports(endpoint);

      for (const transport of transports) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const remainingTotal = ROAD_CONFIG.overpassTotalTimeoutMs - (Date.now() - startedAt);
        if (remainingTotal <= 0) break;
        attempt += 1;
        const timeoutMs = Math.min(ROAD_CONFIG.overpassTimeoutMs, remainingTotal);
        onAttempt?.({
          index: index + 1,
          total: endpoints.length,
          attempt,
          totalAttempts,
          transport,
          timeoutMs,
          endpoint,
          queryShape
        });

        try {
          const result = await this.runAttempt(endpoint, query, timeoutMs, signal, transport);
          if (result.elements.length > 0) {
            this.recordSuccess(endpoint, transport, result);
            return result;
          }

          firstEmpty ??= result;
          emptyEndpoints.add(endpoint);
          const confirmed = emptyEndpoints.size >= requiredEmptyConfirmations;
          this.recordSuccess(endpoint, transport, result, {
            confirmedEmpty: confirmed,
            emptyConfirmationCount: emptyEndpoints.size
          });
          if (confirmed) return firstEmpty;
          failures.push(`${endpointHost(endpoint)} ${transport}:empty-unconfirmed`);
          break;
        } catch (error) {
          if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          failures.push(`${endpointHost(endpoint)} ${transport}:${errorSummary(error)}`);
        }
      }
    }

    const details = failures.length > 0 ? failures.join(' / ') : 'no endpoint completed';
    throw new AppError(
      ErrorCode.ROAD_REQUEST_FAILED,
      emptyEndpoints.size > 0
        ? '道路がないという応答を確認できませんでした。別の道路サーバーで自動再試行します。'
        : '道路データを取得できませんでした。下の診断内容をスクリーンショットで共有してください。',
      { details }
    );
  }
}
