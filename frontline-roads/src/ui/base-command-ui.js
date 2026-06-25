import { distance } from '../core/utilities.js';
import { activePlayerBases, baseLimitForCivilization, playerBaseSlotsUsed } from '../base/player-bases.js';
import {
  activeFieldBases,
  fieldBaseLimitForCivilization,
  fieldBaseSlotsUsed
} from '../base/field-bases.js';
import { enemyPosition } from '../combat/enemy-system.js';
import { edgeMidpoint } from '../combat/combat-geometry.js';
import { bindDismissibleModal, queryRequired, setVisible } from './dom.js';
import { bundleText } from '../civilization/inventory-system.js';
import { diagnoseFieldBaseNetwork } from '../base/field-base-system.js';
import { friendlySquadCapacityForBase } from '../combat/friendly-force-system.js';
import { fieldBaseBuildRange, majorBaseBuildRange } from '../base/construction-range.js';

const BASE_STATUS_RADIUS_METERS = 300;
const FACILITY_RADIUS_METERS = 120;
function limitText(value) { return Number.isFinite(value) ? String(value) : '無制限'; }


function defensePoint(state, defense) {
  if (defense.kind === 'barrier') return edgeMidpoint(state.world.roadGraph, defense.edgeId);
  return state.world.roadGraph?.nodeById?.get(defense.nodeId) ?? null;
}

export function summarizePlayerBase(state, base) {
  const nearbyEnemies = (state.combat.enemies ?? []).filter(enemy => enemy.hp > 0 && distance(base, enemyPosition(state, enemy)) <= BASE_STATUS_RADIUS_METERS).length;
  const facilities = (state.combat.defenses ?? []).filter(defense => defense.hp > 0 && (() => {
    const point = defensePoint(state, defense);
    return point && distance(base, point) <= FACILITY_RADIUS_METERS;
  })()).length;
  const baseSquads = (state.combat.friendlySquads ?? []).filter(squad => squad.originBaseId === base.id && squad.hp > 0);
  const recoveringSquads = baseSquads.filter(squad => squad.status === 'RECOVERING').length;
  const readySquads = baseSquads.filter(squad => squad.status === 'READY').length;
  const activeSquads = baseSquads.length - recoveringSquads - readySquads;
  const squads = baseSquads.length;
  const squadCapacity = friendlySquadCapacityForBase(state, base);
  const recoveryItems = (state.world.recoveryItems ?? []).filter(item => item.status === 'AVAILABLE' && distance(base, state.world.roadGraph?.nodeById?.get(item.nodeId) ?? item) <= BASE_STATUS_RADIUS_METERS).length;
  return {
    nearbyEnemies,
    facilities,
    squads,
    squadCapacity,
    activeSquads,
    recoveringSquads,
    readySquads,
    recoveryItems,
    alert: base.status === 'DESTROYED' || base.hp <= 0
      ? '破壊'
      : nearbyEnemies > 0
        ? '交戦警戒'
        : recoveryItems > 0
          ? '回収物あり'
          : '安定'
  };
}

