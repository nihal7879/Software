// Which self-registrations this admin has already seen, so the sidebar badge is
// a notification that clears once looked at rather than a permanent count.
//
// Stored per browser and per user as the highest registration id seen — ids only
// grow, so "unseen" is simply "id greater than this". localStorage can be
// unavailable (private windows, blocked site data), so every access is guarded;
// without it the badge just falls back to counting everything that is waiting.
const key = (userId?: number | string) => `registrations-seen:${userId ?? 'anon'}`;

export function getLastSeenRegistration(userId?: number | string): number {
  try {
    return Number(localStorage.getItem(key(userId))) || 0;
  } catch {
    return 0;
  }
}

export function markRegistrationsSeen(userId: number | string | undefined, maxId: number) {
  try {
    if (maxId > getLastSeenRegistration(userId)) localStorage.setItem(key(userId), String(maxId));
  } catch {
    /* storage blocked — the badge keeps showing, which is the safe side */
  }
}
