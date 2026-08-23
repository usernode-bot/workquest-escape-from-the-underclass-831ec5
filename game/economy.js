// The economy: what a completed task is worth, and every path a currency can
// travel. Four currencies, deliberately different in kind:
//
//   Focus       idle soft currency, spent in the Workshop
//   Season XP   earned by JOURNALLING only, resets with the season
//   Journal Lvl lifetime, never resets, gates Workshop level caps
//   Resolve     premium currency, earned only — there is no way to buy it
//
// Everything that can create Resolve goes through grantResolve() so there is
// exactly one place to audit when the question is "where did this come from".

const content = require('./content');
const seasons = require('./seasons');

const REWARDS = {
  day:   { sp: 10,  focus: 15 },
  week:  { sp: 25,  focus: 40 },
  month: { sp: 60,  focus: 100 },
  year:  { sp: 150, focus: 250 },
};

// Only the first N completions of a day earn. Past that the task still
// completes — it just says so plainly rather than paying out.
const DAILY_REWARD_CAP = 25;

// A one- or two-character title is a tap, not a task.
const MIN_TITLE_LENGTH = 3;

const RITUALS = {
  tray_clear:    { sp: 40 },                 // once per day
  weekly_review: { sp: 200, resolve: 25 },   // once per week
  perfect_day:   { resolve: 5 },             // every task in a ≥3-task Day log
};

const STREAK_STEP = 0.02;   // +2% per consecutive day…
const STREAK_MAX = 0.60;    // …capped at +60% (30 days)

const streakMultiplier = (streak) =>
  1 + Math.min(STREAK_MAX, Math.max(0, (streak || 0) - 1) * STREAK_STEP);

// Journal Level curve. Cumulative XP to REACH level n.
const xpForLevel = (n) => 150 * (n - 1) + 25 * (n - 1) * (n - 1);
function levelFor(xp) {
  let n = 1;
  while (n < 200 && xp >= xpForLevel(n + 1)) n++;
  return n;
}

// ── Player state ────────────────────────────────────────────────────────────

async function loadPlayer(client, user, tzHint) {
  const { rows } = await client.query(
    `INSERT INTO player_state (user_id, username, timezone)
     VALUES ($1, $2, COALESCE($3, 'UTC'))
     ON CONFLICT (user_id) DO UPDATE SET username = EXCLUDED.username
     RETURNING *`,
    [user.id, user.username || ('user' + user.id), tzHint || null]
  );
  const state = rows[0];
  if (state.first_seen) {
    // Everyone starts able to look like something.
    for (const id of content.STARTER_COSMETICS) {
      await client.query(
        `INSERT INTO player_cosmetics (user_id, cosmetic_id, source)
         VALUES ($1, $2, 'starter') ON CONFLICT DO NOTHING`,
        [user.id, id]
      );
    }
    await client.query(
      `INSERT INTO player_loadout (user_id, generator_skin, backdrop, collect_effect, avatar_frame)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [user.id, content.DEFAULT_LOADOUT.generator_skin, content.DEFAULT_LOADOUT.backdrop,
        content.DEFAULT_LOADOUT.collect_effect, content.DEFAULT_LOADOUT.avatar_frame]
    );
    await client.query(`UPDATE player_state SET first_seen = FALSE WHERE user_id = $1`, [user.id]);
    state.first_seen = false;
    state.is_new = true;
  }
  return state;
}

// Lazily roll the per-day counters. Nothing schedules this; it happens the
// first time the user touches the app on a new day, in their own timezone.
async function rollDay(client, ctx) {
  if (ctx.state.daily_reward_date === ctx.keys.day) return;
  await client.query(
    `UPDATE player_state SET daily_reward_date = $2, daily_reward_count = 0 WHERE user_id = $1`,
    [ctx.userId, ctx.keys.day]
  );
  ctx.state.daily_reward_date = ctx.keys.day;
  ctx.state.daily_reward_count = 0;
}

// ── Currency movement ───────────────────────────────────────────────────────

async function ledger(client, userId, currency, amount, reason, sourceRef) {
  await client.query(
    `INSERT INTO currency_ledger (user_id, currency, amount, reason, source_ref)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, currency, Math.round(amount), reason, sourceRef == null ? null : String(sourceRef)]
  );
}