function baseCard(state, base, { selected, label, field = false, rebuild = null, rebuildKind = null }) {
  const status = summarizePlayerBase(state, base);
  const destroyed = base.status === 'DESTROYED' || base.hp <= 0;
  return `<article class="baseCommandCard ${selected ? 'selected' : ''} ${destroyed ? 'destroyed' : ''}">
    <header><div><small>${label}</small><strong>${base.name}</strong></div><span data-alert="${destroyed || status.nearbyEnemies > 0 ? 'danger' : 'clear'}">${status.alert}</span></header>
    <div class="contextMetricGrid"><span><small>HP</small><b>${Math.ceil(base.hp)}/${base.maxHp}</b></span><span><small>ENEMY</small><b>${status.nearbyEnemies}</b></span><span><small>DEF</small><b>${status.facilities}</b></span><span><small>SQUAD</small><b>${status.squads}/${status.squadCapacity}</b></span></div>
    ${field ? `<p class="sectionNote">建設範囲${fieldBaseBuildRange(state.civilization?.level)}m・突撃／遊撃／回収部隊を派兵可能</p>` : ''}
    <p class="baseSquadNotice">派兵中 ${status.activeSquads}・回復中 ${status.recoveringSquads}・再出撃待機 ${status.readySquads}</p>
    ${status.recoveryItems ? `<p class="baseRecoveryNotice">周辺に未回収アイテム ${status.recoveryItems}</p>` : ''}
    <button class="primary wideButton" data-action="focus-base" data-base-id="${base.id}" data-base-kind="${field ? 'field' : 'major'}">この拠点をMAP表示</button>
    ${destroyed && rebuildKind ? `<button class="secondary wideButton" data-action="rebuild-${rebuildKind}-base" data-base-id="${base.id}" ${rebuild?.ok ? '' : 'disabled'}>現地で${rebuildKind === 'field' ? '簡易拠点' : '主要拠点'}を再建</button><p class="sectionNote">費用 ${bundleText(rebuild?.cost)}・${rebuild?.ok ? '現在地から再建できます。' : rebuild?.reason ?? '現地へ移動してください。'}</p>` : ''}
  </article>`;
}

export class BaseCommandUi {
  constructor({ store, playerBaseSystem, fieldBaseSystem = null, renderer, notifications, persist }) {
    this.store = store;
    this.system = playerBaseSystem;
    this.fieldSystem = fieldBaseSystem;
    this.renderer = renderer;
    this.notifications = notifications;
    this.persist = persist;
    this.panel = queryRequired('#baseCommandPanel');
    this.body = queryRequired('#baseCommandBody');
    this.summary = queryRequired('#baseSummary');
    this.focusedBaseId = null;
    this.focusedBaseKind = 'major';
    this.lastRenderAt = 0;
    queryRequired('#baseCommandButton').addEventListener('click', () => this.open());
    queryRequired('#closeBaseCommand').addEventListener('click', () => this.close());
    bindDismissibleModal(this.panel, () => this.close());
    this.body.addEventListener('click', event => this.handleAction(event));
  }

  availableBases(state) {
    return [...(state.world?.playerBases ?? []), ...(state.world?.fieldBases ?? [])];
  }

  open() {
    const state = this.store.snapshot();
    const bases = this.availableBases(state);
    if (!bases.some(base => base.id === this.focusedBaseId)) {
      this.focusedBaseId = bases[0]?.id ?? null;
      this.focusedBaseKind = 'major';
    }
    this.render(state);
    setVisible(this.panel, true);
  }

  close() { setVisible(this.panel, false); }

  selectedBase(state = this.store.snapshot()) {
    const bases = this.availableBases(state);
    return bases.find(base => base.id === this.focusedBaseId) ?? bases[0] ?? null;
  }

  focusCurrentBase(state = this.store.snapshot()) {
    const base = this.selectedBase(state);
    if (!base) return false;
    this.focusedBaseId = base.id;
    this.focusedBaseKind = base.kind === 'FIELD' ? 'field' : 'major';
    this.renderer.centerOn(base, 0.9);
    this.updateSummary(state);
    return true;
  }

  update(state = this.store.snapshot()) {
    this.updateSummary(state);
    if (!this.panel.hidden && Date.now() - this.lastRenderAt >= 1000) this.render(state);
  }

  updateSummary(state = this.store.snapshot()) {
    const major = activePlayerBases(state);
    const majorSlots = playerBaseSlotsUsed(state);
    const field = state.world?.fieldBases ?? [];
    const focused = [...major, ...field].find(base => base.id === this.focusedBaseId);
    const damagedDefenses = (state.combat?.defenses ?? []).filter(defense => defense.hp > 0 && defense.hp < defense.maxHp).length;
    const damagedBuildings = (state.civilization?.buildings ?? []).filter(building => building.hp > 0 && building.hp < building.maxHp).length;
    const repairCount = damagedDefenses + damagedBuildings;
    this.summary.textContent = `主要 ${major.length}稼働・${majorSlots}/${limitText(baseLimitForCivilization(state.civilization?.level))}・簡易 ${fieldBaseSlotsUsed(state)}/${limitText(fieldBaseLimitForCivilization(state.civilization?.level))}${repairCount ? `・要修理 ${repairCount}` : ''}${focused ? `・表示 ${focused.name}` : ''}`;
    this.summary.classList?.toggle('has-repairs', repairCount > 0);
  }

