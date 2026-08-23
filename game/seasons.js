// Seasons, the reward track, and objectives.
//
// Seasons run on a fixed six-week cadence from a hard-coded epoch, so "which
// season is it" is a pure function of the clock — no scheduler, no rows to
// insert, and every container agrees. Season XP is stored per season id, so a
// new season starts at zero without anything having to reset it.

const { COSMETICS, COS_BY_ID } = require('./content');

const EPOCH = Date.UTC(2026, 6, 6);          // Monday 6 July 2026, 00:00 UTC
const LENGTH_MS = 6 * 7 * 86400000;          // six weeks
const TIERS = 50;
const SP_PER_TIER = 300;
const PREMIUM_COST = 900;                    // Resolve, one-time, retroactive
const SKIP_COST = 60;                        // Resolve per tier
const MAX_SKIPS = 5;                         // per season

const NAMES = [
  'Season of Small Beginnings',
  'Season of the Second Draft',
  'Season of Quiet Machines',
  'Season of the Long List',
];

const FREE_COSMETICS = COSMETICS.filter((x) => x.rarity === 'common' || x.rarity === 'rare').map((x) => x.id);
const PREMIUM_COSMETICS = COSMETICS.filter((x) => x.rarity === 'epic' || x.rarity === 'legendary').map((x) => x.id);
const LEGENDARIES = COSMETICS.filter((x) => x.rarity === 'legendary').map((x) => x.id);

const focus = (n) => ({ kind: 'focus', amount: n, label: n.toLocaleString('en-US') + ' Focus' });
const resolve = (n) => ({ kind: 'resolve', amount: n, label: n + ' Resolve' });
const cosmetic = (id) => {
  const c = COS_BY_ID.get(id);
  return { kind: 'cosmetic', cosmetic_id: id, rarity: c.rarity, slot: c.slot, label: c.name };
};

// The track is generated rather than hand-listed: 50 tiers × 2 rows is a lot
// of rows to keep honest by hand, and the pattern (a cosmetic on the tens, a
// Resolve drop on the fives, Focus in between) is the design.
function buildTiers(seasonIndex) {
  const out = [];
  for (let t = 1; t <= TIERS; t++) {
    const scale = Math.round(400 * Math.pow(1.16, t - 1));
    let free;
    if (t % 10 === 0) free = cosmetic(FREE_COSMETICS[((t / 10 - 1) + seasonIndex) % FREE_COSMETICS.length]);
    else if (t % 5 === 0) free = resolve(15);
    else free = focus(scale);

    let prem;
    // The last tier is always a Legendary — it is the thing the whole track
    // is walking toward, and a rotation that landed an Epic there would read
    // as an anticlimax.
    if (t === TIERS) prem = cosmetic(LEGENDARIES[seasonIndex % LEGENDARIES.length]);
    else if (t % 7 === 0) prem = cosmetic(PREMIUM_COSMETICS[(Math.floor(t / 7) - 1 + seasonIndex) % PREMIUM_COSMETICS.length]);
    else if (t % 5 === 0) prem = resolve(45);
    else prem = focus(scale * 3);

    out.push({ tier: t, free, premium: prem });
  }
  return out;
}

function seasonAt(now) {
  const ms = (now instanceof Date ? now.getTime() : now) - EPOCH;
  const index = Math.max(0, Math.floor(ms / LENGTH_MS));
  const startsAt = new Date(EPOCH + index * LENGTH_MS);
  const endsAt = new Date(EPOCH + (index + 1) * LENGTH_MS);
  return {
    id: 's' + (index + 1),
    index,
    name: NAMES[index % NAMES.length],
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    tiers: TIERS,
    sp_per_tier: SP_PER_TIER,
    premium_cost: PREMIUM_COST,
    skip_cost: SKIP_COST,
    max_skips: MAX_SKIPS,
  };
}

function tiersFor(season) {
  return buildTiers(season.index);
}

// ── Objectives ──────────────────────────────────────────────────────────────
// A `metric` is bumped by economy.bumpObjectives() when the matching thing
// happens. Daily and weekly slates are drawn deterministically from the pool
// by hashing the period key, so everyone on the same day gets the same board
// and it is reproducible from the key alone.

