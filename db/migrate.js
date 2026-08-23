// Schema, applied idempotently on every boot.
//
// Two rules shape what is here:
//
//   1. Content is NOT in the database. There is no `generators` table and no
//      `tiers` table — those live in game/*.js. Every row below is per-user
//      STATE, keyed by the stable string ids those modules define.
//
//   2. A PUBLIC table must never carry a foreign key to a PRIVATE one, or
//      staging (which copies private tables schema-only) ends up with dangling
//      references. `currency_ledger.source_ref` is deliberately a TEXT tag
//      rather than an FK for exactly this reason: it points at entries, tiers
//      and objectives alike, and none of those relationships should survive as
//      a constraint.

const STATEMENTS = [
  // The journal itself. Personal content, so: private.
  `CREATE TABLE IF NOT EXISTS journal_entries (
     id BIGSERIAL PRIMARY KEY,
     user_id INTEGER NOT NULL,
     horizon TEXT NOT NULL,
     period_key TEXT NOT NULL,
     title TEXT NOT NULL,
     note TEXT,
     status TEXT NOT NULL DEFAULT 'open',
     priority BOOLEAN NOT NULL DEFAULT FALSE,
     sort_order INTEGER NOT NULL DEFAULT 0,
     migrated_from_id BIGINT REFERENCES journal_entries(id) ON DELETE SET NULL,
     migrated_to_id BIGINT REFERENCES journal_entries(id) ON DELETE SET NULL,
     migration_count INTEGER NOT NULL DEFAULT 0,
     -- Set the first time this task goes open → done and NEVER cleared. It is
     -- what makes a task pay exactly once in its life, however many times it
     -- is un-ticked, re-ticked, or carried forward.
     rewarded_at TIMESTAMPTZ,
     -- Set alongside rewarded_at on the first completion and likewise never
     -- cleared, but for a different job: rewarded_at can stay NULL (a task
     -- past the daily cap still counts as done), so the lifetime "tasks
     -- completed" stat is counted from THIS column. Without it, un-ticking
     -- and re-ticking one task inflates the number it advertises.
     first_completed_at TIMESTAMPTZ,
     completed_at TIMESTAMPTZ,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS journal_entries_log_idx
     ON journal_entries (user_id, horizon, period_key, status)`,
  `CREATE INDEX IF NOT EXISTS journal_entries_open_idx
     ON journal_entries (user_id, status, horizon, period_key)`,

  // An append-only trail of what happened to an entry. Echoes entry context,
  // so it inherits the entry's privacy.
  `CREATE TABLE IF NOT EXISTS entry_events (
     id BIGSERIAL PRIMARY KEY,
     user_id INTEGER NOT NULL,
     entry_id BIGINT REFERENCES journal_entries(id) ON DELETE CASCADE,
     kind TEXT NOT NULL,
     detail JSONB,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,

  `CREATE TABLE IF NOT EXISTS player_state (
     user_id INTEGER PRIMARY KEY,
     username TEXT NOT NULL,
     timezone TEXT NOT NULL DEFAULT 'UTC',
     focus DOUBLE PRECISION NOT NULL DEFAULT 0,
     resolve INTEGER NOT NULL DEFAULT 0,
     lifetime_xp BIGINT NOT NULL DEFAULT 0,
     journal_level INTEGER NOT NULL DEFAULT 1,
     streak_count INTEGER NOT NULL DEFAULT 0,
     longest_streak INTEGER NOT NULL DEFAULT 0,
     last_active_date TEXT,
     active_days INTEGER NOT NULL DEFAULT 0,
     completions INTEGER NOT NULL DEFAULT 0,
     migrations INTEGER NOT NULL DEFAULT 0,
     -- Idle accrual is computed from this on read, never by a timer.
     last_tick_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     last_collect_at TIMESTAMPTZ,
     lifetime_focus DOUBLE PRECISION NOT NULL DEFAULT 0,
     daily_reward_date TEXT,
     daily_reward_count INTEGER NOT NULL DEFAULT 0,
     tray_cleared_date TEXT,
     reviewed_week TEXT,
     perfect_day_date TEXT,
     first_seen BOOLEAN NOT NULL DEFAULT TRUE,
     workshop_intro BOOLEAN NOT NULL DEFAULT FALSE,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,

  `CREATE TABLE IF NOT EXISTS player_generators (
     user_id INTEGER NOT NULL,
     generator_id TEXT NOT NULL,
     level INTEGER NOT NULL DEFAULT 0,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     PRIMARY KEY (user_id, generator_id)
   )`,

  `CREATE TABLE IF NOT EXISTS player_upgrades (
     user_id INTEGER NOT NULL,
     upgrade_id TEXT NOT NULL,
     bought_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     PRIMARY KEY (user_id, upgrade_id)
   )`,

  `CREATE TABLE IF NOT EXISTS season_progress (
     user_id INTEGER NOT NULL,
     season_id TEXT NOT NULL,
     season_xp INTEGER NOT NULL DEFAULT 0,
     tier INTEGER NOT NULL DEFAULT 0,
     premium BOOLEAN NOT NULL DEFAULT FALSE,
     skips_used INTEGER NOT NULL DEFAULT 0,
     -- Watermarks. Rewards are released from here up to the tier column, which is what
     -- makes granting idempotent and makes a late premium unlock retroactive.
     granted_free_tier INTEGER NOT NULL DEFAULT 0,
     granted_premium_tier INTEGER NOT NULL DEFAULT 0,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     PRIMARY KEY (user_id, season_id)
   )`,

  `CREATE TABLE IF NOT EXISTS season_objectives (
     user_id INTEGER NOT NULL,
     season_id TEXT NOT NULL,
     objective_id TEXT NOT NULL,
     scope TEXT NOT NULL,
     period_key TEXT NOT NULL,
     progress INTEGER NOT NULL DEFAULT 0,
     completed BOOLEAN NOT NULL DEFAULT FALSE,
     completed_at TIMESTAMPTZ,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     PRIMARY KEY (user_id, objective_id, period_key)
   )`,

  `CREATE TABLE IF NOT EXISTS player_cosmetics (
     user_id INTEGER NOT NULL,
     cosmetic_id TEXT NOT NULL,
     source TEXT NOT NULL DEFAULT 'tier_reward',
     acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     PRIMARY KEY (user_id, cosmetic_id)
   )`,

  `CREATE TABLE IF NOT EXISTS player_loadout (
     user_id INTEGER PRIMARY KEY,
     generator_skin TEXT,
     backdrop TEXT,
     collect_effect TEXT,
     avatar_frame TEXT,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,

  // Financial-shaped, and the `reason`/`source_ref` pair leaks what someone
  // was journalling about. Private.
  `CREATE TABLE IF NOT EXISTS currency_ledger (
     id BIGSERIAL PRIMARY KEY,
     user_id INTEGER NOT NULL,
     currency TEXT NOT NULL,
     amount BIGINT NOT NULL,
     reason TEXT NOT NULL,
     source_ref TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS currency_ledger_user_idx ON currency_ledger (user_id, created_at DESC)`,

  // Nothing writes rows here yet — real-money purchases are switched off (see
  // routes/purchase.js). The table exists so the seam has somewhere to land
  // the day it is switched on, and it is private from the start.
  `CREATE TABLE IF NOT EXISTS purchases (
     id BIGSERIAL PRIMARY KEY,
     user_id INTEGER NOT NULL,
     sku TEXT NOT NULL,
     state TEXT NOT NULL DEFAULT 'unavailable',
     detail JSONB,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
];

// Columns added after the first release. Separate from the CREATEs above so
// an existing production database picks them up on the next boot.
const ADDITIONS = [
  `ALTER TABLE player_state ADD COLUMN IF NOT EXISTS perfect_day_date TEXT`,
  `ALTER TABLE player_state ADD COLUMN IF NOT EXISTS workshop_intro BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE season_progress ADD COLUMN IF NOT EXISTS skips_used INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE currency_ledger ADD COLUMN IF NOT EXISTS source_ref TEXT`,
  `ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS first_completed_at TIMESTAMPTZ`,
];

// "Would a stranger opening a staging preview seeing every row here be a
// problem?" — yes for each of these, so they are copied to staging
// schema-only and seeded with obvious fakes instead (db/seed.js).
const PRIVATE_TABLES = [
  ['journal_entries', 'task titles and notes are the user’s own writing'],
  ['entry_events', 'audit rows echo journal entry context'],
  ['currency_ledger', 'financial-shaped, and reasons leak entry context'],
  ['purchases', 'financial data'],
];

async function migrate(pool) {
  for (const sql of STATEMENTS) await pool.query(sql);
  for (const sql of ADDITIONS) await pool.query(sql);
  for (const [table] of PRIVATE_TABLES) {
    await pool.query(`COMMENT ON TABLE ${table} IS 'staging:private'`);
  }
}

module.exports = { migrate, PRIVATE_TABLES };
