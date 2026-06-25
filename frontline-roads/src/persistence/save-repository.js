import { SAVE_KEY } from '../core/constants.js';
import { AppError, ErrorCode } from '../core/errors.js';
import { deepClone } from '../core/utilities.js';
import { validateState } from '../core/state-schema.js';
import { roundPublicLocation } from '../location/location-privacy.js';
import { isLegacySave, migrateLegacySave } from './legacy-save-migration.js';
import { resolveStorage } from './storage-access.js';
import { decodeRoadGraph, encodeRoadGraph } from './road-graph-codec.js';

const MAX_SAVE_BYTES = 4_500_000;

function sanitizeGraph(graph) {
  if (!graph) return graph;
  if (Number.isFinite(Number(graph.center?.lat)) && Number.isFinite(Number(graph.center?.lon))) graph.center = roundPublicLocation(graph.center, 4);
  else delete graph.center;
  for (const node of graph.nodes ?? []) {
    delete node.lat;
    delete node.lon;
  }
  return encodeRoadGraph(graph);
}

function sanitizeState(state, { detached = false } = {}) {
  const copy = detached ? state : deepClone(state);
  const timestamp = Date.now();
  copy.runtime.lastSavedAt = timestamp;
  copy.player.currentPosition = null;
  copy.player.locationAccuracy = null;
  copy.player.locationUpdatedAt = null;
  copy.player.worldPosition = copy.world.homeBase ? { x: copy.world.homeBase.x, y: copy.world.homeBase.y } : null;
  copy.world.recoveryCollection = null;
  if (copy.world.homeBase) delete copy.world.homeBase.location;
  for (const base of copy.world.playerBases ?? []) delete base.location;
  for (const base of copy.world.fieldBases ?? []) delete base.location;
  copy.world.roadGraph = sanitizeGraph(copy.world.roadGraph);
  return { copy, timestamp };
}

function restoreEncodedGraph(state) {
  if (state?.world?.roadGraph) state.world.roadGraph = decodeRoadGraph(state.world.roadGraph);
  return state;
}

export class SaveRepository {
  constructor(storage = undefined, key = SAVE_KEY, legacyKeys = ['frontline_roads_refactor_v1', 'frontline_roads_pages_mvp_v31']) {
    this.storage = resolveStorage(storage);
    this.key = key;
    this.legacyKeys = legacyKeys;
    this.backupKey = `${key}_legacy_backup`;
    this.corruptBackupKey = `${key}_corrupt_backup`;
    this.warning = this.storage ? null : 'ブラウザの保存領域を利用できません。このタブを閉じると進行状況は失われます。';
  }

  isAvailable() {
    return Boolean(this.storage);
  }

  consumeWarning() {
    const warning = this.warning;
    this.warning = null;
    return warning;
  }

  markUnavailable(message = 'ブラウザの保存領域を利用できません。このタブを閉じると進行状況は失われます。') {
    this.storage = null;
    this.warning = message;
  }

  discardInvalid(raw = null) {
    if (!this.storage) return;
    try {
      this.storage.removeItem(this.key);
      this.storage.removeItem(this.corruptBackupKey);
      if (raw) {
        try {
          const parsed = restoreEncodedGraph(JSON.parse(raw));
          if (parsed?.world?.roadGraph) {
            const { copy } = sanitizeState(parsed);
            this.storage.setItem(this.corruptBackupKey, JSON.stringify(copy));
          }
        } catch {
          // Unparseable data is not retained because it may contain private location text.
        }
      }
    } catch {
      this.markUnavailable();
    }
  }

  quarantineCurrent(message = '保存データを復元できなかったため、新しいゲームとして開始します。') {
    if (!this.storage) return false;
    try {
      const raw = this.storage.getItem(this.key);
      this.discardInvalid(raw);
      this.warning = message;
      return true;
    } catch {
      this.markUnavailable();
      return false;
    }
  }

  load() {
    if (!this.storage) return null;
    try {
      let raw = this.storage.getItem(this.key);
      let sourceKey = this.key;
      if (!raw) {
        for (const legacyKey of this.legacyKeys) {
          raw = this.storage.getItem(legacyKey);
          if (raw) { sourceKey = legacyKey; break; }
        }
      }
      if (!raw) return null;
      let state = restoreEncodedGraph(JSON.parse(raw));
      if (isLegacySave(state)) {
        state = migrateLegacySave(state);
        const { copy: sanitizedLegacy } = sanitizeState(state);
        this.storage.setItem(this.backupKey, JSON.stringify(sanitizedLegacy));
        const migratedValidation = validateState(state);
        if (!migratedValidation.valid) {
          this.discardInvalid(raw);
          this.warning = '保存データを復元できなかったため、新しいゲームとして開始します。破損データは無効化しました。';
          return null;
        }
        const { copy } = sanitizeState(state);
        this.storage.setItem(this.key, JSON.stringify(copy));
      }
      const validation = validateState(state);
      if (!validation.valid) {
        this.discardInvalid(raw);
        this.warning = '保存データが破損していたため、新しいゲームとして開始します。破損データは無効化しました。';
        return null;
      }
      state.runtime.loadedFromKey = sourceKey;
      return state;
    } catch {
      this.warning = '保存データを読み込めなかったため、新しいゲームとして開始します。';
      return null;
    }
  }

  save(state) {
    return this.saveState(state, { detached: false });
  }

  saveDetachedState(state) {
    return this.saveState(state, { detached: true });
  }

  saveState(state, { detached }) {
    if (!this.storage) throw new AppError(ErrorCode.STORAGE_UNAVAILABLE, 'ブラウザの保存領域を利用できません。');
    try {
      const { copy, timestamp } = sanitizeState(state, { detached });
      const serialized = JSON.stringify(copy);
      if (new TextEncoder().encode(serialized).length > MAX_SAVE_BYTES) {
        throw new Error('save data exceeds safe browser storage size');
      }
      this.storage.setItem(this.key, serialized);
      return timestamp;
    } catch (error) {
      this.markUnavailable('保存に失敗しました。このタブを閉じると、以後の進行状況は失われます。');
      throw new AppError(ErrorCode.STORAGE_UNAVAILABLE, 'ゲームの保存に失敗しました。', { details: error?.message });
    }
  }

  clear() {
    if (!this.storage) return false;
    try {
      for (const key of [this.key, ...this.legacyKeys, this.backupKey, this.corruptBackupKey, 'frontline_roads_primary_tab_v2']) {
        this.storage.removeItem(key);
      }
      return true;
    } catch {
      this.markUnavailable();
      return false;
    }
  }
}
