export async function registerPwa({
  navigatorRef = globalThis.navigator,
  locationRef = globalThis.location,
  globalRef = globalThis,
  moduleUrl = import.meta.url
} = {}) {
  const hostname = locationRef?.hostname ?? '';
  const protocol = locationRef?.protocol ?? '';
  const localHost = ['localhost', '127.0.0.1', '::1'].includes(hostname);
  const fixtureRequested = new URLSearchParams(locationRef?.search ?? '').get('devFixture') === '1';
  const fixtureAllowed = localHost || protocol === 'file:' || globalRef.__FRONTLINE_TEST_FIXTURE__ === true;
  if (fixtureRequested && fixtureAllowed) return null;
  if (!navigatorRef?.serviceWorker?.register) return null;
  if (protocol !== 'https:' && !localHost) return null;
  try {
    const appRoot = new URL('../../', moduleUrl);
    const workerUrl = new URL('sw.js', appRoot);
    return await navigatorRef.serviceWorker.register(workerUrl.href, { scope: appRoot.href, updateViaCache: 'none' });
  } catch (error) {
    console.warn('Service worker registration failed', error);
    return null;
  }
}
