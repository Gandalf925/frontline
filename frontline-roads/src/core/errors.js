export class AppError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'AppError';
    this.code = code;
    this.recoverable = options.recoverable ?? true;
    this.details = options.details ?? null;
  }
}

export const ErrorCode = Object.freeze({
  GEOLOCATION_UNSUPPORTED: 'GEOLOCATION_UNSUPPORTED',
  GEOLOCATION_DENIED: 'GEOLOCATION_DENIED',
  GEOLOCATION_TIMEOUT: 'GEOLOCATION_TIMEOUT',
  GEOLOCATION_UNAVAILABLE: 'GEOLOCATION_UNAVAILABLE',
  ROAD_REQUEST_FAILED: 'ROAD_REQUEST_FAILED',
  ROAD_DATA_INVALID: 'ROAD_DATA_INVALID',
  ROAD_NETWORK_TOO_SMALL: 'ROAD_NETWORK_TOO_SMALL',
  ROAD_NETWORK_DISCONNECTED: 'ROAD_NETWORK_DISCONNECTED',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  INVALID_STATE: 'INVALID_STATE',
  STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE'
});
