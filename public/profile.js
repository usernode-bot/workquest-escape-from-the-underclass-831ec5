/* Profile — who you are, what you've done, and the Locker. Cosmetics are
 * pure decoration: nothing in here changes how fast anything goes. */
(function (WQ) {
  'use strict';

  const s = { data: null, slot: 'generator_skin' };

  const RARITY_BADGE = {
    common: 'border-zinc-600 text-zinc-300 bg-zinc-800/60',
    rare: 'border-sky-500 text-sky-300 bg-sky-500/10',
    epic: 'border-fuchsia-500 text-fuchsia-300 bg-fuchsia-500/10',
    legendary: 'border-amber-400 text-amber-300 bg-amber-400/10',
  };
  const RARITY_LABEL = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };

  const COMMON_TZ = [
    'UTC', 'Europe/London', 'Europe/Berlin', 'Europe/Lisbon', 'America/New_York',
    'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Sao_Paulo',
    'Asia/Jakarta', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney',
  ];

  function identity() {
    const p = s.data.player;
    const frameId = s.data.loadout.avatar_frame;
    const frame = s.data.locker.find((c) => c.id === frameId);
    const initial = (p.username || '?').slice(0, 1).toUpperCase();
    const pct = Math.round((p.level_progress / Math.max(1, p.level_target)) * 100);
    return `<div class="px-4 pt-5 flex items-center gap-4">
      <div class="w-16 h-16 rounded-2xl grid place-items-center text-xl font-semibold text-zinc-100 bg-zinc-800"
           style="${WQ.esc(frame ? frame.css : '')}">${WQ.esc(initial)}</div>
      <div class="min-w-0 flex-1">
        <div class="text-base font-semibold text-zinc-100 truncate">${WQ.esc(p.username || 'You')}</div>
        <div class="text-xs text-zinc-500">Journal Level ${p.journal_level}</div>
        <div class="mt-1.5 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
          <div class="h-full bg-violet-500" style="width:${pct}%"></div>
        </div>
        <div class="text-[10px] text-zinc-600 mt-1 tabular-nums">${WQ.plain(p.level_progress)}/${WQ.plain(p.level_target)} XP to level ${p.journal_level + 1}</div>
      </div>
    </div>`;
  }

  function stat(label, value, tint) {
    return `<div class="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2.5">
      <div class="text-sm font-semibold tabular-nums ${tint || 'text-zinc-100'}">${value}</div>
      <div class="text-[10px] text-zinc-500 mt-0.5">${label}</div>
    </div>`;
  }

  function stats() {
    const p = s.data.player;
    return `<div class="px-4 mt-4 grid grid-cols-3 gap-2">
      ${stat('Current streak', p.streak + 'd', 'text-amber-300')}
      ${stat('Longest streak', p.longest_streak + 'd')}
      ${stat('Days journalled', WQ.plain(p.active_days))}
      ${stat('Tasks completed', WQ.plain(p.completions))}
      ${stat('Tasks migrated', WQ.plain(p.migrations))}
      ${stat('Focus earned', WQ.num(p.lifetime_focus), 'text-sky-300')}
    </div>
    <div class="px-4 mt-2 text-[11px] text-zinc-600">
      ${p.rewards_left_today} of ${p.reward_cap} rewarded completions left today${
        p.multiplier > 1 ? ` · streak bonus +${Math.round((p.multiplier - 1) * 100)}%` : ''}
    </div>`;
  }

  function lockerCard(c) {
    return `<button class="un-pressable relative rounded-xl border p-2 text-left ${
      c.equipped ? 'border-violet-500 bg-violet-500/10'
      : c.owned ? 'border-zinc-700 bg-zinc-900' : 'border-zinc-800 bg-zinc-900/40 opacity-50'}"
      data-cos="${c.id}" ${c.owned ? '' : 'disabled'}>
      <div class="h-12 rounded-lg mb-1.5 ring-1 ring-inset ring-white/10" style="${WQ.esc(c.css)}"></div>
      <div class="text-[11px] text-zinc-200 truncate">${WQ.esc(c.name)}</div>
      <div class="mt-1"><span class="text-[8px] px-1 py-0.5 rounded border ${RARITY_BADGE[c.rarity] || RARITY_BADGE.common}">${RARITY_LABEL[c.rarity] || ''}</span></div>
      ${c.equipped ? '<span class="absolute top-1.5 right-1.5 text-[9px] text-violet-300">equipped</span>' : ''}
      ${!c.owned ? '<span class="absolute top-1.5 right-1.5 text-[9px] text-zinc-600">locked</span>' : ''}
    </button>`;
  }

  function locker() {
    const items = s.data.locker.filter((c) => c.slot === s.slot);
    const equipped = items.find((c) => c.equipped);
    const tabs = s.data.slots.map((sl) =>
      `<button class="un-pressable shrink-0 rounded-lg px-3 py-1.5 text-[11px] border ${
        sl.id === s.slot ? 'bg-violet-600/20 border-violet-500/50 text-violet-200'
                         : 'bg-zinc-900 border-zinc-800 text-zinc-500'}"
        data-slot="${sl.id}">${WQ.esc(sl.label)}</button>`).join('');
    return `<div class="px-4 pt-5 flex items-center justify-between">
        <div class="text-[11px] uppercase tracking-wider text-zinc-500">Locker</div>
        <div class="text-[11px] text-zinc-600 tabular-nums">${s.data.owned_count}/${s.data.total_count} unlocked</div>
      </div>
      <div class="px-4 pt-2 flex gap-1.5 overflow-x-auto">${tabs}</div>
      <div class="px-4 pt-3 grid grid-cols-3 gap-2">${items.map(lockerCard).join('')}</div>
      ${equipped ? `<div class="px-4 pt-2"><button class="un-pressable text-[11px] text-zinc-500 underline" data-unequip="1">Unequip ${WQ.esc(equipped.name)}</button></div>` : ''}`;
  }

  function settings() {
    return `<div class="px-4 pt-6 pb-2 text-[11px] uppercase tracking-wider text-zinc-500">Settings</div>
      <div class="un-group mx-4 overflow-hidden rounded-2xl border border-zinc-800">
        <button class="un-group-row w-full flex items-center justify-between px-4 py-3 bg-zinc-900 text-left" data-tz="1">
          <div>
            <div class="text-sm text-zinc-100">Timezone</div>
            <div class="text-xs text-zinc-500">Decides when "today" rolls over — and when your streak breaks.</div>
          </div>
          <div class="text-xs text-zinc-400 shrink-0 ml-3">${WQ.esc(s.data.player.timezone)}</div>
        </button>
      </div>
      <div class="px-4 pt-3 text-[11px] text-zinc-600">Cosmetics are decoration only — nothing in the Locker changes how fast anything grows.</div>`;
  }

  function paint(el) {
    el.innerHTML = identity() + stats() + locker() + settings();
    wire(el);
  }

  async function post(el, path, body) {
    try {
      const data = await WQ.api(path, { method: 'POST', body: body || {} });
      s.data = data;
      WQ.applyDeltas(data);
      paint(el);
    } catch (err) { WQ.toast((err.data && err.data.error === 'not_owned') ? "You haven't unlocked that yet" : (err.message || 'That did not work')); }
  }

  function wire(el) {
    el.querySelectorAll('[data-slot]').forEach((b) => b.addEventListener('click', () => {
      s.slot = b.dataset.slot; paint(el);
    }));
    el.querySelectorAll('[data-cos]').forEach((b) => b.addEventListener('click', () =>
      post(el, '/api/profile/loadout', { slot: s.slot, cosmetic_id: b.dataset.cos })));
    const un = el.querySelector('[data-unequip]');
    if (un) un.addEventListener('click', () => post(el, '/api/profile/loadout', { slot: s.slot, cosmetic_id: null }));

    const tz = el.querySelector('[data-tz]');
    if (tz) tz.addEventListener('click', async () => {
      const guess = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const list = COMMON_TZ.slice();
      if (guess && !list.includes(guess)) list.unshift(guess);
      const picked = await unNative.menu({
        anchorEl: tz, title: 'Timezone',
        items: list.map((z) => ({ id: z, label: z + (z === guess ? ' (this device)' : '') })),
      });
      if (picked) post(el, '/api/profile/timezone', { timezone: picked.id });
    });
  }

  WQ.screens.profile = {
    async render(el, _rest, opts) {
      WQ.setTitle('Profile', WQ.state.player ? `${WQ.state.player.streak}-day streak` : '');
      if (!s.data || (opts && opts.changed)) {
        el.innerHTML = WQ.skeleton(5);
        s.data = await WQ.api('/api/profile');
        WQ.setPlayer(s.data.player);
      }
      paint(el);
    },
  };
})(window.WQ);
