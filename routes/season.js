// The season pass: a 50-tier track, two rows, priced entirely in currency the
// player earned by journalling. The real-money door is deliberately shut —
// see routes/purchase.js.

const express = require('express');
const {
  demoOr401, withTx, context, playerPayload, emptyDeltas, handle,
  economy, seasons, content,
} = require('./common');
const fixtures = require('../game/fixtures');
const { purchasesEnabled } = require('./purchase');

const router = express.Router();

function decorate(reward) {
  if (!reward) return null;
  const out = { kind: reward.kind, label: reward.label };
  if (reward.kind === 'focus') out.amount = reward.amount;
  if (reward.kind === 'resolve') out.amount = reward.amount;
  if (reward.kind === 'cosmetic') {
    const c = content.COS_BY_ID.get(reward.cosmetic_id);
    out.cosmetic_id = reward.cosmetic_id;
    if (c) { out.rarity = c.rarity; out.slot = c.slot; out.css = c.css; out.name = c.name; }
  }
  return out;
}

async function seasonPayload(client, ctx) {
  const progress = await economy.loadSeasonProgress(client, ctx, false);
  const track = seasons.tiersFor(ctx.season).map((row) => ({
    tier: row.tier,
    free: decorate(row.free),
    premium: decorate(row.premium),
    unlocked: row.tier <= progress.tier,
    free_claimed: row.tier <= progress.granted_free_tier,
    premium_claimed: row.tier <= progress.granted_premium_tier,
  }));
  const spPer = ctx.season.sp_per_tier;
  // Where the bar sits inside the CURRENT tier, which is what the header
  // draws — not the raw season total.
  const earnedTier = Math.min(ctx.season.tiers, Math.floor(progress.season_xp / spPer));
  return {
    season: {
      id: ctx.season.id, name: ctx.season.name,
      starts_at: ctx.season.starts_at, ends_at: ctx.season.ends_at,
      tiers: ctx.season.tiers, sp_per_tier: spPer,
      premium_cost: ctx.season.premium_cost,
      skip_cost: ctx.season.skip_cost,
      max_skips: ctx.season.max_skips,
    },
    player: await playerPayload(client, ctx),
    progress: {
      season_xp: progress.season_xp,
      tier: progress.tier,
      earned_tier: earnedTier,
      tier_progress: progress.season_xp % spPer,
      tier_target: spPer,
      premium: progress.premium,
      skips_used: progress.skips_used,
      max_skips: ctx.season.max_skips,
      granted_free_tier: progress.granted_free_tier,
      granted_premium_tier: progress.granted_premium_tier,
    },
    track,
    objectives: await economy.loadObjectives(client, ctx),
    resolve: ctx.state.resolve,
    can_unlock: !progress.premium && ctx.state.resolve >= ctx.season.premium_cost,
    can_skip: progress.skips_used < ctx.season.max_skips
      && progress.tier < ctx.season.tiers
      && ctx.state.resolve >= ctx.season.skip_cost,
    purchases_enabled: purchasesEnabled(),
  };
}

router.get('/season', handle(async (req, res) => {
  if (demoOr401(req, res, () => fixtures.season())) return;
  const out = await withTx(async (client) => {
    const ctx = await context(client, req);
    return seasonPayload(client, ctx);
  });
  res.json(out);
}));

router.post('/season/unlock-premium', handle(async (req, res) => {
  await withTx(async (client) => {
    const ctx = await context(client, req);
    const deltas = emptyDeltas();
    const progress = await economy.loadSeasonProgress(client, ctx, true);
    if (progress.premium) {
      deltas.messages.push('Premium track already unlocked');
    } else if (!(await economy.spendResolve(client, ctx, ctx.season.premium_cost,
      'unlock_premium', ctx.season.id, deltas))) {
      deltas.messages.push(`Need ${ctx.season.premium_cost} Resolve — earn it by journalling`);
    } else {
      await client.query(
        `UPDATE season_progress SET premium = TRUE, updated_at = NOW()
         WHERE user_id = $1 AND season_id = $2`,
        [ctx.userId, ctx.season.id]
      );
      progress.premium = true;
      // Retroactive by construction: the premium watermark is still at 0, so
      // releaseTiers pays out every tier already reached, in one go.
      await economy.releaseTiers(client, ctx, progress, deltas);
      deltas.messages.push('Premium track unlocked');
    }
    res.json(Object.assign(await seasonPayload(client, ctx), { deltas }));
  });
}));

router.post('/season/skip-tier', handle(async (req, res) => {
  await withTx(async (client) => {
    const ctx = await context(client, req);
    const deltas = emptyDeltas();
    const progress = await economy.loadSeasonProgress(client, ctx, true);
    if (progress.tier >= ctx.season.tiers) {
      deltas.messages.push('Track complete');
    } else if (progress.skips_used >= ctx.season.max_skips) {
      deltas.messages.push(`Skip limit reached — ${ctx.season.max_skips} per season`);
    } else if (!(await economy.spendResolve(client, ctx, ctx.season.skip_cost,
      'skip_tier', `${ctx.season.id}:t${progress.tier + 1}`, deltas))) {
      deltas.messages.push(`Need ${ctx.season.skip_cost} Resolve`);
    } else {
      const { rows } = await client.query(
        `UPDATE season_progress SET skips_used = skips_used + 1, tier = LEAST($3, tier + 1),
           updated_at = NOW()
         WHERE user_id = $1 AND season_id = $2 RETURNING *`,
        [ctx.userId, ctx.season.id, ctx.season.tiers]
      );
      Object.assign(progress, rows[0]);
      await economy.releaseTiers(client, ctx, progress, deltas);
      deltas.messages.push(`Skipped to tier ${progress.tier}`);
    }
    res.json(Object.assign(await seasonPayload(client, ctx), { deltas }));
  });
}));

module.exports = { router, seasonPayload };
