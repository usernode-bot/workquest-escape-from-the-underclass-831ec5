// All game content lives in versioned JS modules, never in database tables.
//
// The database stores per-user STATE keyed by the stable string ids below
// (`gen_coffee`, `skin_neon_desk`). Balance changes then ship as a normal
// code review with a diff anyone can read, and a player's save survives them
// — rather than being an UPDATE nobody can audit or roll back.
//
// Cosmetics are CSS/SVG only. No image assets, so nothing can 404 and every
// skin themes itself correctly in dark mode.

// ── Generators ──────────────────────────────────────────────────────────────
// cost(n) = ceil(base * growth^n) for the (n+1)-th level.
//
// `capBase`/`capPerLevel` tie the ceiling to Journal Level: the idle game
// cannot run away from the journaling that is supposed to feed it. You do not
// grind past a wall, you journal past it.
const GENERATORS = [
  { id: 'gen_notepad',    name: 'Pocket Notepad',   blurb: 'Ideas stop escaping.',            base: 15,      growth: 1.13, rate: 0.1,    unlock: 1,  capBase: 25, capPerLevel: 5 },
  { id: 'gen_lamp',       name: 'Desk Lamp',        blurb: 'The corner of the room you own.', base: 120,     growth: 1.14, rate: 0.8,    unlock: 2,  capBase: 20, capPerLevel: 5 },
  { id: 'gen_cabinet',    name: 'Filing Cabinet',   blurb: 'Somewhere for the past to go.',   base: 1400,    growth: 1.15, rate: 6,      unlock: 4,  capBase: 15, capPerLevel: 5 },
  { id: 'gen_coffee',     name: 'Coffee Machine',   blurb: 'Non-negotiable infrastructure.',  base: 18000,   growth: 1.15, rate: 42,     unlock: 6,  capBase: 15, capPerLevel: 4 },
  { id: 'gen_whiteboard', name: 'Whiteboard Wall',  blurb: 'Thinking, but larger.',           base: 220000,  growth: 1.16, rate: 300,    unlock: 9,  capBase: 10, capPerLevel: 4 },
  { id: 'gen_intern',     name: 'Eager Intern',     blurb: 'Asks good questions. Loudly.',    base: 3100000, growth: 1.16, rate: 2100,   unlock: 13, capBase: 10, capPerLevel: 3 },
  { id: 'gen_script',     name: 'Automation Script', blurb: 'Runs while you sleep. Mostly.',  base: 46000000, growth: 1.17, rate: 15000, unlock: 18, capBase: 8,  capPerLevel: 3 },
  { id: 'gen_machine',    name: 'The Machine',      blurb: 'You no longer work for it.',      base: 780000000, growth: 1.18, rate: 110000, unlock: 24, capBase: 5, capPerLevel: 2 },
];

const GEN_BY_ID = new Map(GENERATORS.map((g) => [g.id, g]));

function genCost(gen, level) {
  return Math.ceil(gen.base * Math.pow(gen.growth, level));
}

function genCap(gen, journalLevel) {
  return gen.capBase + gen.capPerLevel * Math.max(0, journalLevel - 1);
}

// ── Upgrades ────────────────────────────────────────────────────────────────
// One-time Focus purchases. `offline` adds hours to the away-accrual cap;
// `mult` multiplies one generator or everything.
const UPGRADES = [
  { id: 'up_thermos',   name: 'Insulated Thermos', blurb: '+2h of offline Focus.',              cost: 5000,      offline: 2,  unlock: 3 },
  { id: 'up_timer',     name: 'Kitchen Timer',     blurb: 'Pocket Notepad output ×2.',          cost: 9000,      target: 'gen_notepad', mult: 2, unlock: 3 },
  { id: 'up_labels',    name: 'Label Maker',       blurb: 'Filing Cabinet output ×2.',          cost: 90000,     target: 'gen_cabinet', mult: 2, unlock: 5 },
  { id: 'up_beans',     name: 'Better Beans',      blurb: 'Coffee Machine output ×3.',          cost: 900000,    target: 'gen_coffee',  mult: 3, unlock: 8 },
  { id: 'up_nightshift', name: 'Night Shift',      blurb: '+6h of offline Focus.',              cost: 2400000,   offline: 6,  unlock: 10 },
  { id: 'up_standing',  name: 'Standing Desk',     blurb: 'Everything ×1.5.',                   cost: 14000000,  mult: 1.5,   unlock: 14 },
  { id: 'up_pipeline',  name: 'Build Pipeline',    blurb: 'Automation Script output ×3.',       cost: 260000000, target: 'gen_script', mult: 3, unlock: 19 },
  { id: 'up_dayplanner', name: 'The Day Planner',  blurb: '+8h of offline Focus. Everything ×2.', cost: 4100000000, offline: 8, mult: 2, unlock: 26 },
];

