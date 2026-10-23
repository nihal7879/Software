import { api } from '../api/client';

/**
 * Turning notifications on in this browser.
 *
 * Three things have to be true before a notification can arrive, and they fail
 * in different ways, so each is reported separately rather than as one "not
 * supported": the browser has to have push at all, the person has to allow it,
 * and the server has to have its keys.
 *
 * It is per device. Allowing it on a laptop says nothing about a phone, which is
 * the first thing people ask.
 */

export type PushState =
  /** This browser cannot do push. An iPhone in an ordinary Safari tab lands here. */
  | 'unsupported'
  /** Needs to be added to the home screen first — iOS only. */
  | 'ios-needs-install'
  /** The server has no VAPID keys yet: nothing the person can do about it. */
  | 'not-configured'
  /** The API could not be reached at all — offline, or the server is down. */
  | 'unreachable'
  /** Available, not turned on here. */
  | 'off'
  /** On, for this browser. */
  | 'on'
  /** The person pressed Block. Only they can undo it, in the browser's settings. */
  | 'blocked';

/** Safari on an iPhone or iPad — including the one on an iPad pretending to be a Mac. */
function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Opened from the home screen rather than as a tab. */
function isInstalled(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // Safari's own, which predates the standard one above.
    (navigator as any).standalone === true
  );
}

/**
 * Why this browser cannot be notified, if it cannot.
 *
 * iOS is called out on its own because the failure is otherwise invisible: Safari
 * in a tab simply has no PushManager, and "your browser does not support
 * notifications" is both wrong and unhelpful when the fix is two taps in the
 * Share menu.
 */
function blockedReason(): PushState | null {
  if (!('serviceWorker' in navigator)) return isIos() && !isInstalled() ? 'ios-needs-install' : 'unsupported';
  if (!('PushManager' in window)) return isIos() && !isInstalled() ? 'ios-needs-install' : 'unsupported';
  if (!('Notification' in window)) return 'unsupported';
  // Push needs a secure page. localhost counts; an office PC reaching the dev
  // server by its LAN address does not, which is worth saying plainly.
  if (window.isSecureContext === false) return 'unsupported';
  return null;
}

/** Fired on this window once a device has been registered, by either route. */
export const PUSH_ON_EVENT = 'stemvision:push-on';

let registration: ServiceWorkerRegistration | null = null;

/** Register the worker once; later calls get the same one. */
async function worker(): Promise<ServiceWorkerRegistration> {
  if (registration) return registration;
  registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  // A worker registered a moment ago is not yet in charge. Subscribing before it
  // is ready works, but a notification arriving in that gap has nobody to show it.
  await navigator.serviceWorker.ready;
  return registration;
}

/**
 * The server's public key arrives as base64url; the browser wants raw bytes.
 *
 * Built on an ArrayBuffer explicitly rather than with Uint8Array.from: the
 * subscribe call will only take a view over a plain ArrayBuffer, and TypeScript
 * now tells the two apart.
 */
