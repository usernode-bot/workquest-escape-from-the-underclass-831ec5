// Deterministic ?demo=1 payloads.
//
// These exist because a staging preview of a brand-new table is an empty
// screen, and an empty screen tells a reviewer nothing about the change. They
// are READ-ONLY and request-time: nothing here touches the database, so no
// code path can mistake a fixture for a real row (see the platform's
// "seeded data must not fabricate a signal your logic reads").
//
// Every payload mirrors the real one field for field. If a shape drifts here,
// the demo screens start lying about the app.

const periods = require('./periods');
const seasons = require('./seasons');
const content = require('./content');
const economy = require('./economy');
const idle = require('./idle');

const TZ = 'UTC';
const PREFIX = 'Staging demo — ';

const purchasesEnabled = () =>
  String(process.env.PURCHASES_ENABLED || 'false').toLowerCase() === 'true';

function ctxish() {
  const now = new Date();
  return { now, keys: periods.keysFor(now, TZ), season: seasons.seasonAt(now) };
}

// A plausible mid-game player: far enough in that every screen has something
// to show, obviously fake enough that nobody mistakes it for their own save.
const LEVEL = 9;
const STREAK = 12;
const SEASON_XP = 4380;
const GEN_LEVELS = {
  gen_notepad: 22, gen_lamp: 15, gen_cabinet: 9, gen_coffee: 4, gen_whiteboard: 1,
};
const UPGRADE_IDS = ['up_thermos', 'up_timer', 'up_labels'];
const OWNED_COSMETICS = [
  'skin_graphite', 'back_paper', 'fx_tick', 'frame_clip',
  'skin_blueprint', 'back_dusk', 'fx_sparks', 'frame_steel', 'skin_neon_desk',
];
const LOADOUT = {
  generator_skin: 'skin_blueprint',
  backdrop: 'back_dusk',
  collect_effect: 'fx_sparks',
  avatar_frame: 'frame_steel',
};

const rate = () => idle.rateFor(GEN_LEVELS, UPGRADE_IDS);

function player() {
  const c = ctxish();
  const floorXp = economy.xpForLevel(LEVEL);
  const nextXp = economy.xpForLevel(LEVEL + 1);
  const lifetime = floorXp + Math.round((nextXp - floorXp) * 0.42);
  return {
    user_id: 900001,
    username: 'staging-demo-journaler',
    timezone: TZ,
    focus: 184320,
    focus_rate: rate(),
    resolve: 480,
    journal_level: LEVEL,
    level_progress: lifetime - floorXp,
    level_target: nextXp - floorXp,
    lifetime_xp: lifetime,
    streak: STREAK,
    longest_streak: 18,
    multiplier: economy.streakMultiplier(STREAK),
    completions: 213,
    migrations: 37,
    active_days: 46,
    lifetime_focus: 2410500,
    rewards_left_today: 19,
    reward_cap: economy.DAILY_REWARD_CAP,
    season: { id: c.season.id, name: c.season.name, ends_at: c.season.ends_at },
    season_xp: SEASON_XP,
    tier: Math.floor(SEASON_XP / c.season.sp_per_tier),
    premium: false,
    keys: c.keys,
    workshop_intro: true,
    demo: true,
  };
}

let nextId = 90001;
function entry(horizon, periodKey, title, over) {
  return Object.assign({
    id: nextId++,
    horizon,
    period_key: periodKey,
    title: PREFIX + title,
    note: null,
    status: 'open',
    priority: false,
    sort_order: 0,
    migration_count: 0,
    rewarded: false,
    migrated_to: null,
    migrated_from: null,
  }, over || {});
}

