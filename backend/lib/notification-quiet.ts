export function isQuietTime(preferences: { quietStart: string; quietEnd: string; timeZone: string }, now = new Date()) {
  if (!preferences.quietStart || !preferences.quietEnd || preferences.quietStart === preferences.quietEnd) return false;
  try {
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: preferences.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
    return preferences.quietStart < preferences.quietEnd ? time >= preferences.quietStart && time < preferences.quietEnd : time >= preferences.quietStart || time < preferences.quietEnd;
  } catch { return false; }
}
