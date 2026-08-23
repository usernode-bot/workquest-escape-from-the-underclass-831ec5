// The Workshop (idle layer) and the Profile.
//
// Every price is recomputed here from game/content.js at the moment of
// purchase, under a row lock. The client's idea of what something costs is
// display only — it is never read back as an input.

const express = require('express');
const {
  demoOr401, withTx, context, playerPayload, emptyDeltas, handle,
  economy, content, idle,
} = require('./common');
const fixtures = require('../game/fixtures');

const router = express.Router();

// A tap worth taking: one minute of production, banked instantly, on a five
// minute cooldown. The passive trickle keeps running either way — Collect is
// a reason to come back, not the only way to be paid.
const COLLECT_COOLDOWN_S = 300;
const COLLECT_SECONDS = 60;
const COLLECT_MIN = 25;

function collectValue(ctx) {
  return Math.max(COLLECT_MIN, Math.round(ctx.rate * COLLECT_SECONDS));
}

function collectReadyIn(ctx) {
  if (!ctx.state.last_collect_at) return 0;
  const since = (ctx.now.getTime() - new Date(ctx.state.last_collect_at).getTime()) / 1000;
  return Math.max(0, Math.ceil(COLLECT_COOLDOWN_S - since));
}

function generatorView(ctx) {
  const level = ctx.state.journal_level;
  return content.GENERATORS.map((g) => {
    const owned = ctx.levels[g.id] || 0;
    const cap = content.genCap(g, level);
    const cost = content.genCost(g, owned);
    const locked = level < g.unlock;
    return {
      id: g.id, name: g.name, blurb: g.blurb,
      level: owned, cap, cost,
      rate_each: g.rate,
      output: idle.rateFor({ [g.id]: owned }, ctx.upgrades),
      locked,
      // Two different walls, and the copy has to say which one you hit:
      // one is answered by journalling, the other by waiting.
      lock_reason: locked ? `Unlocks at Journal Level ${g.unlock}`
        : (owned >= cap ? `Capped — raise your Journal Level to build past ${cap}` : null),
      at_cap: !locked && owned >= cap,
      affordable: !locked && owned < cap && ctx.state.focus >= cost,
    };
  });
}

function upgradeView(ctx) {
  const owned = new Set(ctx.upgrades);
  const level = ctx.state.journal_level;
  return content.UPGRADES.map((u) => ({
    id: u.id, name: u.name, blurb: u.blurb, cost: u.cost,
    owned: owned.has(u.id),
    locked: level < u.unlock,
    lock_reason: level < u.unlock ? `Unlocks at Journal Level ${u.unlock}` : null,
    affordable: !owned.has(u.id) && level >= u.unlock && ctx.state.focus >= u.cost,
  }));
}

async function gameState(client, ctx) {
  const capHours = idle.offlineCapSeconds(ctx.upgrades) / 3600;
  const away = ctx.accrued || { gained: 0, seconds: 0, capped: false };
  return {
    player: await playerPayload(client, ctx),
    generators: generatorView(ctx),
    upgrades: upgradeView(ctx),
    idle: {
      rate: ctx.rate,
      offline_cap_hours: capHours,
      // Only worth saying out loud if they were actually gone a while.
      away_gained: away.seconds > 120 ? Math.floor(away.gained) : 0,
      away_seconds: Math.floor(away.seconds),
      away_capped: away.capped,
    },
    collect: {
      amount: collectValue(ctx),
      ready_in: collectReadyIn(ctx),
      cooldown: COLLECT_COOLDOWN_S,
    },
  };
}

router.get('/game/state', handle(async (req, res) => {
  if (demoOr401(req, res, () => fixtures.gameState())) return;
  const out = await withTx(async (client) => {
    const ctx = await context(client, req);
    return gameState(client, ctx);
  });
  res.json(out);
}));

router.post('/game/collect', handle(async (req, res) => {
  await withTx(async (client) => {
    const ctx = await context(client, req);
    const deltas = emptyDeltas();
    const wait = collectReadyIn(ctx);
    if (wait > 0) {
      deltas.messages.push(`Not ready — ${wait}s`);
    } else {
      const amount = collectValue(ctx);
      await client.query(`UPDATE player_state SET last_collect_at = $2 WHERE user_id = $1`,
        [ctx.userId, ctx.now]);
      ctx.state.last_collect_at = ctx.now;
      await economy.addFocus(client, ctx, amount, 'collect', null, deltas);
      await economy.bumpObjectives(client, ctx, 'collect', 1, deltas);
      deltas.messages.push(`+${amount.toLocaleString('en-US')} Focus`);
    }
    res.json(Object.assign(await gameState(client, ctx), { deltas }));
  });
}));