  handleAction(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const { action, baseId, baseKind } = button.dataset;
    if (action === 'focus-base') {
      const state = this.store.snapshot();
      const pool = baseKind === 'field' ? (state.world?.fieldBases ?? []) : (state.world?.playerBases ?? []);
      const base = pool.find(value => value.id === baseId);
      if (!base) return;
      this.focusedBaseId = base.id;
      this.focusedBaseKind = baseKind ?? 'major';
      this.focusCurrentBase(state);
      this.close();
      return;
    }
    if (action === 'establish-base') {
      let result;
      this.store.transaction(state => { result = this.system.establishAtCurrentLocation(state); }, 'base:player-established', { emit: true, validate: true });
      if (!result?.ok) this.notifications.show(result?.reason ?? '拠点を設置できません。');
      else {
        this.focusedBaseId = result.base.id;
        this.focusedBaseKind = 'major';
        this.renderer.invalidateStatic();
        this.renderer.render();
        this.notifications.show(`${result.base.name}を設置しました。`);
        this.persist?.();
      }
      this.render();
      return;
    }
    if (action === 'establish-field-base') {
      if (!this.fieldSystem) return;
      let result;
      this.store.transaction(state => { result = this.fieldSystem.establishAtCurrentLocation(state); }, 'base:field-established', { emit: true, validate: true });
      if (!result?.ok) this.notifications.show(result?.reason ?? '簡易拠点を設置できません。');
      else {
        this.focusedBaseId = result.base.id;
        this.focusedBaseKind = 'field';
        this.renderer.invalidateStatic();
        this.renderer.render();
        this.notifications.show(`${result.base.name}を設置しました。`);
        this.persist?.();
      }
      this.render();
      return;
    }
    if (action === 'rebuild-major-base') {
      let result;
      this.store.transaction(state => { result = this.system.rebuild(state, baseId); }, 'base:player-rebuilt', { emit: true, validate: true });
      if (!result?.ok) this.notifications.show(result?.reason ?? '主要拠点を再建できません。');
      else {
        this.renderer.invalidateStatic();
        this.renderer.render();
        this.notifications.show(`${result.base.name}を再建しました。`);
        this.persist?.();
      }
      this.render();
      return;
    }
    if (action === 'rebuild-field-base') {
      if (!this.fieldSystem) return;
      let result;
      this.store.transaction(state => { result = this.fieldSystem.rebuild(state, baseId); }, 'base:field-rebuilt', { emit: true, validate: true });
      if (!result?.ok) this.notifications.show(result?.reason ?? '簡易拠点を再建できません。');
      else {
        this.renderer.invalidateStatic();
        this.renderer.render();
        this.notifications.show(`${result.base.name}を再建しました。`);
        this.persist?.();
      }
      this.render();
    }
  }

