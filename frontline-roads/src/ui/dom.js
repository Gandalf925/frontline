export function queryRequired(selector, root = document) {
  const element = root.querySelector(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

export function setVisible(element, visible) {
  element.hidden = !visible;
  element.setAttribute?.('aria-hidden', String(!visible));
}

export function bindDismissibleModal(element, close, documentRef = element?.ownerDocument ?? globalThis.document) {
  const closeFromBackdrop = event => {
    if (event.target === element) close();
  };
  const closeFromKeyboard = event => {
    if (event.key === 'Escape' && !element.hidden) close();
  };
  element?.addEventListener?.('click', closeFromBackdrop);
  documentRef?.addEventListener?.('keydown', closeFromKeyboard);
  return () => {
    element?.removeEventListener?.('click', closeFromBackdrop);
    documentRef?.removeEventListener?.('keydown', closeFromKeyboard);
  };
}
