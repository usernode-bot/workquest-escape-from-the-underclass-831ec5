// The journal: four horizons, the migration ritual, and the rewards that
// completing something pays out.
//
// The reward rules all live in one place (award() below) because they only
// work as a set: pay once ever, cap the day, honour the streak, never trust a
// period key the client chose.

const express = require('express');
const {
  demoOr401, withTx, context, playerPayload, emptyDeltas, handle,
  periods, economy,
} = require('./common');
const fixtures = require('../game/fixtures');

const router = express.Router();

const ENTRY_COLUMNS = `
  e.id, e.horizon, e.period_key, e.title, e.note, e.status, e.priority,
  e.sort_order, e.migration_count, e.rewarded_at IS NOT NULL AS rewarded,
  e.migrated_to_id, e.migrated_from_id, e.completed_at, e.created_at,
  t.horizon AS to_horizon, t.period_key AS to_period_key,
  f.horizon AS from_horizon, f.period_key AS from_period_key`;

const ENTRY_JOINS = `
  FROM journal_entries e
  LEFT JOIN journal_entries t ON t.id = e.migrated_to_id
  LEFT JOIN journal_entries f ON f.id = e.migrated_from_id`;

function shapeEntry(r) {
  return {
    id: Number(r.id),
    horizon: r.horizon,
    period_key: r.period_key,
    title: r.title,
    note: r.note,
    status: r.status,
    priority: r.priority,
    sort_order: r.sort_order,
    migration_count: r.migration_count,
    rewarded: r.rewarded,
    // The stub a migration leaves behind says where the task went, and the
    // live copy says where it came from. Both read as plain language.
    migrated_to: r.to_horizon ? periods.shortLabel(r.to_horizon, r.to_period_key) : null,
    migrated_from: r.from_horizon ? periods.shortLabel(r.from_horizon, r.from_period_key) : null,
  };
}

// Open tasks stranded in a log whose period has already passed. This is the
// list the migration tray is built from, and the reason the ritual exists.
async function trayRows(client, ctx) {
  const { rows } = await client.query(
    `SELECT ${ENTRY_COLUMNS} ${ENTRY_JOINS}
     WHERE e.user_id = $1 AND e.status = 'open'
       AND ((e.horizon = 'day'   AND e.period_key < $2)
         OR (e.horizon = 'week'  AND e.period_key < $3)
         OR (e.horizon = 'month' AND e.period_key < $4)
         OR (e.horizon = 'year'  AND e.period_key < $5))
     ORDER BY e.period_key DESC, e.priority DESC, e.sort_order, e.id
     LIMIT 100`,
    [ctx.userId, ctx.keys.day, ctx.keys.week, ctx.keys.month, ctx.keys.year]
  );
  return rows.map(shapeEntry);
}

async function logPayload(client, ctx, horizon, periodKey) {
  const { rows } = await client.query(
    `SELECT ${ENTRY_COLUMNS} ${ENTRY_JOINS}
     WHERE e.user_id = $1 AND e.horizon = $2 AND e.period_key = $3
     ORDER BY e.priority DESC, e.sort_order, e.id`,
    [ctx.userId, horizon, periodKey]
  );
  const entries = rows.map(shapeEntry);
  const tray = await trayRows(client, ctx);
  // The weekly review only makes sense at the end of the week you are looking
  // at, and only once.
  const reviewDue = horizon === 'week'
    && periodKey === ctx.keys.week
    && ctx.state.reviewed_week !== ctx.keys.week
    && ['Fri', 'Sat', 'Sun'].includes(
      new Intl.DateTimeFormat('en-US', { timeZone: ctx.tz, weekday: 'short' }).format(ctx.now));
  return {
    horizon,
    period_key: periodKey,
    label: periods.label(horizon, periodKey, ctx.keys),
    is_current: periodKey === ctx.keys[horizon],
    // The stepper's neighbours are computed here rather than in the browser:
    // ISO week arithmetic has exactly one correct implementation and it is
    // this one.
    prev_key: periods.step(horizon, periodKey, -1),
    next_key: periods.step(horizon, periodKey, 1),
    current_key: ctx.keys[horizon],
    entries,
    counts: {
      open: entries.filter((e) => e.status === 'open').length,
      done: entries.filter((e) => e.status === 'done').length,
      total: entries.length,
    },
    tray_count: tray.length,
    review_due: reviewDue,
  };
}