function toBytes(base64url: string) {
  const padded = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** "Chrome on Windows" — so a person can tell their own devices apart. */
function describeDevice(): string {
  const ua = navigator.userAgent;
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Browser';
  const os =
    /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
    : isIos() ? 'iPhone'
    : /Mac OS X/.test(ua) ? 'Mac'
    : /Linux/.test(ua) ? 'Linux'
    : '';
  return [browser, os].filter(Boolean).join(' on ');
}

/** Where things stand in this browser right now. Asks the server whether push is on at all. */
export async function pushState(): Promise<PushState> {
  const stopper = blockedReason();
  if (stopper) return stopper;
  if (Notification.permission === 'denied') return 'blocked';

  // These two look identical to a person and are completely different problems:
  // a server that answered and said it has no keys, and a server that did not
  // answer at all. Reporting both as "not set up" sent people to the office
  // about a dev server somebody had simply stopped.
  try {
    const { data } = await api.get('/push/key');
    if (!data?.configured) return 'not-configured';
  } catch {
    return 'unreachable';
  }

  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    return sub ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

/**
 * Register this browser with the push service and hand the address to us.
 * Permission must already have been granted.
 *
 * An existing subscription is reused rather than replaced: re-subscribing would
 * hand the server a new endpoint and leave the old row behind.
 */
async function subscribeThisBrowser(serverKey: string, silent = false): Promise<void> {
  const reg = await worker();
  const sub =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({
      // Required by every browser now: a push that shows no notification is not
      // allowed, which is exactly what the service worker does anyway.
      userVisibleOnly: true,
      applicationServerKey: toBytes(serverKey),
    }));

  const json: any = sub.toJSON();
  await api.post('/push/subscribe', {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
    device: describeDevice(),
    silent,
  });
  // Said out loud so whatever is on screen can catch up. The automatic ask
  // happens a second after the dashboard has drawn, by which time the "turn on
  // notifications" strip has already decided to show itself — without this it
  // would sit there inviting someone to switch on what they just switched on.
  window.dispatchEvent(new Event(PUSH_ON_EVENT));
}

/**
 * Ask for permission, subscribe, and tell the server. Started by a press.
 *
 * Throws with a sentence meant for the person, not a code — every caller shows
 * it straight to them.
 */
export async function enablePush(): Promise<void> {
  const stopper = blockedReason();
  if (stopper === 'ios-needs-install') {
    throw new Error('On an iPhone or iPad, add STEM Vision to your home screen first — then turn notifications on from there.');
  }
  if (stopper) throw new Error('This browser cannot show notifications.');

  const { data: key } = await api.get('/push/key');
  if (!key?.configured || !key?.key) throw new Error('Notifications are not set up on the server yet.');

  const permission = await Notification.requestPermission();
  if (permission === 'denied') {
    throw new Error('Notifications are blocked for this site. Allow them in your browser settings, then try again.');
  }
  if (permission !== 'granted') throw new Error('Notifications were not allowed.');

  await subscribeThisBrowser(key.key);
}

// ---------------------------------------------------------------------------
// Asking by itself, just after signing in — the way the location box already
// appears on this app.
//
// Only Chrome, Edge and the other Chromium browsers allow a permission request
// that nobody pressed for. Firefox and Safari ignore it outright: no box, no
// error, nothing — which is why the dashboard strip exists as the fallback and
// why this is an extra rather than the whole answer.
//
// It is also asked ONCE, ever. Chrome counts repeated dismissals as a block, so
// asking at every sign-in would eventually make the site unreachable by itself.
// After this one attempt the strip takes over, and that only moves when pressed.
// ---------------------------------------------------------------------------

const ASKED_KEY = (userId?: number) => `pushAutoAsked:${userId ?? 'anon'}`;

/** Will this browser show a box for a request nobody pressed for? */
function allowsAutomaticAsk(): boolean {
  if (isIos()) return false;
  const ua = navigator.userAgent;
  if (/Firefox\//.test(ua)) return false;
  // Real Safari carries no "Chrome/"; every Chromium browser does, Edge and
  // Opera included. userAgentData exists only on Chromium, so it settles it
  // where the browser provides it.
  if ((navigator as any).userAgentData?.brands?.length) return true;
  return /Chrome\/|Chromium\//.test(ua);
}

/**
 * Called once after signing in. Shows the browser's own permission box, and on
 * "Allow" registers the device — with no confirming buzz, since nobody pressed
 * anything to deserve one.
 *
 * Silent throughout: a refusal, an unsupported browser or a server with no keys
 * all end the same way, with nothing said. Whoever wants it can still press the
 * button on the dashboard or in Settings.
 */
export async function autoAskPush(userId?: number): Promise<void> {
  try {
    if (blockedReason() || !allowsAutomaticAsk()) return;
    // 'granted' means it is already on; 'denied' means we may not ask again.
    if (Notification.permission !== 'default') return;

    try {
      if (localStorage.getItem(ASKED_KEY(userId))) return;
      localStorage.setItem(ASKED_KEY(userId), String(Date.now()));
    } catch {
      // Storage blocked — ask this once rather than never, but do not insist.
    }

    const { data: key } = await api.get('/push/key');
    if (!key?.configured || !key?.key) return;

    if ((await Notification.requestPermission()) !== 'granted') return;
    await subscribeThisBrowser(key.key, true);
  } catch {
    /* nobody asked for this, so nobody is told it did not work */
  }
}

/** Off, for this browser only. */
export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  // Told first, then dropped: if the server is unreachable the browser keeps the
  // subscription, and turning it off again will work. The other way round leaves
  // a row that can never be matched to a browser again.
  try {
    await api.post('/push/unsubscribe', { endpoint });
  } finally {
    await sub.unsubscribe().catch(() => {});
  }
}

/**
 * Called once after signing in.
 *
 * Two jobs. A browser whose push keys were rotated by its own push service holds
 * a subscription the server cannot use any more, so it is sent again — cheap,
 * and the server recognises the endpoint and updates the one row. And a
 * subscription made while signed in as somebody else (a shared office PC) is
 * re-pointed at whoever is signed in now.
 *
 * Silent: nobody is prompted, nothing is shown. If it fails, it fails quietly
 * and the person can still press the button in Settings.
 */
export async function resyncPush(): Promise<void> {
  try {
    if (blockedReason() || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    const json: any = sub.toJSON();
    await api.post('/push/subscribe', {
      endpoint: json.endpoint,
      keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
      device: describeDevice(),
      silent: true,
    });
  } catch {
    /* nothing to tell the person — they did not ask for this */
  }
}
