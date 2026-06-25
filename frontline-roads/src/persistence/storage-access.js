const PROBE_KEY = '__frontline_storage_probe__';

export function resolveStorage(candidate) {
  if (candidate === null) return null;
  let storage = candidate;
  if (storage === undefined) {
    try {
      storage = globalThis.localStorage;
    } catch {
      return null;
    }
  }
  if (!storage) return null;
  try {
    storage.setItem(PROBE_KEY, '1');
    storage.removeItem(PROBE_KEY);
    return storage;
  } catch {
    return null;
  }
}
