// One request that gets the Journal on screen: who you are, today's log, what
// you left behind, and the vocabulary the client needs for the migrate sheet.

const express = require('express');
const {
  demoOr401, withTx, context, playerPayload, handle, periods,
} = require('./common');
const fixtures = require('../game/fixtures');
const { logPayload, trayRows } = require('./journal');
const { purchasesEnabled } = require('./purchase');

const router = express.Router();

router.get('/bootstrap', handle(async (req, res) => {
  if (demoOr401(req, res, () => fixtures.bootstrap())) return;
  const out = await withTx(async (client) => {
    const ctx = await context(client, req);
    return {
      player: await playerPayload(client, ctx),
      log: await logPayload(client, ctx, 'day', ctx.keys.day),
      tray: await trayRows(client, ctx),
      targets: periods.TARGETS.map((t) => ({ token: t.token, label: t.label })),
      horizons: periods.HORIZONS,
      purchases_enabled: purchasesEnabled(),
      // Fresh accounts get the suggestion chips instead of a blank page.
      is_new: !!ctx.state.is_new,
    };
  });
  res.json(out);
}));

module.exports = { router };