// ── Reads ───────────────────────────────────────────────────────────────────

router.get('/journal/unmigrated', handle(async (req, res) => {
  if (demoOr401(req, res, () => fixtures.tray())) return;
  const out = await withTx(async (client) => {
    const ctx = await context(client, req);
    return { entries: await trayRows(client, ctx), player: await playerPayload(client, ctx) };
  });
  res.json(out);
}));

router.get('/journal/:horizon', handle(async (req, res) => {
  const horizon = req.params.horizon;
  if (!periods.HORIZONS.includes(horizon)) return res.status(404).json({ error: 'unknown_horizon' });
  if (demoOr401(req, res, () => fixtures.log(horizon, req.query.period))) return;
  const out = await withTx(async (client) => {
    const ctx = await context(client, req);
    const asked = req.query.period;
    const key = periods.isValidKey(horizon, asked) ? asked : ctx.keys[horizon];
    return { log: await logPayload(client, ctx, horizon, key), player: await playerPayload(client, ctx) };
  });
  res.json(out);
}));

// ── Writes ──────────────────────────────────────────────────────────────────

async function respond(res, client, ctx, deltas, extra) {
  res.json(Object.assign({ player: await playerPayload(client, ctx), deltas }, extra || {}));
}

router.post('/journal/entries', handle(async (req, res) => {
  const title = String(req.body.title || '').trim().slice(0, 300);
  const horizon = req.body.horizon;
  if (!title) return res.status(400).json({ error: 'title_required' });
  if (!periods.HORIZONS.includes(horizon)) return res.status(400).json({ error: 'unknown_horizon' });
  await withTx(async (client) => {
    const ctx = await context(client, req);
    const deltas = emptyDeltas();
    const asked = req.body.period_key;
    const key = periods.isValidKey(horizon, asked) ? asked : ctx.keys[horizon];
    const { rows } = await client.query(
      `INSERT INTO journal_entries (user_id, horizon, period_key, title, note, priority, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6,
         COALESCE((SELECT MAX(sort_order) + 1 FROM journal_entries
                   WHERE user_id = $1 AND horizon = $2 AND period_key = $3), 0))
       RETURNING id`,
      [ctx.userId, horizon, key, title, req.body.note ? String(req.body.note).slice(0, 2000) : null,
        !!req.body.priority]
    );
    await client.query(
      `INSERT INTO entry_events (user_id, entry_id, kind, detail) VALUES ($1, $2, 'create', $3)`,
      [ctx.userId, rows[0].id, JSON.stringify({ horizon, period_key: key })]
    );
    await economy.bumpObjectives(client, ctx, 'create', 1, deltas);
    await respond(res, client, ctx, deltas, {
      entry_id: Number(rows[0].id),
      log: await logPayload(client, ctx, horizon, key),
    });
  });
}));

