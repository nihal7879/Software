/* eslint-disable no-undef */
/**
 * The service worker — the only part of the app that runs with the app closed.
 *
 * Its whole job is notifications. It deliberately caches nothing: the app is not
 * offline-capable, and a worker that serves stale files is a support call nobody
 * can explain ("I can see yesterday's hours"). Every fetch goes to the network
 * as if this file were not here.
 *
 * It is plain JavaScript in public/ rather than a module in src/, because a
 * service worker has to be served from the site root to be allowed to act for
 * the whole site, and Vite copies public/ there untouched.
 */

// Take over straight away rather than waiting for every tab to close. A worker
// that never activates is a notification that never arrives, and people keep the
// app open in a tab for days.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

/**
 * A notification has arrived.
 *
 * The payload is what utils/push.ts sent: a title, a line of text and where
 * tapping it should go. There are never figures in it — this is read off a lock
 * screen, and the hours and the fees stay behind the sign-in.
 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Some push services send a plain-text ping with no body. Still worth showing.
    data = { body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'STEM Vision';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    // Where a tap goes, read back in notificationclick below.
    data: { url: data.url || '/' },
    // One per kind: a parent whose child checks in and out does not want two
    // check-in notices stacked up, and a second one of a kind replaces the first.
    tag: data.kind || 'stemvision',
    renotify: true,
    timestamp: Date.now(),
  };

  // waitUntil keeps the worker alive until the notification is actually shown.
  // Without it the browser may stop the worker first and show nothing — and on
  // Chrome, a push that shows no notification eventually costs the site its
  // permission altogether.
  event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * Tapped.
 *
 * If the app is already open somewhere, that window is brought forward and sent
 * to the right page — far better than opening a second copy of the app beside
 * the one they already had.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if ('focus' in client) {
          if ('navigate' in client) client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});

/**
 * The push service can rotate a browser's keys on its own, which silently
 * invalidates what the server has stored. The browser tells the worker when that
 * happens; the app re-subscribes the next time it is opened (see lib/push.ts),
 * and this records it so the reason is visible in the console if it does not.
 */
self.addEventListener('pushsubscriptionchange', () => {
  console.warn('[sw] push subscription changed — the app will re-subscribe when it is next opened');
});
