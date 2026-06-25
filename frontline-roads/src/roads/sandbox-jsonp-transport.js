let requestSequence = 0;

function createAbortError(message = 'Aborted') {
  try { return new DOMException(message, 'AbortError'); }
  catch {
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
  }
}

function validatePayload(data) {
  if (!Array.isArray(data?.elements)) throw new Error('invalid response payload');
  return data;
}

export function buildSandboxJsonpUrl(endpoint, query, callbackName) {
  const url = new URL(endpoint);
  url.searchParams.set('data', query);
  url.searchParams.set('jsonp', callbackName);
  return url.href;
}

function iframeDocument(channel) {
  const channelLiteral = JSON.stringify(channel);
  return `<!doctype html><meta charset="utf-8"><script>
(() => {
  'use strict';
  const channel = ${channelLiteral};
  let started = false;
  const finish = (type, value) => parent.postMessage({ channel, type, value }, '*');
  addEventListener('message', event => {
    const message = event.data;
    if (event.source !== parent || started || !message || message.channel !== channel || message.type !== 'request') return;
    started = true;
    const callbackName = '__frontlineRoadsSandboxJsonp_' + String(message.requestId).replace(/[^a-zA-Z0-9_]/g, '_');
    const script = document.createElement('script');
    const cleanup = () => {
      script.onerror = null;
      script.remove();
      try { delete window[callbackName]; } catch { window[callbackName] = undefined; }
    };
    window[callbackName] = payload => {
      cleanup();
      finish('success', payload);
    };
    script.onerror = () => {
      cleanup();
      finish('error', 'sandbox-jsonp-script-load-failed');
    };
    try {
      const url = new URL(message.endpoint);
      url.searchParams.set('data', message.query);
      url.searchParams.set('jsonp', callbackName);
      script.async = true;
      script.referrerPolicy = 'origin';
      script.src = url.href;
      document.head.appendChild(script);
    } catch (error) {
      cleanup();
      finish('error', String(error && error.message || error || 'sandbox-jsonp-url-failed'));
    }
  });
  finish('ready', null);
})();
<\/script>`;
}

/**
 * Runs Overpass JSONP inside an opaque-origin sandboxed iframe.
 * The downloaded script cannot read the game DOM, storage or JavaScript state;
 * only a validated payload is returned through postMessage.
 */
export function sandboxJsonpRequest(endpoint, query, {
  signal,
  timeoutMs = 18000,
  documentRef = globalThis.document,
  windowRef = globalThis.window
} = {}) {
  if (!documentRef?.createElement || !documentRef?.body || !windowRef?.addEventListener) {
    return Promise.reject(new Error('sandbox-jsonp-unavailable'));
  }

  const requestId = `${Date.now()}_${requestSequence++}`;
  const channel = `frontline-roads-overpass-${requestId}`;
  const frame = documentRef.createElement('iframe');
  frame.hidden = true;
  frame.tabIndex = -1;
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.referrerPolicy = 'origin';
  frame.srcdoc = iframeDocument(channel);

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;

    const cleanup = () => {
      if (timer != null) clearTimeout(timer);
      signal?.removeEventListener('abort', abortRequest);
      windowRef.removeEventListener('message', receiveMessage);
      frame.remove?.();
    };
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      handler(value);
    };
    const abortRequest = () => finish(reject, createAbortError());
    const receiveMessage = event => {
      if (event.source !== frame.contentWindow || event.data?.channel !== channel) return;
      if (event.data.type === 'ready') {
        frame.contentWindow?.postMessage?.({ channel, type: 'request', requestId, endpoint, query }, '*');
        return;
      }
      if (event.data.type === 'success') {
        try { finish(resolve, validatePayload(event.data.value)); }
        catch (error) { finish(reject, error); }
        return;
      }
      if (event.data.type === 'error') finish(reject, new Error(String(event.data.value || 'sandbox-jsonp-failed')));
    };

    windowRef.addEventListener('message', receiveMessage);
    signal?.addEventListener('abort', abortRequest, { once: true });
    timer = setTimeout(() => finish(reject, createAbortError('Timeout')), Math.max(1, timeoutMs));
    if (signal?.aborted) {
      abortRequest();
      return;
    }
    documentRef.body.appendChild(frame);
  });
}
