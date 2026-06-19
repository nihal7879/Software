// Hours helpers. Duration = time_out - time_in in DECIMAL hours.
// Hours Left can be negative (overconsumption) — never clamp.

export function timeToDecimalHours(timeIn: string, timeOut: string): number {
  const toMin = (t: string) => {
    const [h, m, s] = t.split(':').map(Number);
    return h * 60 + m + (s || 0) / 60;
  };
  let diff = toMin(timeOut) - toMin(timeIn);
  if (diff < 0) diff += 24 * 60; // crosses midnight
  return Math.round((diff / 60) * 100) / 100;
}

export function deriveMonth(dateStr: string): string {
  // 'YYYY-MM-DD' -> 'YYYY-MM'
  return dateStr.slice(0, 7);
}