async function addFocus(client, ctx, amount, reason, sourceRef, deltas) {
  if (!amount) return;
  const { rows } = await client.query(
    `UPDATE player_state SET focus = GREATEST(0, focus + $2), updated_at = NOW()
     WHERE user_id = $1 RETURNING focus`,
    [ctx.userId, amount]
  );
  ctx.state.focus = rows[0].focus;
  await ledger(client, ctx.userId, 'focus', amount, reason, sourceRef);
  if (deltas) deltas.focus += amount;
}

// THE single funnel for Resolve. Every grant in the app — tier rewards,
// rituals, objectives — lands here, and nothing else writes the column.
async function grantResolve(client, ctx, amount, reason, sourceRef, deltas) {
  if (!amount || amount <= 0) return;
  const { rows } = await client.query(
    `UPDATE player_state SET resolve = resolve + $2, updated_at = NOW()
     WHERE user_id = $1 RETURNING resolve`,
    [ctx.userId, Math.round(amount)]
  );
  ctx.state.resolve = rows[0].resolve;
  await ledger(client, ctx.userId, 'resolve', amount, reason, sourceRef);
  if (deltas) deltas.resolve += Math.round(amount);
}

async function spendResolve(client, ctx, amount, reason, sourceRef, deltas) {
  const { rows } = await client.query(
    `UPDATE player_state SET resolve = resolve - $2, updated_at = NOW()
     WHERE user_id = $1 AND resolve >= $2 RETURNING resolve`,
    [ctx.userId, Math.round(amount)]
  );
  if (!rows.length) return false;
  ctx.state.resolve = rows[0].resolve;
  await ledger(client, ctx.userId, 'resolve', -amount, reason, sourceRef);
  if (deltas) deltas.resolve -= Math.round(amount);
  return true;
}