const DAILY_POOL = [
  { id: 'd_log3',     label: 'Log 3 tasks in any horizon',      metric: 'create',        target: 3,  sp: 50 },
  { id: 'd_done3',    label: 'Complete 3 tasks',                metric: 'complete',      target: 3,  sp: 50 },
  { id: 'd_daily2',   label: 'Complete 2 tasks in a Day log',   metric: 'complete_day',  target: 2,  sp: 50 },
  { id: 'd_migrate1', label: 'Migrate a task forward',          metric: 'migrate',       target: 1,  sp: 50 },
  { id: 'd_collect',  label: 'Collect from the Workshop',       metric: 'collect',       target: 1,  sp: 50 },
  { id: 'd_star',     label: 'Complete a starred task',         metric: 'complete_star', target: 1,  sp: 50 },
  { id: 'd_tray',     label: 'Clear the migration tray',        metric: 'tray_clear',    target: 1,  sp: 50 },
];

const WEEKLY_POOL = [
  { id: 'w_done15',   label: 'Complete 15 tasks',               metric: 'complete',      target: 15, sp: 200 },
  { id: 'w_week3',    label: 'Complete 3 tasks in Week logs',   metric: 'complete_week', target: 3,  sp: 200 },
  { id: 'w_month1',   label: 'Complete a Month-log task',       metric: 'complete_month', target: 1, sp: 200 },
  { id: 'w_migrate5', label: 'Migrate 5 tasks rather than drop them', metric: 'migrate', target: 5,  sp: 200 },
  { id: 'w_buy3',     label: 'Buy 3 Workshop levels',           metric: 'buy',           target: 3,  sp: 200 },
  { id: 'w_review',   label: 'Run the weekly review',           metric: 'review',        target: 1,  sp: 200 },
  { id: 'w_log20',    label: 'Log 20 tasks',                    metric: 'create',        target: 20, sp: 200 },
  { id: 'w_streak5',  label: 'Journal on 5 different days',     metric: 'day_active',    target: 5,  sp: 200 },
];

// Season-long objectives pay Resolve — the premium currency you can only
// earn. They are the same three every season on purpose: they are the
// long-horizon habit the whole app is arguing for.
const SEASON_POOL = [
  { id: 's_done200',  label: 'Complete 200 tasks this season',  metric: 'complete', target: 200, resolve: 250 },
  { id: 's_year5',    label: 'Complete 5 Year-log tasks',       metric: 'complete_year', target: 5, resolve: 200 },
  { id: 's_reviews4', label: 'Run 4 weekly reviews',            metric: 'review',   target: 4,   resolve: 300 },
];

// Small, stable string hash. Not security — just a deterministic shuffle seed.
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick(pool, key, count) {
  const rotated = pool.slice();
  const start = hash(key) % pool.length;
  const out = [];
  for (let i = 0; i < count && i < pool.length; i++) out.push(rotated[(start + i * 3) % pool.length]);
  // The stride can revisit an entry on some pool sizes; de-dupe and top up.
  const seen = new Set();
  const unique = out.filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)));
  for (let i = 0; unique.length < count && i < pool.length; i++) {
    if (!seen.has(pool[i].id)) { seen.add(pool[i].id); unique.push(pool[i]); }
  }
  return unique;
}

const dailyObjectives = (dayKey) => pick(DAILY_POOL, 'd' + dayKey, 3);
const weeklyObjectives = (weekKey) => pick(WEEKLY_POOL, 'w' + weekKey, 5);
const seasonObjectives = () => SEASON_POOL.slice();

const ALL_OBJECTIVES = new Map(
  [].concat(DAILY_POOL, WEEKLY_POOL, SEASON_POOL).map((o) => [o.id, o])
);

module.exports = {
  TIERS, SP_PER_TIER, PREMIUM_COST, SKIP_COST, MAX_SKIPS, LENGTH_MS,
  seasonAt, tiersFor, dailyObjectives, weeklyObjectives, seasonObjectives,
  ALL_OBJECTIVES,
};
