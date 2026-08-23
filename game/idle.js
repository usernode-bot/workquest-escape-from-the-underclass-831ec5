// Idle accrual.
//
// There is no cron and no background timer. Focus is computed on READ, from
// `now - last_tick_at`, and `last_tick_at` is advanced inside the same
// transaction that banks the Focus — so a container restart, a redeploy, or
// ten browser tabs open at once can never pay twice for the same second.

const { GEN_BY_ID, UP_BY_ID } = require('./content');

const BASE_OFFLINE_HOURS = 8;

// Focus per second, given owned generator levels and one-time upgrades.
function rateFor(levels, upgradeIds) {
  const ups = (upgradeIds || []).map((id) => UP_BY_ID.get(id)).filter(Boolean);
  const global = ups.filter((u) => u.mult && !u.target).reduce((m, u) => m * u.mult, 1);
  let total = 0;
  for (const [genId, level] of Object.entries(levels || {})) {
    const gen = GEN_BY_ID.get(genId);
    if (!gen || !level) continue;
    const targeted = ups.filter((u) => u.target === genId).reduce((m, u) => m * u.mult, 1);
    total += gen.rate * level * targeted;
  }
  return total * global;
}

function offlineCapSeconds(upgradeIds) {
  const extra = (upgradeIds || [])
    .map((id) => UP_BY_ID.get(id))
    .filter((u) => u && u.offline)
    .reduce((s, u) => s + u.offline, 0);
  return (BASE_OFFLINE_HOURS + extra) * 3600;
}

// How much has accumulated since `lastTickAt`, and was the away-cap hit?
function accrue(lastTickAt, now, rate, capSeconds) {
  const elapsed = Math.max(0, (now.getTime() - new Date(lastTickAt).getTime()) / 1000);
  const counted = Math.min(elapsed, capSeconds);
  return {
    seconds: counted,
    elapsed,
    capped: elapsed > capSeconds,
    gained: counted * rate,
  };
}

module.exports = { BASE_OFFLINE_HOURS, rateFor, offlineCapSeconds, accrue };
