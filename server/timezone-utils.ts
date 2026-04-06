/**
 * Timezone utilities for PayLink.
 *
 * Root problem being fixed:
 *   new Date().toISOString().split("T")[0]  → always returns UTC date
 *   An employee punching out at 11 PM Eastern gets a time_entry dated TOMORROW
 *   because 11 PM Eastern = 3 AM UTC the next day.
 *
 * Solution: always extract local dates using the company's IANA timezone.
 * No external dependencies — uses Node's built-in Intl API (Node 12+).
 */

/**
 * Return the local date string (YYYY-MM-DD) for a given instant in a
 * specific IANA timezone.  Safe for all UTC offsets and DST transitions.
 *
 * Examples:
 *   getLocalDateStr(new Date("2024-06-16T02:30:00Z"), "America/New_York")
 *   → "2024-06-15"   // 10:30 PM Eastern the previous day
 *
 *   getLocalDateStr(new Date("2024-06-16T02:30:00Z"), "UTC")
 *   → "2024-06-16"
 */
export function getLocalDateStr(date: Date, timezone: string): string {
  try {
    // en-CA locale formats dates as YYYY-MM-DD without any separator ambiguity
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(date);
  } catch {
    // Fallback: if an invalid timezone is stored, use UTC to avoid crashing
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(date);
  }
}

/**
 * Convert a schedule time string ("HH:MM") on a local date string ("YYYY-MM-DD")
 * in a given IANA timezone to a UTC Date object.
 *
 * Example:
 *   localTimeToUTC("2024-06-15", "09:00", "America/New_York")
 *   → Date representing 2024-06-15T13:00:00Z  (9 AM Eastern = 1 PM UTC in summer)
 *
 * Algorithm:
 *   1. Create a naive UTC instant using the same numeric values (wrong by TZ offset)
 *   2. Ask Intl what local H:M that UTC instant shows in the target timezone
 *   3. Shift the naive instant by the difference → correct UTC instant
 */
export function localTimeToUTC(
  localDateStr: string,
  localTimeStr: string,
  timezone: string
): Date {
  const [yr, mo, dy] = localDateStr.split("-").map(Number);
  const [hr, mn] = localTimeStr.split(":").map(Number);

  // Step 1 — naive UTC (numerically equal, but in the wrong timezone)
  const utcGuess = new Date(Date.UTC(yr, mo - 1, dy, hr, mn, 0));

  try {
    // Step 2 — find what local time this UTC shows in the target TZ
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(utcGuess);

    const tzHr = parseInt(parts.find((p) => p.type === "hour")!.value, 10);
    const tzMn = parseInt(parts.find((p) => p.type === "minute")!.value, 10);

    // Step 3 — correct by the offset between desired local time and what we got
    const offsetMs = ((hr - tzHr) * 60 + (mn - tzMn)) * 60 * 1000;
    return new Date(utcGuess.getTime() + offsetMs);
  } catch {
    // Fallback for invalid timezone: return the naive guess
    return utcGuess;
  }
}

/**
 * Convenience: get the current local date string for a company timezone.
 * Equivalent to: getLocalDateStr(new Date(), timezone)
 */
export function todayInTz(timezone: string): string {
  return getLocalDateStr(new Date(), timezone);
}
