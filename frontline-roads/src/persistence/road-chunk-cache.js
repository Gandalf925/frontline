const DEFAULT_DB_NAME = 'frontline_roads_world_v1';
const DEFAULT_STORE_NAME = 'road_chunks';

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export class RoadChunkCache {
  constructor({ indexedDB = globalThis.indexedDB, dbName = DEFAULT_DB_NAME, storeName = DEFAULT_STORE_NAME } = {}) {
    this.indexedDB = indexedDB ?? null;
    this.dbName = dbName;
    this.storeName = storeName;
    this.databasePromise = null;
  }

  isAvailable() {
    return Boolean(this.indexedDB?.open);
  }

  async open() {
    if (!this.isAvailable()) return null;
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise((resolve, reject) => {
      const request = this.indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(this.storeName)) database.createObjectStore(this.storeName, { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
      request.onblocked = () => reject(new Error('IndexedDB open blocked'));
    }).catch(error => {
      this.databasePromise = null;
      throw error;
    });
    return this.databasePromise;
  }

  async get(worldId, chunkId) {
    const database = await this.open();
    if (!database) return null;
    const transaction = database.transaction(this.storeName, 'readonly');
    const record = await requestResult(transaction.objectStore(this.storeName).get(`${worldId}:${chunkId}`));
    return record?.payload ?? null;
  }

  async put(worldId, chunkId, payload) {
    const database = await this.open();
    if (!database) return false;
    const transaction = database.transaction(this.storeName, 'readwrite');
    await requestResult(transaction.objectStore(this.storeName).put({
      key: `${worldId}:${chunkId}`,
      worldId,
      chunkId,
      updatedAt: Date.now(),
      payload
    }));
    return true;
  }


  async remove(worldId, chunkId) {
    const database = await this.open();
    if (!database) return false;
    const transaction = database.transaction(this.storeName, 'readwrite');
    await requestResult(transaction.objectStore(this.storeName).delete(`${worldId}:${chunkId}`));
    return true;
  }

  async removeWorld(worldId) {
    const database = await this.open();
    if (!database) return false;
    const transaction = database.transaction(this.storeName, 'readwrite');
    const store = transaction.objectStore(this.storeName);
    const records = await requestResult(store.getAllKeys());
    await Promise.all(records.filter(key => String(key).startsWith(`${worldId}:`)).map(key => requestResult(store.delete(key))));
    return true;
  }

  close() {
    this.databasePromise?.then(database => database?.close?.()).catch(() => {});
    this.databasePromise = null;
  }
}

export class MemoryRoadChunkCache {
  constructor() { this.records = new Map(); }
  isAvailable() { return true; }
  async get(worldId, chunkId) { return this.records.get(`${worldId}:${chunkId}`) ?? null; }
  async put(worldId, chunkId, payload) { this.records.set(`${worldId}:${chunkId}`, structuredClone(payload)); return true; }

  async remove(worldId, chunkId) { return this.records.delete(`${worldId}:${chunkId}`); }
  async removeWorld(worldId) {
    for (const key of [...this.records.keys()]) if (key.startsWith(`${worldId}:`)) this.records.delete(key);
    return true;
  }
  close() {}
}