// Entries only ever exist in the CURRENT period. Step back a day and the demo
// log is honestly empty — which is the state the empty-state screenshot link
// needs to be able to reach.
function entriesFor(horizon, keys) {
  nextId = 90001 + periods.HORIZONS.indexOf(horizon) * 100;
  const k = keys[horizon];
  if (horizon === 'day') {
    return [
      entry('day', k, 'Ship the thing I keep rewriting', { priority: true }),
      entry('day', k, 'Reply to the long email', { status: 'done', rewarded: true }),
      entry('day', k, 'Walk before it gets dark', { status: 'done', rewarded: true }),
      entry('day', k, 'Read ten pages', { note: 'Any ten. It counts.' }),
      entry('day', k, 'Sort the desk drawer', {
        status: 'migrated', migrated_to: periods.shortLabel('week', keys.week),
      }),
      entry('day', k, 'Argue with the printer', { status: 'dropped' }),
      entry('day', k, 'Draft the retro notes', {
        migration_count: 1, migrated_from: periods.shortLabel('day', periods.step('day', k, -1)),
      }),
    ];
  }
  if (horizon === 'week') {
    return [
      entry('week', k, 'Plan the next release', { priority: true }),
      entry('week', k, 'Two long-focus mornings', { status: 'done', rewarded: true }),
      entry('week', k, 'Sort the desk drawer', {
        migration_count: 1, migrated_from: periods.shortLabel('day', keys.day),
      }),
      entry('week', k, 'Call the bank back'),
    ];
  }
  if (horizon === 'month') {
    return [
      entry('month', k, 'Finish the quarterly write-up', { priority: true }),
      entry('month', k, 'Rebuild the budget sheet', { status: 'done', rewarded: true }),
      entry('month', k, 'One weekend with no screens'),
    ];
  }
  return [
    entry('year', k, 'Learn to actually swim', { priority: true }),
    entry('year', k, 'Write the book proposal'),
    entry('year', k, 'Visit the coast in winter', { status: 'done', rewarded: true }),
  ];
}

function trayEntries(keys) {
  nextId = 90600;
  const yesterday = periods.step('day', keys.day, -1);
  return [
    entry('day', yesterday, 'Book the dentist'),
    entry('day', yesterday, 'Send the invoice', { priority: true }),
    entry('day', periods.step('day', keys.day, -2), 'Back up the laptop'),
  ];
}

function log(horizon, askedPeriod) {
  const c = ctxish();
  const h = periods.HORIZONS.includes(horizon) ? horizon : 'day';
  const key = periods.isValidKey(h, askedPeriod) ? askedPeriod : c.keys[h];
  const isCurrent = key === c.keys[h];
  const entries = isCurrent ? entriesFor(h, c.keys) : [];
  const tray = trayEntries(c.keys);
  return {
    log: {
      horizon: h,
      period_key: key,
      label: periods.label(h, key, c.keys),
      is_current: isCurrent,
      prev_key: periods.step(h, key, -1),
      next_key: periods.step(h, key, 1),
      current_key: c.keys[h],
      entries,
      counts: {
        open: entries.filter((e) => e.status === 'open').length,
        done: entries.filter((e) => e.status === 'done').length,
        total: entries.length,
      },
      tray_count: tray.length,
      review_due: h === 'week' && isCurrent,
    },
    player: player(),
    demo: true,
  };
}

function tray() {
  return { entries: trayEntries(ctxish().keys), player: player(), demo: true };
}

function gameState() {
  const r = rate();
  const generators = content.GENERATORS.map((g) => {
    const owned = GEN_LEVELS[g.id] || 0;
    const cap = content.genCap(g, LEVEL);
    const cost = content.genCost(g, owned);
    const locked = LEVEL < g.unlock;
    return {
      id: g.id, name: g.name, blurb: g.blurb,
      level: owned, cap, cost, rate_each: g.rate,
      output: idle.rateFor({ [g.id]: owned }, UPGRADE_IDS),
      locked,
      lock_reason: locked ? `Unlocks at Journal Level ${g.unlock}`
        : (owned >= cap ? `Capped — raise your Journal Level to build past ${cap}` : null),
      at_cap: !locked && owned >= cap,
      affordable: !locked && owned < cap && 184320 >= cost,
    };
  });
  const upgrades = content.UPGRADES.map((u) => ({
    id: u.id, name: u.name, blurb: u.blurb, cost: u.cost,
    owned: UPGRADE_IDS.includes(u.id),
    locked: LEVEL < u.unlock,
    lock_reason: LEVEL < u.unlock ? `Unlocks at Journal Level ${u.unlock}` : null,
    affordable: !UPGRADE_IDS.includes(u.id) && LEVEL >= u.unlock && 184320 >= u.cost,
  }));
  return {
    player: player(),
    generators,
    upgrades,
    idle: {
      rate: r,
      offline_cap_hours: idle.offlineCapSeconds(UPGRADE_IDS) / 3600,
      away_gained: Math.floor(r * 3600 * 3.5),
      away_seconds: Math.round(3.5 * 3600),
      away_capped: false,
    },
    collect: { amount: Math.max(25, Math.round(r * 60)), ready_in: 0, cooldown: 300 },
    demo: true,
  };
}

