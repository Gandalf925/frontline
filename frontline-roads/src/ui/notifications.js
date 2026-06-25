export class Notifications {
  constructor(element) {
    this.element = element;
    this.timer = null;
  }

  show(message, duration = 2600) {
    clearTimeout(this.timer);
    this.element.textContent = message;
    this.element.classList.add('is-visible');
    this.timer = setTimeout(() => this.element.classList.remove('is-visible'), duration);
  }
}