// The Workshop introduction: the first completion in the Journal opens an
// overlay that hands over the first generator. It is free and it happens once
// — the flag is what makes it once, so a second call is a no-op rather than a
// second machine.
router.post('/game/intro', handle(async (req, res) => {
  await withTx(async (client) => {
    const ctx = await context(client, req);
    const deltas = emptyDeltas();
    const locked = await client.query(
      `SELECT workshop_intro FROM player_state WHERE user_id = $1 FOR UPDATE`, [ctx.userId]
    );
    if (locked.rows[0].workshop_intro) {
      deltas.messages.push('The Workshop is already running');
    } else {
      const first = content.GENERATORS[0];
      await client.query(
        `INSERT INTO player_generators (user_id, generator_id, level) VALUES ($1, $2, 1)
         ON CONFLICT (user_id, generator_id) DO NOTHING`,
        [ctx.userId, first.id]
      );
      await client.query(`UPDATE player_state SET workshop_intro = TRUE WHERE user_id = $1`, [ctx.userId]);
      ctx.state.workshop_intro = true;
      ctx.levels[first.id] = Math.max(1, ctx.levels[first.id] || 0);
      ctx.rate = idle.rateFor(ctx.levels, ctx.upgrades);
      deltas.messages.push(`${first.name} is yours — the Workshop is running`);
    }
    res.json(Object.assign(await gameState(client, ctx), { deltas }));
  });
}));

router.post('/game/generators/:id/buy', handle(async (req, res) => {
  const gen = content.GEN_BY_ID.get(req.params.id);
  if (!gen) return res.status(404).json({ error: 'unknown_generator' });
  await withTx(async (client) => {
    const ctx = await context(client, req);
    const deltas = emptyDeltas();
    // Lock the wallet before pricing, so two taps cannot both read the same
    // balance and both succeed.
    const locked = await client.query(
      `SELECT focus, journal_level FROM player_state WHERE user_id = $1 FOR UPDATE`, [ctx.userId]
    );
    ctx.state.focus = locked.rows[0].focus;
    const journalLevel = locked.rows[0].journal_level;
    const owned = ctx.levels[gen.id] || 0;
    const cap = content.genCap(gen, journalLevel);
    const cost = content.genCost(gen, owned);

    if (journalLevel < gen.unlock) deltas.messages.push(`Unlocks at Journal Level ${gen.unlock}`);
    else if (owned >= cap) deltas.messages.push(`${gen.name} is capped — raise your Journal Level`);
    else if (ctx.state.focus < cost) deltas.messages.push('Not enough Focus');
    else {
      await economy.addFocus(client, ctx, -cost, 'buy_generator', gen.id, deltas);
      await client.query(
        `INSERT INTO player_generators (user_id, generator_id, level) VALUES ($1, $2, 1)
         ON CONFLICT (user_id, generator_id) DO UPDATE SET level = player_generators.level + 1,
           updated_at = NOW()`,
        [ctx.userId, gen.id]
      );
      ctx.levels[gen.id] = owned + 1;
      ctx.rate = idle.rateFor(ctx.levels, ctx.upgrades);
      await client.query(`UPDATE player_state SET workshop_intro = TRUE WHERE user_id = $1`, [ctx.userId]);
      ctx.state.workshop_intro = true;
      await economy.bumpObjectives(client, ctx, 'buy', 1, deltas);
      deltas.messages.push(`${gen.name} → level ${owned + 1}`);
    }
    res.json(Object.assign(await gameState(client, ctx), { deltas }));
  });
}));