async function grantCosmetic(client, ctx, cosmeticId, source, deltas) {
  const c = content.COS_BY_ID.get(cosmeticId);
  if (!c) return;
  const { rowCount } = await client.query(
    `INSERT INTO player_cosmetics (user_id, cosmetic_id, source)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [ctx.userId, cosmeticId, source]
  );
  if (rowCount && deltas) deltas.cosmetics.push({ id: c.id, name: c.name, rarity: c.rarity, slot: c.slot });
}

// ── Season progress ─────────────────────────────────────────────────────────

async function loadSeasonProgress(client, ctx, forUpdate) {
  const { rows } = await client.query(
    `INSERT INTO season_progress (user_id, season_id) VALUES ($1, $2)
     ON CONFLICT (user_id, season_id) DO UPDATE SET season_id = EXCLUDED.season_id
     RETURNING *`,
    [ctx.userId, ctx.season.id]
  );
  if (forUpdate) {
    const l = await client.query(
      `SELECT * FROM season_progress WHERE user_id = $1 AND season_id = $2 FOR UPDATE`,
      [ctx.userId, ctx.season.id]
    );
    return l.rows[0];
  }
  return rows[0];
}

async function payTierReward(client, ctx, reward, tier, track, deltas) {
  const ref = `${ctx.season.id}:t${tier}:${track}`;
  if (reward.kind === 'focus') await addFocus(client, ctx, reward.amount, 'tier_reward', ref, deltas);
  else if (reward.kind === 'resolve') await grantResolve(client, ctx, reward.amount, 'tier_reward', ref, deltas);
  else if (reward.kind === 'cosmetic') await grantCosmetic(client, ctx, reward.cosmetic_id, 'tier_reward', deltas);
}

// Release every reward between the watermark and the tier now reached.
// Idempotent by construction: the watermark only ever moves forward, so
// replaying this — after a retry, a second tab, or a premium unlock — pays
// exactly the tiers that have not been paid.
async function releaseTiers(client, ctx, progress, deltas) {
  const track = seasons.tiersFor(ctx.season);
  let free = progress.granted_free_tier;
  let prem = progress.granted_premium_tier;
  for (let t = free + 1; t <= progress.tier; t++) {
    await payTierReward(client, ctx, track[t - 1].free, t, 'free', deltas);
    if (deltas) deltas.tier_ups.push({ tier: t, track: 'free', label: track[t - 1].free.label });
    free = t;
  }
  if (progress.premium) {
    for (let t = prem + 1; t <= progress.tier; t++) {
      await payTierReward(client, ctx, track[t - 1].premium, t, 'premium', deltas);
      if (deltas) deltas.tier_ups.push({ tier: t, track: 'premium', label: track[t - 1].premium.label });
      prem = t;
    }
  }
  if (free !== progress.granted_free_tier || prem !== progress.granted_premium_tier) {
    await client.query(
      `UPDATE season_progress SET granted_free_tier = $3, granted_premium_tier = $4, updated_at = NOW()
       WHERE user_id = $1 AND season_id = $2`,
      [ctx.userId, ctx.season.id, free, prem]
    );
    progress.granted_free_tier = free;
    progress.granted_premium_tier = prem;
  }
}

// Season XP in, tier-ups out. Tier is always RECOMPUTED from total XP rather
// than incremented, so a bug in one caller can never leave the tier and the
// XP disagreeing.
async function awardSeasonXp(client, ctx, amount, reason, sourceRef, deltas) {
  if (!amount || amount <= 0) return;
  const rounded = Math.round(amount);
  const progress = await loadSeasonProgress(client, ctx, true);
  const xp = progress.season_xp + rounded;
  // Skipped tiers are bought, not earned, so they sit on top of the XP maths
  // instead of being recomputed away by the next completion.
  const tier = Math.min(ctx.season.tiers,
    Math.floor(xp / ctx.season.sp_per_tier) + (progress.skips_used || 0));
  const { rows } = await client.query(
    `UPDATE season_progress SET season_xp = $3, tier = $4, updated_at = NOW()
     WHERE user_id = $1 AND season_id = $2 RETURNING *`,
    [ctx.userId, ctx.season.id, xp, tier]
  );
  const updated = rows[0];
  if (deltas) deltas.sp += rounded;
  await ledger(client, ctx.userId, 'sp', rounded, reason, sourceRef);

  // Journal Level is lifetime and tracks the same effort, so it moves here
  // too — but out of its own column, which no season reset ever touches.
  const before = ctx.state.journal_level;
  const lifetime = Number(ctx.state.lifetime_xp) + rounded;
  const level = levelFor(lifetime);
  await client.query(
    `UPDATE player_state SET lifetime_xp = $2, journal_level = $3, updated_at = NOW() WHERE user_id = $1`,
    [ctx.userId, lifetime, level]
  );
  ctx.state.lifetime_xp = lifetime;
  ctx.state.journal_level = level;
  if (deltas && level > before) deltas.level_up = level;

  await releaseTiers(client, ctx, updated, deltas);
}

// ── Streak ──────────────────────────────────────────────────────────────────

// Called on the first EARNING completion of a day. A day you only read the
// app does not count; a day you finished something does.
async function noteActive(client, ctx, deltas) {
  const today = ctx.keys.day;
  if (ctx.state.last_active_date === today) return;
  const periods = require('./periods');
  const yesterday = periods.step('day', today, -1);
  const streak = ctx.state.last_active_date === yesterday ? (ctx.state.streak_count || 0) + 1 : 1;
  const longest = Math.max(streak, ctx.state.longest_streak || 0);
  await client.query(
    `UPDATE player_state SET last_active_date = $2, streak_count = $3, longest_streak = $4,
       active_days = active_days + 1, updated_at = NOW() WHERE user_id = $1`,
    [ctx.userId, today, streak, longest]
  );
  ctx.state.last_active_date = today;
  ctx.state.streak_count = streak;
  ctx.state.longest_streak = longest;
  ctx.state.active_days = (ctx.state.active_days || 0) + 1;
  if (deltas) deltas.streak = streak;
  await bumpObjectives(client, ctx, 'day_active', 1, deltas);
}

// A streak is only alive if it was fed today or yesterday. Nothing writes
// this on a schedule — it is read as "the streak as of now".
function liveStreak(state, todayKey) {
  const periods = require('./periods');
  if (!state.last_active_date) return 0;
  if (state.last_active_date === todayKey) return state.streak_count;
  if (state.last_active_date === periods.step('day', todayKey, -1)) return state.streak_count;
  return 0;
}

// ── Objectives ──────────────────────────────────────────────────────────────

function slatesFor(ctx) {
  return [].concat(
    seasons.dailyObjectives(ctx.keys.day).map((o) => ({ o, scope: 'daily', period_key: ctx.keys.day })),
    seasons.weeklyObjectives(ctx.keys.week).map((o) => ({ o, scope: 'weekly', period_key: ctx.keys.week })),
    seasons.seasonObjectives().map((o) => ({ o, scope: 'season', period_key: ctx.season.id }))
  );
}

async function loadObjectives(client, ctx) {
  const slate = slatesFor(ctx);
  const { rows } = await client.query(
    `SELECT objective_id, period_key, progress, completed FROM season_objectives
     WHERE user_id = $1 AND season_id = $2`,
    [ctx.userId, ctx.season.id]
  );
  const byKey = new Map(rows.map((r) => [r.objective_id + '|' + r.period_key, r]));
  return slate.map(({ o, scope, period_key }) => {
    const row = byKey.get(o.id + '|' + period_key);
    const progress = row ? Math.min(row.progress, o.target) : 0;
    return {
      id: o.id, scope, label: o.label, target: o.target,
      sp: o.sp || 0, resolve: o.resolve || 0,
      period_key, progress,
      completed: row ? row.completed : false,
    };
  });
}

// Bump every objective on the current slates that watches `metric`.
async function bumpObjectives(client, ctx, metric, amount, deltas) {
  if (!amount) return;
  for (const { o, scope, period_key } of slatesFor(ctx)) {
    if (o.metric !== metric) continue;
    const { rows } = await client.query(
      `INSERT INTO season_objectives (user_id, season_id, objective_id, scope, period_key, progress)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, objective_id, period_key)
         DO UPDATE SET progress = season_objectives.progress + $6, updated_at = NOW()
       RETURNING progress, completed`,
      [ctx.userId, ctx.season.id, o.id, scope, period_key, amount]
    );
    const row = rows[0];
    if (row.completed || row.progress < o.target) continue;
    const claimed = await client.query(
      `UPDATE season_objectives SET completed = TRUE, completed_at = NOW()
       WHERE user_id = $1 AND objective_id = $2 AND period_key = $3 AND completed = FALSE
       RETURNING objective_id`,
      [ctx.userId, o.id, period_key]
    );
    if (!claimed.rowCount) continue;   // another request in flight got there first
    const ref = `obj:${o.id}:${period_key}`;
    if (o.sp) await awardSeasonXp(client, ctx, o.sp, 'objective', ref, deltas);
    if (o.resolve) await grantResolve(client, ctx, o.resolve, 'objective', ref, deltas);
    if (deltas) deltas.objectives.push({ id: o.id, label: o.label, sp: o.sp || 0, resolve: o.resolve || 0 });
  }
}

module.exports = {
  REWARDS, DAILY_REWARD_CAP, MIN_TITLE_LENGTH, RITUALS,
  STREAK_STEP, STREAK_MAX, streakMultiplier, xpForLevel, levelFor,
  loadPlayer, rollDay, ledger, addFocus, grantResolve, spendResolve, grantCosmetic,
  loadSeasonProgress, releaseTiers, awardSeasonXp, payTierReward,
  noteActive, liveStreak, loadObjectives, bumpObjectives,
};
