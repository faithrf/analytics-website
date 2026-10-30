/**
 * ASX trading hours: 10:00-16:00 Australia/Sydney, Monday-Friday.
 * Everything goes through Intl with an explicit timeZone, so the result never
 * depends on the server's (or browser's) local time zone and DST is handled
 * by the platform tz database.
 *
 * National ASX closures are modelled (see `holidaysFor`), as is the 14:10 early
 * close on Christmas Eve and New Year's Eve. State-only holidays (e.g. Labour
 * Day, Melbourne Cup) do not close the ASX. Not modelled: the ASX pre-open and
 * closing auction sessions, which run outside 10:00-16:00.
 */
import { region, type RegionId } from "@/lib/markets";

export const ASX_TIME_ZONE = "Australia/Sydney";
export const OPEN_MINUTES = 10 * 60;
export const CLOSE_MINUTES = 16 * 60;

export const EARLY_CLOSE_MINUTES = 14 * 60 + 10;

const partsFormatters = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-AU", {
      timeZone: tz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    partsFormatters.set(tz, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export interface SydneyClock {
  /** 0 = Sunday ... 6 = Saturday */
  weekday: number;
  minutes: number;
  year: number;
  /** 1-12 */
  month: number;
  day: number;
}

export function sydneyClock(date: Date): SydneyClock {
  return clockIn(ASX_TIME_ZONE, date);
}

/** Wall-clock parts for any IANA time zone. */
export function clockIn(tz: string, date: Date): SydneyClock {
  let weekday = 0;
  let hour = 0;
  let minute = 0;
  let year = 0;
  let month = 0;
  let day = 0;
  for (const p of partsFormatter(tz).formatToParts(date)) {
    if (p.type === "weekday") weekday = WEEKDAYS[p.value.slice(0, 3)] ?? 0;
    else if (p.type === "hour") hour = Number(p.value) % 24;
    else if (p.type === "minute") minute = Number(p.value);
    else if (p.type === "year") year = Number(p.value);
    else if (p.type === "month") month = Number(p.value);
    else if (p.type === "day") day = Number(p.value);
  }
  return { weekday, minutes: hour * 60 + minute, year, month, day };
}

/* ---------- holidays ---------- */

/** Easter Sunday (anonymous Gregorian algorithm) as [month 1-12, day]. */
export function easterSunday(year: number): [number, number] {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const dow = (dt: Date) => dt.getUTCDay();
const addDays = (dt: Date, n: number) => new Date(dt.getTime() + n * 864e5);
const key = (dt: Date) => `${dt.getUTCFullYear()}-${dt.getUTCMonth() + 1}-${dt.getUTCDate()}`;

/** Move a weekend date to the following Monday (Sat +2, Sun +1). */
function nextWeekday(dt: Date): Date {
  const w = dow(dt);
  return w === 6 ? addDays(dt, 2) : w === 0 ? addDays(dt, 1) : dt;
}

const holidayCache = new Map<number, Map<string, string>>();

/**
 * ASX full-day closures for a calendar year, keyed "y-m-d" (no zero padding).
 *
 * Substitute-day rules used (matching ASX's published calendars; verify against
 * the official ASX trading-calendar page if exactness matters):
 *  - New Year's Day and Australia Day on a weekend: observed the next Monday.
 *  - Anzac Day: no substitute when it falls on a weekend (ASX trades the
 *    Monday). This is the rule I am least sure of for future years.
 *  - Christmas Day / Boxing Day: when either falls on a weekend the observed
 *    days are the next free weekdays, Christmas first then Boxing Day, so
 *    Sat 25 Dec -> Mon 27 + Tue 28; Fri 25 / Sat 26 -> Fri 25 + Mon 28;
 *    Sun 25 -> Mon 26 (Boxing) + Tue 27 (Christmas).
 *  - Good Friday, Easter Monday, King's Birthday (2nd Monday of June, the NSW
 *    date that ASX follows) are always on weekdays.
 */
function holidaysFor(year: number): Map<string, string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const map = new Map<string, string>();
  const add = (dt: Date, name: string) => map.set(key(dt), name);

  add(nextWeekday(utc(year, 1, 1)), "New Year's Day");
  add(nextWeekday(utc(year, 1, 26)), "Australia Day");

  const [em, ed] = easterSunday(year);
  const easter = utc(year, em, ed);
  add(addDays(easter, -2), "Good Friday");
  add(addDays(easter, 1), "Easter Monday");

  add(utc(year, 4, 25), "Anzac Day"); // on a weekend this is harmless: the ASX is shut anyway

  const june1 = utc(year, 6, 1);
  add(addDays(june1, ((8 - dow(june1)) % 7) + 7), "King's Birthday");

  const xmas = utc(year, 12, 25);
  const xw = dow(xmas);
  let xmasObs = xmas;
  let boxObs = utc(year, 12, 26);
  if (xw === 6) {
    xmasObs = addDays(xmas, 2); // Mon 27
    boxObs = addDays(xmas, 3); // Tue 28
  } else if (xw === 0) {
    boxObs = addDays(xmas, 1); // Mon 26
    xmasObs = addDays(xmas, 2); // Tue 27
  } else if (xw === 5) {
    boxObs = addDays(xmas, 3); // Sat 26 -> Mon 28
  }
  add(xmasObs, "Christmas Day");
  add(boxObs, "Boxing Day");

  holidayCache.set(year, map);
  return map;
}

/** Holiday name if the ASX is closed all day on this Sydney calendar date, else null. */
export function holidayName(year: number, month: number, day: number): string | null {
  return holidaysFor(year).get(`${year}-${month}-${day}`) ?? null;
}

function closeMinutesFor(c: SydneyClock): number {
  const eve = c.month === 12 && (c.day === 24 || c.day === 31);
  return eve ? EARLY_CLOSE_MINUTES : CLOSE_MINUTES;
}

/** Holiday closing the ASX on this Sydney weekday, or null. */
export function holidayAt(date: Date): string | null {
  const c = sydneyClock(date);
  if (c.weekday === 0 || c.weekday === 6) return null;
  return holidayName(c.year, c.month, c.day);
}

/**
 * Other markets use their regular session and midday break on weekdays only:
 * their public holidays are not modelled.
 */
export function isMarketOpen(date: Date = new Date(), regionId: RegionId = "au"): boolean {
  const r = region(regionId);
  const c = clockIn(r.tz, date);
  if (c.weekday === 0 || c.weekday === 6) return false;
  if (regionId === "au") {
    if (holidayName(c.year, c.month, c.day)) return false;
    return c.minutes >= OPEN_MINUTES && c.minutes < closeMinutesFor(c);
  }
  if (r.lunch && c.minutes >= r.lunch[0] && c.minutes < r.lunch[1]) return false;
  return c.minutes >= r.open && c.minutes < r.close;
}

const STEP_MS = 5 * 60_000;

/** Next instant (15-minute resolution) at which open/closed flips. */
export function nextTransition(date: Date = new Date(), regionId: RegionId = "au"): Date {
  const current = isMarketOpen(date, regionId);
  let t = Math.floor(date.getTime() / STEP_MS) * STEP_MS + STEP_MS;
  for (let i = 0; i < 24 * 12 * 10; i++, t += STEP_MS) {
    if (isMarketOpen(new Date(t), regionId) !== current) return new Date(t);
  }
  return new Date(t);
}

export interface MarketStatus {
  open: boolean;
  next: Date;
  /** e.g. "Closes 16:00 AEDT" or "Opens Mon 10:00 AEST" */
  label: string;
  /** Name of today's (Sydney) full-day closure, if any. */
  holiday: string | null;
}

export function getMarketStatus(date: Date = new Date(), regionId: RegionId = "au"): MarketStatus {
  const r = region(regionId);
  const open = isMarketOpen(date, regionId);
  const next = nextTransition(date, regionId);
  const day = new Intl.DateTimeFormat("en-AU", { timeZone: r.tz, weekday: "short" }).format(next);
  const hhmm = new Intl.DateTimeFormat("en-AU", { timeZone: r.tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(next);
  // en-AU spells most foreign zones as "GMT+9"; each market's own locale gives "JST", "EDT" and so on.
  const zone =
    new Intl.DateTimeFormat(r.zoneLocale, { timeZone: r.tz, timeZoneName: "short" })
      .formatToParts(next)
      .find((p) => p.type === "timeZoneName")?.value ?? "";
  const time = zone ? `${hhmm} ${zone}` : hhmm;
  const sameDay = clockIn(r.tz, next).weekday === clockIn(r.tz, date).weekday && next.getTime() - date.getTime() < 864e5;
  const when = sameDay ? time : `${day} ${time}`;
  const holiday = regionId === "au" ? holidayAt(date) : null;
  const base = open ? `Closes ${when}` : `Opens ${when}`;
  return { open, next, holiday, label: holiday ? `Closed — ${holiday}. ${base}` : base };
}
