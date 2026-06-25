import { ownedBaseById } from '../base/field-bases.js';

export const FRIENDLY_RECOVERY_STATUS = Object.freeze({
  RECOVERING: 'RECOVERING',
  READY: 'READY'
});

export const FIELD_RECOVERY_SQUAD_TYPES = Object.freeze(['assault', 'skirmisher', 'retrieval']);

const MAJOR_BASELINE = Object.freeze({
  label: '主要拠点で補給・再編成',
  reorganizationSeconds: 45,
  capacity: 1,
  targetRatio: 1,
  healRatioPerSecond: 0.006
});

const FIELD_BASELINE = Object.freeze({
  label: '簡易拠点で再編成',
  reorganizationSeconds: 60,
  capacity: 1,
  targetRatio: null,
  healRatioPerSecond: 0
});

function baseKind(state, baseId) {
  return (state.world.fieldBases ?? []).some(base => base.id === baseId) ? 'FIELD' : 'MAJOR';
}

export function recoveryProfileForSquad(state, squad, baseId = squad.recoveryBaseId ?? squad.originBaseId) {
  const base = ownedBaseById(state, baseId, { includeDestroyed: true });
  if (!base || base.status !== 'ESTABLISHED' || base.hp <= 0) {
    return { ok: false, reason: '再編成可能な拠点がありません。', base: null, kind: null };
  }

  const kind = baseKind(state, base.id);
  if (kind === 'FIELD' && !FIELD_RECOVERY_SQUAD_TYPES.includes(squad.type)) {
    return {
      ok: true,
      base,
      kind,
      label: '簡易拠点で待機',
      reorganizationSeconds: 90,
      capacity: 1,
      targetRatio: null,
      healRatioPerSecond: 0,
      limited: true
    };
  }

  return {
    ok: true,
    base,
    kind,
    ...(kind === 'FIELD' ? FIELD_BASELINE : MAJOR_BASELINE),
    limited: kind === 'FIELD'
  };
}

export function beginFriendlyRecovery(state, squad, baseId, worldTime = state.runtime?.worldTimeMs ?? Date.now()) {
  squad.recoveryBaseId = baseId;
  const profile = recoveryProfileForSquad(state, squad, baseId);
  if (!profile.ok) return profile;
  squad.recoveryStartedAt = worldTime;
  squad.reorganizationRemaining = profile.reorganizationSeconds;
  squad.readyAt = null;
  squad.status = FRIENDLY_RECOVERY_STATUS.RECOVERING;
  squad.order = 'HOLD';
  squad.path = null;
  squad.pathIndex = 0;
  squad.edgeId = null;
  squad.edgeProgress = 0;
  squad.commandDestinationNodeId = profile.base.nodeId;
  squad.nodeId = profile.base.nodeId;
  squad.engagedEnemyId = null;
  squad.targetBaseId = null;
  squad.missionTargetBaseId = null;
  return { ok: true, squad, profile };
}

function recoveryQueue(state, baseId) {
  return (state.combat.friendlySquads ?? [])
    .filter(squad => squad.hp > 0 && squad.status === FRIENDLY_RECOVERY_STATUS.RECOVERING && (squad.recoveryBaseId ?? squad.originBaseId) === baseId)
    .sort((a, b) => (a.recoveryStartedAt ?? 0) - (b.recoveryStartedAt ?? 0) || String(a.id).localeCompare(String(b.id)));
}

export function updateFriendlyRecovery(state, squad, deltaSeconds, events = null) {
  if (squad.status !== FRIENDLY_RECOVERY_STATUS.RECOVERING) return { updated: false };
  const baseId = squad.recoveryBaseId ?? squad.originBaseId;
  const profile = recoveryProfileForSquad(state, squad, baseId);
  if (!profile.ok) return { updated: false, stranded: true, reason: profile.reason };
  const queue = recoveryQueue(state, baseId);
  const queueIndex = queue.findIndex(item => item.id === squad.id);
  if (queueIndex >= profile.capacity) return { updated: false, queued: true, profile, queueIndex };

  squad.reorganizationRemaining = Math.max(0, Number(squad.reorganizationRemaining ?? profile.reorganizationSeconds) - deltaSeconds);
  const targetHp = profile.targetRatio == null
    ? squad.hp
    : Math.min(squad.maxHp, Math.max(squad.hp, squad.maxHp * profile.targetRatio));
  if (profile.healRatioPerSecond > 0 && squad.hp < targetHp) {
    squad.hp = Math.min(targetHp, squad.hp + squad.maxHp * profile.healRatioPerSecond * deltaSeconds);
  }
  if (squad.reorganizationRemaining > 0 || squad.hp + 0.001 < targetHp) {
    return { updated: true, ready: false, profile };
  }

  squad.status = FRIENDLY_RECOVERY_STATUS.READY;
  squad.readyAt = state.runtime?.worldTimeMs ?? Date.now();
  squad.reorganizationRemaining = 0;
  events?.emit('friendly:squad-ready', { squadId: squad.id, originBaseId: baseId, hp: squad.hp, maxHp: squad.maxHp });
  const completion = profile.healRatioPerSecond > 0 ? '補給・回復・再編成' : '再編成';
  events?.emit('message', { text: `${profile.base.name}で部隊の${completion}が完了しました。` });
  return { updated: true, ready: true, profile };
}

export function recoveryPresentation(state, squad) {
  const profile = recoveryProfileForSquad(state, squad);
  return {
    profile,
    status: squad.status,
    reorganizationRemaining: Math.max(0, Number(squad.reorganizationRemaining) || 0),
    targetHp: profile.ok && profile.targetRatio != null ? squad.maxHp * profile.targetRatio : squad.hp,
    baseHealing: profile.ok && profile.healRatioPerSecond > 0,
    ready: squad.status === FRIENDLY_RECOVERY_STATUS.READY,
    recovering: squad.status === FRIENDLY_RECOVERY_STATUS.RECOVERING
  };
}