router.patch('/journal/entries/:id', handle(async (req, res) => {
  const id = Number(req.params.id);
  await withTx(async (client) => {
    const ctx = await context(client, req);
    const deltas = emptyDeltas();
    const fields = [];
    const values = [ctx.userId, id];
    if (typeof req.body.title === 'string' && req.body.title.trim()) {
      values.push(req.body.title.trim().slice(0, 300));
      fields.push(`title = $${values.length}`);
    }
    if (typeof req.body.note === 'string') {
      values.push(req.body.note.slice(0, 2000) || null);
      fields.push(`note = $${values.length}`);
    }
    if (typeof req.body.priority === 'boolean') {
      values.push(req.body.priority);
      fields.push(`priority = $${values.length}`);
    }
    if (typeof req.body.sort_order === 'number') {
      values.push(Math.trunc(req.body.sort_order));
      fields.push(`sort_order = $${values.length}`);
    }
    if (!fields.length) return res.status(400).json({ error: 'nothing_to_update' });
    const { rows } = await client.query(
      `UPDATE journal_entries SET ${fields.join(', ')}, updated_at = NOW()
       WHERE user_id = $1 AND id = $2 RETURNING horizon, period_key`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    await respond(res, client, ctx, deltas, {
      log: await logPayload(client, ctx, rows[0].horizon, rows[0].period_key),
    });
  });
}));

// The payout. Every rule that decides whether a completion earns lives here.
async function award(client, ctx, entry, deltas) {
  const table = economy.REWARDS[entry.horizon];
  if (entry.rewarded_at) {
    deltas.messages.push('Already earned — re-ticking pays nothing');
    return;
  }
  if (entry.title.trim().length < economy.MIN_TITLE_LENGTH) {
    deltas.messages.push('Too short to count');
    return;
  }
  if (ctx.state.daily_reward_count >= economy.DAILY_REWARD_CAP) {
    deltas.messages.push('No reward — daily cap reached');
    return;
  }

  // Bump the streak BEFORE reading the multiplier, so the day you are
  // currently having is part of the run it is multiplying.
  await economy.noteActive(client, ctx, deltas);
  const mult = economy.streakMultiplier(economy.liveStreak(ctx.state, ctx.keys.day));
  const sp = Math.round(table.sp * mult);
  const focus = Math.round(table.focus * mult);

  await client.query(
    `UPDATE journal_entries SET rewarded_at = NOW() WHERE id = $1 AND rewarded_at IS NULL`,
    [entry.id]
  );
  await client.query(
    `UPDATE player_state SET daily_reward_count = daily_reward_count + 1 WHERE user_id = $1`,
    [ctx.userId]
  );
  ctx.state.daily_reward_count += 1;

  await economy.awardSeasonXp(client, ctx, sp, 'complete', String(entry.id), deltas);
  await economy.addFocus(client, ctx, focus, 'complete', String(entry.id), deltas);
  await economy.bumpObjectives(client, ctx, 'complete', 1, deltas);
  await economy.bumpObjectives(client, ctx, 'complete_' + entry.horizon, 1, deltas);
  if (entry.priority) await economy.bumpObjectives(client, ctx, 'complete_star', 1, deltas);
  deltas.messages.push(`+${sp} SP · +${focus} Focus`);
}

// Finish every task in a Day log with at least three of them and the day pays
// a small Resolve bonus — once, on the day itself.
async function checkPerfectDay(client, ctx, entry, deltas) {
  if (entry.horizon !== 'day' || entry.period_key !== ctx.keys.day) return;
  if (ctx.state.perfect_day_date === ctx.keys.day) return;
  const { rows } = await client.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'done') AS done,
            COUNT(*) FILTER (WHERE status = 'open') AS open
     FROM journal_entries WHERE user_id = $1 AND horizon = 'day' AND period_key = $2`,
    [ctx.userId, ctx.keys.day]
  );
  if (Number(rows[0].open) !== 0 || Number(rows[0].done) < 3) return;
  await client.query(`UPDATE player_state SET perfect_day_date = $2 WHERE user_id = $1`,
    [ctx.userId, ctx.keys.day]);
  ctx.state.perfect_day_date = ctx.keys.day;
  await economy.grantResolve(client, ctx, economy.RITUALS.perfect_day.resolve,
    'perfect_day', ctx.keys.day, deltas);
  deltas.messages.push(`Cleared the day — +${economy.RITUALS.perfect_day.resolve} Resolve`);
}

async function loadEntry(client, ctx, id) {
  const { rows } = await client.query(
    `SELECT * FROM journal_entries WHERE user_id = $1 AND id = $2 FOR UPDATE`, [ctx.userId, id]
  );
  return rows[0] || null;
}

router.post('/journal/entries/:id/complete', handle(async (req, res) => {
  await withTx(async (client) => {
    const ctx = await context(client, req);
    const deltas = emptyDeltas();
    const entry = await loadEntry(client, ctx, Number(req.params.id));
    if (!entry) return res.status(404).json({ error: 'not_found' });
    if (entry.status !== 'done') {
      await client.query(
        `UPDATE journal_entries
            SET status = 'done', completed_at = NOW(),
                first_completed_at = COALESCE(first_completed_at, NOW()),
                updated_at = NOW()
          WHERE id = $1`, [entry.id]
      );
      // Count the task, not the tick. first_completed_at is NULL only the
      // very first time, so untick/re-tick leaves the lifetime stat alone —
      // the same rule the payout follows.
      if (!entry.first_completed_at) {
        await client.query(
          `UPDATE player_state SET completions = completions + 1 WHERE user_id = $1`, [ctx.userId]
        );
        ctx.state.completions += 1;
      }
      await client.query(
        `INSERT INTO entry_events (user_id, entry_id, kind) VALUES ($1, $2, 'complete')`,
        [ctx.userId, entry.id]
      );
      await award(client, ctx, entry, deltas);
      await checkPerfectDay(client, ctx, entry, deltas);
    }
    await respond(res, client, ctx, deltas, {
      log: await logPayload(client, ctx, entry.horizon, entry.period_key),
    });
  });
}));

// Un-ticking gives nothing back and takes nothing away. `rewarded_at` stays
// set, so the pair of actions is not a Focus faucet.
router.post('/journal/entries/:id/uncomplete', handle(async (req, res) => {
  await withTx(async (client) => {
    const ctx = await context(client, req);
    const deltas = emptyDeltas();
    const entry = await loadEntry(client, ctx, Number(req.params.id));
    if (!entry) return res.status(404).json({ error: 'not_found' });
    await client.query(
      `UPDATE journal_entries SET status = 'open', completed_at = NULL, updated_at = NOW()
       WHERE id = $1`, [entry.id]
    );
    await client.query(
      `INSERT INTO entry_events (user_id, entry_id, kind) VALUES ($1, $2, 'uncomplete')`,
      [ctx.userId, entry.id]
    );
    await respond(res, client, ctx, deltas, {
      log: await logPayload(client, ctx, entry.horizon, entry.period_key),
    });
  });
}));

// Migration: the stub stays where it was, dimmed, pointing forward; a live
// copy appears in the destination log pointing back.
async function migrateEntry(client, ctx, entry, token, deltas) {
  const target = periods.resolveTarget(token, ctx.keys);
  if (!target) return null;
  const { rows } = await client.query(
    `INSERT INTO journal_entries
       (user_id, horizon, period_key, title, note, priority, migrated_from_id,
        migration_count, rewarded_at, first_completed_at, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
       COALESCE((SELECT MAX(sort_order) + 1 FROM journal_entries
                 WHERE user_id = $1 AND horizon = $2 AND period_key = $3), 0))
     RETURNING id`,
    // Both watermarks ride along: the copy is the same task moved, so it must
    // not pay a second time and must not be counted a second time.
    [ctx.userId, target.horizon, target.period_key, entry.title, entry.note, entry.priority,
      entry.id, entry.migration_count + 1, entry.rewarded_at, entry.first_completed_at]
  );
  const newId = rows[0].id;
  await client.query(
    `UPDATE journal_entries SET status = 'migrated', migrated_to_id = $2, updated_at = NOW()
     WHERE id = $1`, [entry.id, newId]
  );
  await client.query(
    `INSERT INTO entry_events (user_id, entry_id, kind, detail) VALUES ($1, $2, 'migrate', $3)`,
    [ctx.userId, entry.id, JSON.stringify(target)]
  );
  await client.query(`UPDATE player_state SET migrations = migrations + 1 WHERE user_id = $1`, [ctx.userId]);
  ctx.state.migrations += 1;
  await economy.bumpObjectives(client, ctx, 'migrate', 1, deltas);
  return { id: Number(newId), target };
}

router.post('/journal/entries/:id/migrate', handle(async (req, res) => {
  await withTx(async (client) => {
    const ctx = await context(client, req);
    const deltas = emptyDeltas();
    const entry = await loadEntry(client, ctx, Number(req.params.id));
    if (!entry) return res.status(404).json({ error: 'not_found' });
    if (entry.status !== 'open') return res.status(409).json({ error: 'not_open' });
    const moved = await migrateEntry(client, ctx, entry, req.body.target, deltas);
    if (!moved) return res.status(400).json({ error: 'unknown_target' });
    deltas.messages.push('Moved to ' + periods.shortLabel(moved.target.horizon, moved.target.period_key));
    await respond(res, client, ctx, deltas, {
      log: await logPayload(client, ctx, entry.horizon, entry.period_key),
    });
  });
}));

router.post('/journal/entries/:id/drop', handle(async (req, res) => {
  await withTx(async (client) => {
    const ctx = await context(client, req);
    const deltas = emptyDeltas();
    const entry = await loadEntry(client, ctx, Number(req.params.id));
    if (!entry) return res.status(404).json({ error: 'not_found' });
    await client.query(
      `UPDATE journal_entries SET status = 'dropped', updated_at = NOW() WHERE id = $1`, [entry.id]
    );
    await client.query(
      `INSERT INTO entry_events (user_id, entry_id, kind) VALUES ($1, $2, 'drop')`,
      [ctx.userId, entry.id]
    );
    deltas.messages.push('Let go');
    await respond(res, client, ctx, deltas, {
      log: await logPayload(client, ctx, entry.horizon, entry.period_key),
    });
  });
}));

// The tray ritual: deal with everything left behind in one move. Paid once a
// day, and only when the tray actually empties.
router.post('/journal/tray/clear', handle(async (req, res) => {
  const action = req.body.action === 'drop' ? 'drop' : 'migrate';
  await withTx(async (client) => {
    const ctx = await context(client, req);
    const deltas = emptyDeltas();
    const stranded = await trayRows(client, ctx);
    for (const row of stranded) {
      const entry = await loadEntry(client, ctx, row.id);
      if (!entry || entry.status !== 'open') continue;
      if (action === 'drop') {
        await client.query(`UPDATE journal_entries SET status = 'dropped', updated_at = NOW() WHERE id = $1`, [entry.id]);
        await client.query(`INSERT INTO entry_events (user_id, entry_id, kind) VALUES ($1, $2, 'drop')`, [ctx.userId, entry.id]);
      } else {
        await migrateEntry(client, ctx, entry, 'today', deltas);
      }
    }
    if (stranded.length && ctx.state.tray_cleared_date !== ctx.keys.day) {
      await client.query(`UPDATE player_state SET tray_cleared_date = $2 WHERE user_id = $1`,
        [ctx.userId, ctx.keys.day]);
      ctx.state.tray_cleared_date = ctx.keys.day;
      await economy.awardSeasonXp(client, ctx, economy.RITUALS.tray_clear.sp, 'tray_clear', ctx.keys.day, deltas);
      await economy.bumpObjectives(client, ctx, 'tray_clear', 1, deltas);
      deltas.messages.push(`Tray cleared — +${economy.RITUALS.tray_clear.sp} SP`);
    } else if (!stranded.length) {
      deltas.messages.push('Nothing left behind');
    }
    await respond(res, client, ctx, deltas, {
      log: await logPayload(client, ctx, 'day', ctx.keys.day),
      tray: await trayRows(client, ctx),
    });
  });
}));

// The weekly review. Biggest single payout in the app, once per week, because
// it is the habit the whole thing is arguing for.
router.post('/journal/weekly-review', handle(async (req, res) => {
  await withTx(async (client) => {
    const ctx = await context(client, req);
    const deltas = emptyDeltas();
    if (ctx.state.reviewed_week === ctx.keys.week) {
      deltas.messages.push('Already reviewed this week');
    } else {
      await client.query(`UPDATE player_state SET reviewed_week = $2 WHERE user_id = $1`,
        [ctx.userId, ctx.keys.week]);
      ctx.state.reviewed_week = ctx.keys.week;
      await economy.awardSeasonXp(client, ctx, economy.RITUALS.weekly_review.sp, 'weekly_review', ctx.keys.week, deltas);
      await economy.grantResolve(client, ctx, economy.RITUALS.weekly_review.resolve, 'weekly_review', ctx.keys.week, deltas);
      await economy.bumpObjectives(client, ctx, 'review', 1, deltas);
      deltas.messages.push(`Week reviewed — +${economy.RITUALS.weekly_review.sp} SP · +${economy.RITUALS.weekly_review.resolve} Resolve`);
    }
    await respond(res, client, ctx, deltas, {
      log: await logPayload(client, ctx, 'week', ctx.keys.week),
    });
  });
}));

module.exports = { router, logPayload, trayRows, shapeEntry };