function profile() {
  const owned = new Set(OWNED_COSMETICS);
  return {
    player: player(),
    slots: content.SLOTS,
    rarities: content.RARITY,
    loadout: LOADOUT,
    locker: content.COSMETICS.map((c) => ({
      id: c.id, name: c.name, slot: c.slot, rarity: c.rarity, css: c.css,
      owned: owned.has(c.id),
      equipped: LOADOUT[c.slot] === c.id,
    })),
    owned_count: owned.size,
    total_count: content.COSMETICS.length,
    demo: true,
  };
}

function decorate(reward) {
  if (!reward) return null;
  const out = { kind: reward.kind, label: reward.label };
  if (reward.amount != null) out.amount = reward.amount;
  if (reward.kind === 'cosmetic') {
    const c = content.COS_BY_ID.get(reward.cosmetic_id);
    out.cosmetic_id = reward.cosmetic_id;
    if (c) { out.rarity = c.rarity; out.slot = c.slot; out.css = c.css; out.name = c.name; }
  }
  return out;
}

function season() {
  const c = ctxish();
  const spPer = c.season.sp_per_tier;
  const tier = Math.min(c.season.tiers, Math.floor(SEASON_XP / spPer));
  const track = seasons.tiersFor(c.season).map((row) => ({
    tier: row.tier,
    free: decorate(row.free),
    premium: decorate(row.premium),
    unlocked: row.tier <= tier,
    free_claimed: row.tier <= tier,
    premium_claimed: false,
  }));
  const objectives = []
    .concat(seasons.dailyObjectives(c.keys.day).map((o, i) => ({
      id: o.id, scope: 'daily', label: o.label, target: o.target,
      sp: o.sp || 0, resolve: o.resolve || 0, period_key: c.keys.day,
      progress: [o.target, Math.max(1, Math.floor(o.target / 2)), 0][i % 3],
    })))
    .concat(seasons.weeklyObjectives(c.keys.week).map((o, i) => ({
      id: o.id, scope: 'weekly', label: o.label, target: o.target,
      sp: o.sp || 0, resolve: o.resolve || 0, period_key: c.keys.week,
      progress: [Math.floor(o.target * 0.6), o.target, 1, 0, 2][i % 5],
    })))
    .concat(seasons.seasonObjectives().map((o, i) => ({
      id: o.id, scope: 'season', label: o.label, target: o.target,
      sp: o.sp || 0, resolve: o.resolve || 0, period_key: c.season.id,
      progress: [Math.floor(o.target * 0.35), Math.floor(o.target * 0.8), 0][i % 3],
    })))
    .map((o) => Object.assign(o, {
      progress: Math.min(o.progress, o.target),
      completed: o.progress >= o.target,
    }));
  return {
    season: {
      id: c.season.id, name: c.season.name,
      starts_at: c.season.starts_at, ends_at: c.season.ends_at,
      tiers: c.season.tiers, sp_per_tier: spPer,
      premium_cost: c.season.premium_cost,
      skip_cost: c.season.skip_cost,
      max_skips: c.season.max_skips,
    },
    player: player(),
    progress: {
      season_xp: SEASON_XP,
      tier,
      earned_tier: tier,
      tier_progress: SEASON_XP % spPer,
      tier_target: spPer,
      premium: false,
      skips_used: 1,
      max_skips: c.season.max_skips,
      granted_free_tier: tier,
      granted_premium_tier: 0,
    },
    track,
    objectives,
    resolve: 480,
    can_unlock: 480 >= c.season.premium_cost,
    can_skip: 480 >= c.season.skip_cost,
    purchases_enabled: purchasesEnabled(),
    demo: true,
  };
}

function bootstrap() {
  const c = ctxish();
  return {
    player: player(),
    log: log('day').log,
    tray: trayEntries(c.keys),
    targets: periods.TARGETS.map((t) => ({ token: t.token, label: t.label })),
    horizons: periods.HORIZONS,
    purchases_enabled: purchasesEnabled(),
    demo: true,
  };
}

module.exports = { log, tray, gameState, profile, season, bootstrap };
