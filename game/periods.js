// Period keys — the spine of the journal.
//
// Every log is addressed by (horizon, period_key), and the key is ALWAYS
// computed here, on the server, in the user's own timezone. A client that
// sends a period key is telling us which log to read; it never gets to tell
// us which log "today" is, because that decision decides rewards.
//
//   day   YYYY-MM-DD
//   week  YYYY-Www   ISO-8601, Monday-start, using the ISO year (which in
//                    the last/first days of a year is NOT the calendar year)
//   month YYYY-MM
//   year  YYYY

const HORIZONS = ['day', 'week', 'month', 'year'];
const MS_DAY = 86400000;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

// Is this a zone Intl can actually resolve? safeTz() below falls back to UTC
// for anything else, which is right for reading a stored value but wrong for
// accepting a new one — see POST /profile/timezone.
function validTz(tz) {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function safeTz(tz) {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    // A timezone we cannot resolve is worse than UTC: it would throw on every
    // request. Fall back rather than break the whole journal.
    return 'UTC';
  }
}

// Calendar date as seen from `tz` at instant `date`.
function civil(date, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTz(tz), year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

const pad2 = (n) => String(n).padStart(2, '0');
const utc = (y, m, d) => Date.UTC(y, m - 1, d);

// ISO week number + ISO year for a civil date.
function isoWeek(y, m, d) {
  const t = new Date(utc(y, m, d));
  const dow = (t.getUTCDay() + 6) % 7;            // Monday = 0
  t.setUTCDate(t.getUTCDate() - dow + 3);          // the week's Thursday
  const isoYear = t.getUTCFullYear();
  const jan4 = new Date(utc(isoYear, 1, 4));
  const jan4dow = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = jan4.getTime() - jan4dow * MS_DAY;
  const thisMonday = t.getTime() - 3 * MS_DAY;
  return { isoYear, week: Math.round((thisMonday - week1Monday) / (7 * MS_DAY)) + 1 };
}

// Monday of an ISO week, as a UTC-midnight timestamp.
function isoWeekMonday(isoYear, week) {
  const jan4 = new Date(utc(isoYear, 1, 4));
  const jan4dow = (jan4.getUTCDay() + 6) % 7;
  return jan4.getTime() - jan4dow * MS_DAY + (week - 1) * 7 * MS_DAY;
}

function keysFor(date, tz) {
  const { y, m, d } = civil(date, tz);
  const w = isoWeek(y, m, d);
  return {
    day: `${y}-${pad2(m)}-${pad2(d)}`,
    week: `${w.isoYear}-W${pad2(w.week)}`,
    month: `${y}-${pad2(m)}`,
    year: String(y),
  };
}

function isValidKey(horizon, key) {
  if (typeof key !== 'string') return false;
  if (horizon === 'day') return /^\d{4}-\d{2}-\d{2}$/.test(key);
  if (horizon === 'week') return /^\d{4}-W\d{2}$/.test(key);
  if (horizon === 'month') return /^\d{4}-\d{2}$/.test(key);
  if (horizon === 'year') return /^\d{4}$/.test(key);
  return false;
}

// Move a period key by `delta` whole periods. Used by the log stepper and by
// the symbolic migration targets below.
function step(horizon, key, delta) {
  delta = Math.trunc(delta) || 0;
  if (horizon === 'day') {
    const [y, m, d] = key.split('-').map(Number);
    const t = new Date(utc(y, m, d) + delta * MS_DAY);
    return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
  }
  if (horizon === 'week') {
    const [iy, w] = key.split('-W').map(Number);
    const t = new Date(isoWeekMonday(iy, w) + delta * 7 * MS_DAY);
    const nw = isoWeek(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
    return `${nw.isoYear}-W${pad2(nw.week)}`;
  }
  if (horizon === 'month') {
    const [y, m] = key.split('-').map(Number);
    const n = y * 12 + (m - 1) + delta;
    return `${Math.floor(n / 12)}-${pad2((n % 12) + 1)}`;
  }
  return String(Number(key) + delta);
}

// Plain-language label, relative to where the user is standing right now.
// "Today" reads better than "2026-08-23" everywhere it appears.
function label(horizon, key, now) {
  if (horizon === 'day') {
    const diff = Math.round((Date.parse(key + 'T00:00:00Z') - Date.parse(now.day + 'T00:00:00Z')) / MS_DAY);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    const [y, m, d] = key.split('-').map(Number);
    const dow = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(utc(y, m, d)).getUTCDay()];
    const base = `${dow}, ${d} ${MONTHS[m - 1].slice(0, 3)}`;
    return y === Number(now.year) ? base : `${base} ${y}`;
  }
  if (horizon === 'week') {
    if (key === now.week) return 'This week';
    if (key === step('week', now.week, 1)) return 'Next week';
    if (key === step('week', now.week, -1)) return 'Last week';
    const [iy, w] = key.split('-W').map(Number);
    const mon = new Date(isoWeekMonday(iy, w));
    return `Week ${w} · from ${mon.getUTCDate()} ${MONTHS[mon.getUTCMonth()].slice(0, 3)}`;
  }
  if (horizon === 'month') {
    if (key === now.month) return 'This month';
    if (key === step('month', now.month, 1)) return 'Next month';
    if (key === step('month', now.month, -1)) return 'Last month';
    const [y, m] = key.split('-').map(Number);
    return y === Number(now.year) ? MONTHS[m - 1] : `${MONTHS[m - 1]} ${y}`;
  }
  if (key === now.year) return 'This year';
  if (key === step('year', now.year, 1)) return 'Next year';
  if (key === step('year', now.year, -1)) return 'Last year';
  return key;
}

// Short label for the "migrated to" caption on a stub row.
function shortLabel(horizon, key) {
  if (horizon === 'day') {
    const [, m, d] = key.split('-').map(Number);
    return `${d} ${MONTHS[m - 1].slice(0, 3)}`;
  }
  if (horizon === 'week') return `Week ${Number(key.split('-W')[1])}`;
  if (horizon === 'month') {
    const [, m] = key.split('-').map(Number);
    return MONTHS[m - 1];
  }
  return key;
}

// Migration destinations are SYMBOLIC tokens, never period keys off the wire.
// The client says "next week"; the server decides what next week is.
const TARGETS = [
  { token: 'tomorrow', label: 'Tomorrow', horizon: 'day', delta: 1 },
  { token: 'this_week', label: 'This week', horizon: 'week', delta: 0 },
  { token: 'next_week', label: 'Next week', horizon: 'week', delta: 1 },
  { token: 'this_month', label: 'This month', horizon: 'month', delta: 0 },
  { token: 'next_month', label: 'Next month', horizon: 'month', delta: 1 },
  { token: 'this_year', label: 'This year', horizon: 'year', delta: 0 },
  { token: 'next_year', label: 'Next year', horizon: 'year', delta: 1 },
  { token: 'today', label: 'Today', horizon: 'day', delta: 0 },
];

function resolveTarget(token, now) {
  const t = TARGETS.find((x) => x.token === token);
  if (!t) return null;
  return { horizon: t.horizon, period_key: step(t.horizon, now[t.horizon], t.delta) };
}

// Is `key` strictly before the current period of the same horizon?
function isPast(horizon, key, now) {
  if (horizon === 'day' || horizon === 'month') return key < now[horizon];
  if (horizon === 'year') return Number(key) < Number(now.year);
  const [ay, aw] = key.split('-W').map(Number);
  const [by, bw] = now.week.split('-W').map(Number);
  return ay < by || (ay === by && aw < bw);
}

module.exports = {
  HORIZONS, MS_DAY, safeTz, validTz, civil, keysFor, isValidKey, step, label,
  shortLabel, isPast, TARGETS, resolveTarget, isoWeek,
};