router.post('/game/upgrades/:id/buy', handle(async (req, res) => {
  const up = content.UP_BY_ID.get(req.params.id);
  if (!up) return res.status(404).json({ error: 'unknown_upgrade' });
  await withTx(async (client) => {
    const ctx = await context(client, req);
    const deltas = emptyDeltas();
    const locked = await client.query(
      `SELECT focus, journal_level FROM player_state WHERE user_id = $1 FOR UPDATE`, [ctx.userId]
    );
    ctx.state.focus = locked.rows[0].focus;
    if (ctx.upgrades.includes(up.id)) deltas.messages.push('Already owned');
    else if (locked.rows[0].journal_level < up.unlock) deltas.messages.push(`Unlocks at Journal Level ${up.unlock}`);
    else if (ctx.state.focus < up.cost) deltas.messages.push('Not enough Focus');
    else {
      await economy.addFocus(client, ctx, -up.cost, 'buy_upgrade', up.id, deltas);
      await client.query(
        `INSERT INTO player_upgrades (user_id, upgrade_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [ctx.userId, up.id]
      );
      ctx.upgrades.push(up.id);
      ctx.rate = idle.rateFor(ctx.levels, ctx.upgrades);
      await economy.bumpObjectives(client, ctx, 'buy', 1, deltas);
      deltas.messages.push(`${up.name} installed`);
    }
    res.json(Object.assign(await gameState(client, ctx), { deltas }));
  });
}));

// ── Profile ─────────────────────────────────────────────────────────────────

async function profilePayload(client, ctx) {
  const { rows } = await client.query(
    `SELECT cosmetic_id FROM player_cosmetics WHERE user_id = $1`, [ctx.userId]
  );
  const ownedIds = new Set(rows.map((r) => r.cosmetic_id));
  const load = await client.query(`SELECT * FROM player_loadout WHERE user_id = $1`, [ctx.userId]);
  const loadout = load.rows[0] || content.DEFAULT_LOADOUT;
  return {
    player: await playerPayload(client, ctx),
    slots: content.SLOTS,
    rarities: content.RARITY,
    loadout: {
      generator_skin: loadout.generator_skin,
      backdrop: loadout.backdrop,
      collect_effect: loadout.collect_effect,
      avatar_frame: loadout.avatar_frame,
    },
    // The Locker shows everything in the game, not just what you own —
    // a track you cannot see is a track you cannot want.
    locker: content.COSMETICS.map((c) => ({
      id: c.id, name: c.name, slot: c.slot, rarity: c.rarity, css: c.css,
      owned: ownedIds.has(c.id),
      equipped: loadout[c.slot] === c.id,
    })),
    owned_count: ownedIds.size,
    total_count: content.COSMETICS.length,
  };
}

router.get('/profile', handle(async (req, res) => {
  if (demoOr401(req, res, () => fixtures.profile())) return;
  const out = await withTx(async (client) => {
    const ctx = await context(client, req);
    return profilePayload(client, ctx);
  });
  res.json(out);
}));

router.post('/profile/loadout', handle(async (req, res) => {
  const slot = String(req.body.slot || '');
  if (!content.SLOTS.some((s) => s.id === slot)) return res.status(400).json({ error: 'unknown_slot' });
  const cosmeticId = req.body.cosmetic_id ? String(req.body.cosmetic_id) : null;
  await withTx(async (client) => {
    const ctx = await context(client, req);
    const deltas = emptyDeltas();
    if (cosmeticId) {
      const c = content.COS_BY_ID.get(cosmeticId);
      if (!c || c.slot !== slot) return res.status(400).json({ error: 'wrong_slot' });
      const owned = await client.query(
        `SELECT 1 FROM player_cosmetics WHERE user_id = $1 AND cosmetic_id = $2`, [ctx.userId, cosmeticId]
      );
      if (!owned.rowCount) return res.status(403).json({ error: 'not_owned' });
      deltas.messages.push(`${c.name} equipped`);
    } else {
      deltas.messages.push('Unequipped');
    }
    await client.query(
      `INSERT INTO player_loadout (user_id, ${slot}) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET ${slot} = EXCLUDED.${slot}, updated_at = NOW()`,
      [ctx.userId, cosmeticId]
    );
    res.json(Object.assign(await profilePayload(client, ctx), { deltas }));
  });
}));

router.post('/profile/timezone', handle(async (req, res) => {
  // Refuse rather than fall back. Quietly storing UTC for a zone we could not
  // resolve would move when "today" rolls over and could break a live streak
  // — a worse outcome than telling the caller its value was no good.
  const tz = String(req.body.timezone || '');
  if (!require('../game/periods').validTz(tz)) {
    return res.status(400).json({ error: 'unknown_timezone' });
  }
  await withTx(async (client) => {
    const ctx = await context(client, req);
    const deltas = emptyDeltas();
    await client.query(`UPDATE player_state SET timezone = $2, updated_at = NOW() WHERE user_id = $1`,
      [ctx.userId, tz]);
    ctx.state.timezone = tz;
    ctx.keys = require('../game/periods').keysFor(ctx.now, tz);
    deltas.messages.push('Timezone set to ' + tz);
    res.json(Object.assign(await profilePayload(client, ctx), { deltas }));
  });
}));

module.exports = { router, gameState, profilePayload };