const UP_BY_ID = new Map(UPGRADES.map((u) => [u.id, u]));

// ── Cosmetics ───────────────────────────────────────────────────────────────
// Four slots, purely visual, awarded by the season track. Rarity drives the
// border and glow only — a Legendary backdrop earns exactly as much Focus as
// no backdrop at all, which is the whole deal with paying for cosmetics.
const SLOTS = [
  { id: 'generator_skin', label: 'Workshop skin' },
  { id: 'backdrop',       label: 'Backdrop' },
  { id: 'collect_effect', label: 'Collect effect' },
  { id: 'avatar_frame',   label: 'Avatar frame' },
];

// Tailwind's extractor is a regex over source text, so every class name here
// is a WHOLE literal. Never assemble one from a rarity or slot at runtime.
const RARITY = {
  common:    { label: 'Common',    badge: 'border-zinc-600 text-zinc-300 bg-zinc-800/60' },
  rare:      { label: 'Rare',      badge: 'border-sky-500 text-sky-300 bg-sky-500/10' },
  epic:      { label: 'Epic',      badge: 'border-fuchsia-500 text-fuchsia-300 bg-fuchsia-500/10' },
  legendary: { label: 'Legendary', badge: 'border-amber-400 text-amber-300 bg-amber-400/10 shadow-amber-400/30' },
};

const c = (id, name, slot, rarity, css) => ({ id, name, slot, rarity, css });

const COSMETICS = [
  c('skin_graphite',   'Graphite',        'generator_skin', 'common',    'from-zinc-800 to-zinc-900'),
  c('skin_blueprint',  'Blueprint',       'generator_skin', 'rare',      'from-sky-900 to-slate-900'),
  c('skin_neon_desk',  'Neon Desk',       'generator_skin', 'epic',      'from-fuchsia-900 to-indigo-950'),
  c('skin_gilded',     'Gilded Overtime', 'generator_skin', 'legendary', 'from-amber-800 to-zinc-950'),
  c('back_paper',      'Ruled Paper',     'backdrop',       'common',    'from-zinc-900 to-zinc-950'),
  c('back_dusk',       'Office Dusk',     'backdrop',       'rare',      'from-indigo-950 to-zinc-950'),
  c('back_aurora',     'Aurora Shift',    'backdrop',       'epic',      'from-emerald-950 to-indigo-950'),
  c('back_midnight',   'Midnight Oil',    'backdrop',       'legendary', 'from-amber-950 to-black'),
  c('fx_tick',         'Paper Tick',      'collect_effect', 'common',    'text-zinc-300'),
  c('fx_sparks',       'Desk Sparks',     'collect_effect', 'rare',      'text-sky-300'),
  c('fx_confetti',     'Small Confetti',  'collect_effect', 'epic',      'text-fuchsia-300'),
  c('fx_supernova',    'Quiet Supernova', 'collect_effect', 'legendary', 'text-amber-300'),
  c('frame_clip',      'Paperclip',       'avatar_frame',   'common',    'ring-zinc-600'),
  c('frame_steel',     'Brushed Steel',   'avatar_frame',   'rare',      'ring-sky-500'),
  c('frame_violet',    'Violet Ink',      'avatar_frame',   'epic',      'ring-fuchsia-500'),
  c('frame_gold',      'Gold Nib',        'avatar_frame',   'legendary', 'ring-amber-400'),
];

const COS_BY_ID = new Map(COSMETICS.map((x) => [x.id, x]));

// Everyone starts able to look like something.
const DEFAULT_LOADOUT = {
  generator_skin: 'skin_graphite',
  backdrop: 'back_paper',
  collect_effect: 'fx_tick',
  avatar_frame: 'frame_clip',
};
const STARTER_COSMETICS = Object.values(DEFAULT_LOADOUT);

module.exports = {
  GENERATORS, GEN_BY_ID, genCost, genCap,
  UPGRADES, UP_BY_ID,
  SLOTS, RARITY, COSMETICS, COS_BY_ID, DEFAULT_LOADOUT, STARTER_COSMETICS,
};