  render(state = this.store.snapshot()) {
    this.lastRenderAt = Date.now();
    const majorBases = state.world?.playerBases ?? [];
    const fieldBases = state.world?.fieldBases ?? [];
    const majorLimit = baseLimitForCivilization(state.civilization?.level);
    const fieldLimit = fieldBaseLimitForCivilization(state.civilization?.level);
    const all = [...majorBases, ...fieldBases];
    if (!all.some(base => base.id === this.focusedBaseId)) this.focusedBaseId = majorBases[0]?.id ?? fieldBases[0]?.id ?? null;

    const majorPlacement = this.system.previewCurrentLocation(state);
    const fieldPlacement = this.fieldSystem?.previewCurrentLocation(state) ?? { ok: false, reason: '簡易拠点システムを利用できません。' };
    const fieldDiagnostic = diagnoseFieldBaseNetwork(state, Math.min(3, fieldLimit));
    const majorCards = majorBases.map((base, index) => baseCard(state, base, {
      selected: base.id === this.focusedBaseId,
      label: index === 0 ? 'PRIMARY' : `MAJOR ${String(index + 1).padStart(2, '0')}`,
      rebuild: base.status === 'DESTROYED' ? this.system.previewRebuild(state, base.id) : null,
      rebuildKind: base.primary ? null : 'major'
    })).join('') || '<p class="emptyText">稼働中の主要拠点がありません。</p>';
    const fieldCards = fieldBases.map((base, index) => baseCard(state, base, {
      selected: base.id === this.focusedBaseId,
      label: `FIELD ${String(index + 1).padStart(2, '0')}`,
      field: true,
      rebuild: base.status === 'DESTROYED' ? this.fieldSystem?.previewRebuild(state, base.id) : null,
      rebuildKind: 'field'
    })).join('') || '<p class="emptyText">簡易拠点はまだありません。</p>';

    this.body.innerHTML = `<section class="baseCommandOverview"><div><span>主要拠点</span><strong>${majorBases.length}/${limitText(majorLimit)}</strong><small>各 ${friendlySquadCapacityForBase(state, { kind: 'MAJOR' })}部隊枠</small></div><div><span>簡易拠点</span><strong>${fieldBaseSlotsUsed(state)}/${limitText(fieldLimit)}</strong><small>各 ${friendlySquadCapacityForBase(state, { kind: 'FIELD' })}部隊枠</small></div><div><span>文明レベル</span><strong>Lv.${state.civilization.level}</strong><small>発展で部隊枠増加</small></div></section>
      <section><h2>主要拠点</h2><div class="baseCommandGrid">${majorCards}</div></section>
      <section><h2>簡易拠点</h2><div class="baseCommandGrid">${fieldCards}</div></section>
      <section class="baseEstablishSection"><h2>現在地に主要拠点</h2><p class="sectionNote">主要拠点は現在の文明Lv.で建設範囲${majorBaseBuildRange(state.civilization?.level)}m。すべての部隊を派兵できます。</p><button class="primary wideButton" data-action="establish-base" ${majorPlacement.ok ? '' : 'disabled'}>現在地に主要拠点を設置</button><p class="sectionNote">費用 ${bundleText(majorPlacement.cost)}・${majorPlacement.ok ? `設置可能・道路まで約${Math.round(majorPlacement.distanceToRoad)}m` : majorPlacement.reason}</p></section>
      <section class="baseEstablishSection"><h2>現在地に簡易拠点</h2><p class="sectionNote">文明Lv.1で解禁。取得済み道路の交差点から100m以内で設置できます。文明段階に応じた耐久を持ち、現在の建設範囲${fieldBaseBuildRange(state.civilization?.level)}m、突撃／遊撃／回収部隊を派兵できます。破壊後は現地で再建が必要です。</p><div class="fieldBaseDiagnostic ${fieldDiagnostic.sufficient ? 'is-sufficient' : 'is-insufficient'}"><strong>道路網診断：${fieldDiagnostic.active}/${fieldDiagnostic.required}基稼働</strong><span>追加候補 ${fieldDiagnostic.confirmedAdditional}基・破壊済み ${fieldDiagnostic.destroyed}基</span><small>${fieldDiagnostic.guidance}</small></div><button class="primary wideButton" data-action="establish-field-base" ${fieldPlacement.ok ? '' : 'disabled'}>現在地に簡易拠点を設置</button><p class="sectionNote">費用 ${bundleText(fieldPlacement.cost)}・${fieldPlacement.ok ? `設置可能・道路まで約${Math.round(fieldPlacement.distanceToRoad)}m` : fieldPlacement.reason}</p></section>`;
    this.updateSummary(state);
  }
}
