// Staging-only seed data.
//
// Staging starts from a copy of production, so every table this app created
// arrives empty and every 'staging:private' table arrives schema-only. Without
// this, a reviewer opening the preview sees four blank screens and learns
// nothing about the change.
//
// Three rules hold this file honest:
//   1. Everything is fabricated. The identities below do not exist and are
//      obviously fake.
//   2. NOTHING is attributed to the visitor. Seeding rows owned by whoever
//      opened the preview would hand them a state production will not have,
//      and make the app's own "has this user done X" logic untestable.
//   3. It is idempotent — staging rebuilds on every push, so this re-runs.

const periods = require('../game/periods');
const seasons = require('../game/seasons');

const JOURNALER = 900001;
const IDLER = 900002;
const PREFIX = 'Staging demo — ';

// Explicit ids far above anything BIGSERIAL will reach in a preview's
// lifetime, so re-running the seed collides with itself rather than with a
// real row.
const BASE_ID = 900100;

async function seedPlayers(client, season) {
  await client.query(
    `INSERT INTO player_state
       (user_id, username, timezone, focus, resolve, lifetime_xp, journal_level,
        streak_count, longest_streak, last_active_date, active_days, completions,
        migrations, lifetime_focus, first_seen, workshop_intro)
     VALUES
       ($1, 'staging-demo-journaler', 'UTC', 184320, 480, 3050, 9,
        12, 18, $3, 46, 213, 37, 2410500, FALSE, TRUE),
       ($2, 'staging-demo-idler', 'UTC', 9420000, 120, 9600, 17,
        3, 21, $3, 78, 402, 61, 58200000, FALSE, TRUE)
     ON CONFLICT (user_id) DO NOTHING`,
    [JOURNALER, IDLER, periods.keysFor(new Date(), 'UTC').day]
  );

  const generators = [
    [JOURNALER, 'gen_notepad', 22], [JOURNALER, 'gen_lamp', 15],
    [JOURNALER, 'gen_cabinet', 9], [JOURNALER, 'gen_coffee', 4],
    [JOURNALER, 'gen_whiteboard', 1],
    // The idler exists to show the Workshop with a full stack behind it.
    [IDLER, 'gen_notepad', 45], [IDLER, 'gen_lamp', 40], [IDLER, 'gen_cabinet', 30],
    [IDLER, 'gen_coffee', 25], [IDLER, 'gen_whiteboard', 18], [IDLER, 'gen_intern', 12],
    [IDLER, 'gen_script', 3],
  ];
  for (const [uid, gid, level] of generators) {
    await client.query(
      `INSERT INTO player_generators (user_id, generator_id, level) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, generator_id) DO NOTHING`, [uid, gid, level]
    );
  }

  const upgrades = [
    [JOURNALER, 'up_thermos'], [JOURNALER, 'up_timer'], [JOURNALER, 'up_labels'],
    [IDLER, 'up_thermos'], [IDLER, 'up_timer'], [IDLER, 'up_labels'],
    [IDLER, 'up_beans'], [IDLER, 'up_nightshift'], [IDLER, 'up_standing'],
  ];
  for (const [uid, upid] of upgrades) {
    await client.query(
      `INSERT INTO player_upgrades (user_id, upgrade_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [uid, upid]
    );
  }

  // One locked premium track and one unlocked, so a reviewer can see both
  // states of the season screen without spending anything.
  await client.query(
    `INSERT INTO season_progress
       (user_id, season_id, season_xp, tier, premium, skips_used,
        granted_free_tier, granted_premium_tier)
     VALUES ($1, $3, 4380, 14, FALSE, 1, 14, 0),
            ($2, $3, 9900, 33, TRUE,  0, 33, 33)
     ON CONFLICT (user_id, season_id) DO NOTHING`,
    [JOURNALER, IDLER, season.id]
  );

  const cosmetics = [
    [JOURNALER, 'skin_graphite'], [JOURNALER, 'back_paper'], [JOURNALER, 'fx_tick'],
    [JOURNALER, 'frame_clip'], [JOURNALER, 'skin_blueprint'], [JOURNALER, 'back_dusk'],
    [JOURNALER, 'fx_sparks'], [JOURNALER, 'frame_steel'], [JOURNALER, 'skin_neon_desk'],
    [IDLER, 'skin_graphite'], [IDLER, 'back_paper'], [IDLER, 'fx_tick'], [IDLER, 'frame_clip'],
    [IDLER, 'skin_gilded'], [IDLER, 'back_aurora'], [IDLER, 'fx_confetti'], [IDLER, 'frame_violet'],
  ];
  for (const [uid, cid] of cosmetics) {
    await client.query(
      `INSERT INTO player_cosmetics (user_id, cosmetic_id, source) VALUES ($1, $2, 'seed')
       ON CONFLICT (user_id, cosmetic_id) DO NOTHING`, [uid, cid]
    );
  }

  await client.query(
    `INSERT INTO player_loadout (user_id, generator_skin, backdrop, collect_effect, avatar_frame)
     VALUES ($1, 'skin_blueprint', 'back_dusk', 'fx_sparks', 'frame_steel'),
            ($2, 'skin_gilded', 'back_aurora', 'fx_confetti', 'frame_violet')
     ON CONFLICT (user_id) DO NOTHING`,
    [JOURNALER, IDLER]
  );
}

async function seedEntries(client, keys) {
  const yesterday = periods.step('day', keys.day, -1);
  const twoDaysAgo = periods.step('day', keys.day, -2);
  const lastWeek = periods.step('week', keys.week, -1);

  // [offset, horizon, period, title, status, priority, rewarded, note]
  const rows = [
    // Today's Day log: the shape the Journal screen is designed around.
    [1,  'day', keys.day, 'Ship the thing I keep rewriting', 'open', true, false, null],
    [2,  'day', keys.day, 'Reply to the long email', 'done', false, true, null],
    [3,  'day', keys.day, 'Walk before it gets dark', 'done', false, true, null],
    [4,  'day', keys.day, 'Read ten pages', 'open', false, false, 'Any ten. It counts.'],
    [5,  'day', keys.day, 'Argue with the printer', 'dropped', false, false, null],
    // 6 → 7 is the migrated pair, linked after insert.
    [6,  'day', keys.day, 'Sort the desk drawer', 'migrated', false, false, null],
    [7,  'week', keys.week, 'Sort the desk drawer', 'open', false, false, null],
    // Three open tasks in yesterday's log — this is what fills the tray.
    [8,  'day', yesterday, 'Book the dentist', 'open', false, false, null],
    [9,  'day', yesterday, 'Send the invoice', 'open', true, false, null],
    [10, 'day', yesterday, 'Chase the delivery', 'open', false, false, null],
    [11, 'day', twoDaysAgo, 'Back up the laptop', 'open', false, false, null],
    // Week
    [12, 'week', keys.week, 'Plan the next release', 'open', true, false, null],
    [13, 'week', keys.week, 'Two long-focus mornings', 'done', false, true, null],
    [14, 'week', keys.week, 'Call the bank back', 'open', false, false, null],
    [15, 'week', lastWeek, 'Write the handover doc', 'done', false, true, null],
    // Month
    [16, 'month', keys.month, 'Finish the quarterly write-up', 'open', true, false, null],
    [17, 'month', keys.month, 'Rebuild the budget sheet', 'done', false, true, null],
    [18, 'month', keys.month, 'One weekend with no screens', 'open', false, false, null],
    // Year
    [19, 'year', keys.year, 'Learn to actually swim', 'open', true, false, null],
    [20, 'year', keys.year, 'Write the book proposal', 'open', false, false, null],
    [21, 'year', keys.year, 'Visit the coast in winter', 'done', false, true, null],
  ];

  for (const [off, horizon, key, title, status, priority, rewarded, note] of rows) {
    await client.query(
      `INSERT INTO journal_entries
         (id, user_id, horizon, period_key, title, note, status, priority, sort_order,
          rewarded_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
               CASE WHEN $10 THEN NOW() ELSE NULL END,
               CASE WHEN $7 = 'done' THEN NOW() ELSE NULL END)
       ON CONFLICT (id) DO NOTHING`,
      [BASE_ID + off, JOURNALER, horizon, key, PREFIX + title, note, status, priority, off, rewarded]
    );
  }

  // Link the migrated pair both ways, so the stub reads "→ Week 34" and the
  // live copy reads "migrated from 23 Aug".
  await client.query(
    `UPDATE journal_entries SET migrated_to_id = $2 WHERE id = $1 AND migrated_to_id IS NULL`,
    [BASE_ID + 6, BASE_ID + 7]
  );
  await client.query(
    `UPDATE journal_entries SET migrated_from_id = $2, migration_count = 1
     WHERE id = $1 AND migrated_from_id IS NULL`,
    [BASE_ID + 7, BASE_ID + 6]
  );
}

async function seed(pool) {
  const now = new Date();
  const keys = periods.keysFor(now, 'UTC');
  const season = seasons.seasonAt(now);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await seedPlayers(client, season);
    await seedEntries(client, keys);
    await client.query('COMMIT');
    console.log('[seed] staging demo data ready');
  } catch (err) {
    await client.query('ROLLBACK');
    // A broken seed must never stop the app from booting — the screens will
    // just be emptier than intended.
    console.error('[seed] failed', err.message);
  } finally {
    client.release();
  }
}

module.exports = { seed, JOURNALER, IDLER };
