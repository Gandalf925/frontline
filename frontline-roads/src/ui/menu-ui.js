import { bindDismissibleModal, queryRequired, setVisible } from './dom.js';

export class MenuUi {
  constructor({ onSave, onReset, notifications, confirmImpl = globalThis.confirm?.bind(globalThis) }) {
    this.panel = queryRequired('#menuPanel');
    this.manualSave = queryRequired('#manualSave');
    this.confirmImpl = confirmImpl;
    queryRequired('#menuButton').addEventListener('click', () => setVisible(this.panel, true));
    queryRequired('#closeMenu').addEventListener('click', () => setVisible(this.panel, false));
    bindDismissibleModal(this.panel, () => setVisible(this.panel, false));
    this.manualSave.addEventListener('click', () => {
      const saved = onSave();
      notifications.show(saved ? '現在の状態を保存しました。' : '保存できません。このタブを閉じると進行状況は失われます。');
    });
    queryRequired('#menuReset').addEventListener('click', () => {
      const confirmed = this.confirmImpl ? this.confirmImpl('ゲームの進行状況を完全に初期化します。元に戻せません。続行しますか？') : false;
      if (confirmed) onReset();
    });
  }

  setSaveAvailable(available) {
    this.manualSave.disabled = !available;
    this.manualSave.textContent = available ? '現在の状態を保存' : '保存機能を利用できません';
  }
}
