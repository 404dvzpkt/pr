'use strict';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

class RangeErrorInput extends Error {}

function pad(n, size = 2) {
  return String(n).padStart(size, '0');
}

function parseDateParts(value, label = 'date') {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) throw new RangeErrorInput(`Invalid ${label}. Use YYYY-MM-DD.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new RangeErrorInput(`Invalid ${label}.`);
  }
  return { year, month, day };
}

function parseMonth(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || ''));
  if (!match) throw new RangeErrorInput('Invalid month. Use YYYY-MM.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new RangeErrorInput('Invalid month.');
  return { year, month };
}

function parseYear(value) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new RangeErrorInput('Invalid year.');
  return year;
}

function isoToMs(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new RangeErrorInput('Invalid date.');
  return ms;
}

function localDateMs(year, month, day, offsetMinutes) {
  return Date.UTC(year, month - 1, day) - offsetMinutes * MINUTE;
}

function localIso(year, month, day, hour = 0, minute = 0, offsetMinutes = 480) {
  return new Date(localDateMs(year, month, day, offsetMinutes) + hour * 60 * MINUTE + minute * MINUTE).toISOString();
}

function localParts(ms, offsetMinutes) {
  const d = new Date(ms + offsetMinutes * MINUTE);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    weekday: d.getUTCDay(),
  };
}

function localDateString(input, offsetMinutes) {
  const ms = typeof input === 'number' ? input : isoToMs(input);
  const p = localParts(ms, offsetMinutes);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function localTimeString(input, offsetMinutes) {
  const ms = typeof input === 'number' ? input : isoToMs(input);
  const p = localParts(ms, offsetMinutes);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

function fmtLocal(input, offsetMinutes, opts = {}) {
  const ms = typeof input === 'number' ? input : isoToMs(input);
  const p = localParts(ms, offsetMinutes);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][p.month - 1];
  const date = opts.dateOnly ? `${month} ${p.day}, ${p.year}` : `${month} ${p.day}, ${p.year} ${pad(p.hour)}:${pad(p.minute)}`;
  return date;
}

function todayLocal(offsetMinutes, nowMs = Date.now()) {
  return localDateString(nowMs, offsetMinutes);
}

function currentMonth(offsetMinutes, nowMs = Date.now()) {
  return todayLocal(offsetMinutes, nowMs).slice(0, 7);
}

function currentYear(offsetMinutes, nowMs = Date.now()) {
  return Number(todayLocal(offsetMinutes, nowMs).slice(0, 4));
}

function isoWeekInfo(dateString) {
  const { year, month, day } = parseDateParts(dateString);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - weekday + 3); // Thursday of this week
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstWeekday = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstWeekday + 3);
  const week = 1 + Math.round((date - firstThursday) / (7 * DAY));
  return { year: date.getUTCFullYear(), week };
}

function currentWeek(offsetMinutes, nowMs = Date.now()) {
  const info = isoWeekInfo(todayLocal(offsetMinutes, nowMs));
  return `${info.year}-W${pad(info.week)}`;
}

function weekRange(value, offsetMinutes) {
  const match = /^(\d{4})-W(\d{2})$/.exec(String(value || ''));
  if (!match) throw new RangeErrorInput('Invalid week. Use YYYY-Www.');
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (week < 1 || week > 53) throw new RangeErrorInput('Invalid week number.');
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const weekday = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = new Date(jan4.getTime() - weekday * DAY);
  const monday = new Date(week1Monday.getTime() + (week - 1) * 7 * DAY);
  const p = {
    year: monday.getUTCFullYear(),
    month: monday.getUTCMonth() + 1,
    day: monday.getUTCDate(),
  };
  const startMs = localDateMs(p.year, p.month, p.day, offsetMinutes);
  const endMs = startMs + 7 * DAY;
  const sunday = localParts(endMs - DAY, offsetMinutes);
  const start = new Date(startMs).toISOString();
  const end = new Date(endMs).toISOString();
  return {
    start,
    end,
    key: value,
    label: `${p.year}-W${pad(week)} · ${localDateString(start, offsetMinutes)} → ${sunday.year}-${pad(sunday.month)}-${pad(sunday.day)}`,
  };
}

function getPeriodMeta(offsetMinutes = 480, nowMs = Date.now()) {
  return {
    today: todayLocal(offsetMinutes, nowMs),
    week: currentWeek(offsetMinutes, nowMs),
    month: currentMonth(offsetMinutes, nowMs),
    year: currentYear(offsetMinutes, nowMs),
    timezone: 'F. Calderon St. Baguio City, Benguet',
    offsetMinutes,
  };
}

function periodRange(period, value, offsetMinutes = 480, nowMs = Date.now()) {
  const p = String(period || 'monthly').toLowerCase();
  if (p === 'daily' || p === 'day') {
    const date = value || todayLocal(offsetMinutes, nowMs);
    const { year, month, day } = parseDateParts(date);
    const startMs = localDateMs(year, month, day, offsetMinutes);
    return {
      period: 'daily',
      value: date,
      start: new Date(startMs).toISOString(),
      end: new Date(startMs + DAY).toISOString(),
      label: `Daily · ${date}`,
    };
  }
  if (p === 'weekly' || p === 'week') {
    const week = value || currentWeek(offsetMinutes, nowMs);
    const range = weekRange(week, offsetMinutes);
    return { period: 'weekly', ...range };
  }
  if (p === 'monthly' || p === 'month') {
    const monthValue = value || currentMonth(offsetMinutes, nowMs);
    const { year, month } = parseMonth(monthValue);
    const startMs = localDateMs(year, month, 1, offsetMinutes);
    const endMs = localDateMs(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1, offsetMinutes);
    return {
      period: 'monthly',
      value: monthValue,
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      label: `Monthly · ${monthValue}`,
    };
  }
  if (p === 'annual' || p === 'yearly' || p === 'year') {
    const year = parseYear(value || currentYear(offsetMinutes, nowMs));
    const startMs = localDateMs(year, 1, 1, offsetMinutes);
    const endMs = localDateMs(year + 1, 1, 1, offsetMinutes);
    return {
      period: 'annual',
      value: String(year),
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      label: `Annual · ${year}`,
    };
  }
  throw new RangeErrorInput('Unsupported report period.');
}

function customRange(from, to, offsetMinutes = 480) {
  const fromParts = parseDateParts(from, 'start date');
  const toParts = parseDateParts(to, 'end date');
  const startMs = localDateMs(fromParts.year, fromParts.month, fromParts.day, offsetMinutes);
  const endMs = localDateMs(toParts.year, toParts.month, toParts.day, offsetMinutes) + DAY;
  if (endMs <= startMs) throw new RangeErrorInput('End date must be after start date.');
  if (endMs - startMs > 800 * DAY) throw new RangeErrorInput('Date range is too wide. Choose 800 days or fewer.');
  return {
    period: 'custom',
    value: `${from}..${to}`,
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    label: `${from} → ${to}`,
  };
}

function eachLocalDate(startIso, endIso, offsetMinutes) {
  const out = [];
  let cursor = Date.parse(startIso);
  const end = Date.parse(endIso);
  while (cursor < end) {
    out.push(localDateString(cursor, offsetMinutes));
    cursor += DAY;
  }
  return out;
}

function lastNDaysStart(n, offsetMinutes, nowMs = Date.now()) {
  const today = todayLocal(offsetMinutes, nowMs);
  const { year, month, day } = parseDateParts(today);
  const startMs = localDateMs(year, month, day, offsetMinutes) - (n - 1) * DAY;
  const endMs = localDateMs(year, month, day, offsetMinutes) + DAY;
  return { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() };
}

module.exports = {
  MINUTE,
  DAY,
  RangeErrorInput,
  pad,
  parseDateParts,
  parseMonth,
  parseYear,
  localDateMs,
  localIso,
  localParts,
  localDateString,
  localTimeString,
  fmtLocal,
  todayLocal,
  currentMonth,
  currentYear,
  currentWeek,
  isoWeekInfo,
  getPeriodMeta,
  periodRange,
  customRange,
  eachLocalDate,
  lastNDaysStart,
};
