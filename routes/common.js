// Shared request plumbing: the transaction wrapper, the per-request context
// (who, when, which season, how much Focus accrued while they were away), and
// the demo-fixture escape hatch the proposal checks run through.

const { Pool } = require('pg');
const periods = require('../game/periods');
const seasons = require('../game/seasons');
const economy = require('../game/economy');
const idle = require('../game/idle');
const content = require('../game/content');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const IS_STAGING = process.env.USERNODE_ENV === 'staging';

// Fabricated read-only payloads, staging only. This is the ONLY thing the
// handful of exempted read paths in server.js can serve without a token —
// every non-demo call re-asserts the 401 in demoOr401 below, and in
// production isDemo() is false forever, so the exemption covers exactly the
// fake bundle and nothing of any real user's data.
const isDemo = (req) => IS_STAGING && req.query.demo === '1';

function demoOr401(req, res, build) {
  if (isDemo(req)) { res.json(build()); return true; }
  if (!req.user) { res.status(401).json({ error: 'Not authenticated' }); return true; }
  return false;
}

const emptyDeltas = () => ({
  focus: 0, sp: 0, resolve: 0, level_up: null, streak: null,
  tier_ups: [], cosmetics: [], objectives: [], messages: [],
});

async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

async function loadGenerators(client, userId) {
  const { rows } = await client.query(
    `SELECT generator_id, level FROM player_generators WHERE user_id = $1`, [userId]
  );
  const levels = {};
  for (const r of rows) levels[r.generator_id] = r.level;
  return levels;
}

async function loadUpgrades(client, userId) {
  const { rows } = await client.query(
    `SELECT upgrade_id FROM player_upgrades WHERE user_id = $1`, [userId]
  );
  return rows.map((r) => r.upgrade_id);
}

// Bank whatever accrued since the last tick, and move the tick forward in the
// SAME transaction. Two tabs refreshing at once cannot both be paid for the
// same interval: the row is locked, the second one sees an already-advanced
// last_tick_at and accrues nothing.
async function tick(client, ctx) {
  const { rows } = await client.query(
    `SELECT last_tick_at FROM player_state WHERE user_id = $1 FOR UPDATE`, [ctx.userId]
  );
  const capSeconds = idle.offlineCapSeconds(ctx.upgrades);
  const result = idle.accrue(rows[0].last_tick_at, ctx.now, ctx.rate, capSeconds);
  if (result.gained > 0) {
    await client.query(
      `UPDATE player_state SET focus = focus + $2, lifetime_focus = lifetime_focus + $2,
         last_tick_at = $3, updated_at = NOW() WHERE user_id = $1`,
      [ctx.userId, result.gained, ctx.now]
    );
    ctx.state.focus = Number(ctx.state.focus) + result.gained;
    ctx.state.lifetime_focus = Number(ctx.state.lifetime_focus) + result.gained;
  } else {
    await client.query(`UPDATE player_state SET last_tick_at = $2 WHERE user_id = $1`, [ctx.userId, ctx.now]);
  }
  ctx.state.last_tick_at = ctx.now;
  ctx.accrued = result;
  return result;
}

// Everything a handler needs about "who is asking, right now".
async function context(client, req) {
  const now = new Date();
  const user = req.user;
  // The client offers its IANA zone on bootstrap; we adopt it only while the
  // stored one is still the UTC default, so an explicit choice in Profile is
  // never overwritten by whatever device the user happens to open next.
  const tzHint = typeof req.query.tz === 'string' ? periods.safeTz(req.query.tz) : null;
  const state = await economy.loadPlayer(client, user, null);
  if (tzHint && tzHint !== 'UTC' && state.timezone === 'UTC') {
    await client.query(`UPDATE player_state SET timezone = $2 WHERE user_id = $1`, [user.id, tzHint]);
    state.timezone = tzHint;
  }
  const ctx = {
    now,
    user,
    userId: user.id,
    state,
    tz: state.timezone,
    keys: periods.keysFor(now, state.timezone),
    season: seasons.seasonAt(now),
    levels: await loadGenerators(client, user.id),
    upgrades: await loadUpgrades(client, user.id),
  };
  ctx.rate = idle.rateFor(ctx.levels, ctx.upgrades);
  await economy.rollDay(client, ctx);
  await tick(client, ctx);
  return ctx;
}

// The one player shape every endpoint returns, so the frontend can update the
// whole header from any response without knowing which endpoint it called.
async function playerPayload(client, ctx) {
  const progress = await economy.loadSeasonProgress(client, ctx);
  const level = ctx.state.journal_level;
  const floorXp = economy.xpForLevel(level);
  const nextXp = economy.xpForLevel(level + 1);
  return {
    user_id: ctx.userId,
    username: ctx.state.username,
    timezone: ctx.state.timezone,
    focus: Math.floor(ctx.state.focus),
    focus_rate: ctx.rate,
    resolve: ctx.state.resolve,
    journal_level: level,
    level_progress: Number(ctx.state.lifetime_xp) - floorXp,
    level_target: nextXp - floorXp,
    lifetime_xp: Number(ctx.state.lifetime_xp),
    streak: economy.liveStreak(ctx.state, ctx.keys.day),
    longest_streak: ctx.state.longest_streak,
    multiplier: economy.streakMultiplier(economy.liveStreak(ctx.state, ctx.keys.day)),
    completions: ctx.state.completions,
    migrations: ctx.state.migrations,
    active_days: ctx.state.active_days,
    lifetime_focus: Math.floor(ctx.state.lifetime_focus),
    rewards_left_today: Math.max(0, economy.DAILY_REWARD_CAP - ctx.state.daily_reward_count),
    reward_cap: economy.DAILY_REWARD_CAP,
    season: { id: ctx.season.id, name: ctx.season.name, ends_at: ctx.season.ends_at },
    season_xp: progress.season_xp,
    tier: progress.tier,
    premium: progress.premium,
    keys: ctx.keys,
    workshop_intro: ctx.state.workshop_intro,
  };
}

// One error shape for every route, and the stack stays in the container log
// rather than going out over the wire.
function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error('[api]', req.method, req.path, err);
      if (!res.headersSent) res.status(500).json({ error: 'server_error' });
    }
  };
}

module.exports = {
  pool, IS_STAGING, isDemo, demoOr401, emptyDeltas, withTx, context,
  playerPayload, loadGenerators, loadUpgrades, tick, handle,
  periods, seasons, economy, idle, content,
};
