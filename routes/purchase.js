// The real-money seam, wired shut.
//
// Both endpoints EXIST in every environment and answer honestly; what they do
// is decided by PURCHASES_ENABLED, a declared app secret that ships as
// "false". This is deliberately NOT gated on USERNODE_ENV — a feature that
// exists in staging and not in production (or the reverse) is a feature
// nobody actually reviewed. Flipping the secret is the only switch.

const express = require('express');
const { handle } = require('./common');

const router = express.Router();

const purchasesEnabled = () =>
  String(process.env.PURCHASES_ENABLED || 'false').toLowerCase() === 'true';

// Priced, described, and unsellable. Keeping the shape real means the day the
// switch flips, the client already knows how to render it.
const SKUS = [
  { sku: 'resolve_small',  name: 'Pocketful of Resolve', resolve: 300,  price_usd: 1.99 },
  { sku: 'resolve_medium', name: 'Satchel of Resolve',   resolve: 1000, price_usd: 4.99 },
  { sku: 'resolve_large',  name: 'Crate of Resolve',     resolve: 2600, price_usd: 9.99 },
];

const UNAVAILABLE_COPY = "Resolve purchases aren't available yet — earn it by journalling.";

router.get('/purchase/catalog', handle(async (_req, res) => {
  const enabled = purchasesEnabled();
  res.json({
    enabled,
    skus: enabled ? SKUS : [],
    message: enabled ? null : UNAVAILABLE_COPY,
  });
}));

router.post('/purchase/checkout', handle(async (_req, res) => {
  if (!purchasesEnabled()) {
    return res.status(503).json({ error: 'purchases_unavailable', message: UNAVAILABLE_COPY });
  }
  // Nothing has ever run down this branch. When it does, it will need a real
  // payment provider behind it — not a line added here in a hurry.
  res.status(503).json({ error: 'purchases_unavailable', message: 'Checkout is not implemented.' });
}));

module.exports = { router, purchasesEnabled, SKUS, UNAVAILABLE_COPY };
